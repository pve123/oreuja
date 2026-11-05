import * as THREE from 'three'

/**
 * 카메라에서 아바타까지 보이지 않는 원기둥을 그리고, 그 안에 들어온 나무·바위를 통째로 작게 줄여 숨긴다.
 * World 가 매 프레임 카메라와 아바타 위치를 넣어 준다.
 *
 * 나무는 아바타 둘레 uDetailRadius 안에서만 정밀 모델로 그리고 바깥은 가벼운 도형으로 그린다.
 * 같은 나무가 두 번 그려지지 않게 각 재질이 자기 쪽(안·밖)만 남긴다. 반지름이 0이면 정밀 모델이 아직 없다는 뜻이다.
 */
export const occlusionUniforms = {
  uOccCamera: { value: new THREE.Vector3() },
  uOccTarget: { value: new THREE.Vector3() },
  uOccRadius: { value: 4.5 },
  uDetailRadius: { value: 0 },
}

/** 아바타 쪽 끝 이 비율만큼은 줄이지 않는다 (아바타 바로 옆 나무까지 사라지지 않게) */
const KEEP_NEAR_TARGET = 0.9

type Options = {
  /** 'far' 는 정밀 반경 안에서 숨고(도형 나무), 'near' 는 반경 밖에서 숨는다(정밀 모델 나무) */
  ring?: 'far' | 'near'
  /** false 면 카메라 가림 숨기기를 빼고 ring 만 쓴다 (그림자용 깊이 재질) */
  occlusion?: boolean
}

/**
 * InstancedMesh 재질에 카메라 가림 숨기기를 붙인다. 같은 재질에 한 번만 부른다.
 * 그루마다 중심(밑동에서 centerLift 만큼 위)이 원기둥 안에 가까울수록 밑동 쪽으로 줄어든다.
 * 조각을 지우는 방식(디더링)과 달리 점무늬가 생기지 않는다.
 *
 * @param centerLift 판정에 쓸 중심 높이(모델 단위). 나무는 수관 가운데, 바위는 0
 */
export function withOcclusionShrink<T extends THREE.Material>(material: T, centerLift: number, options: Options = {}): T {
  const { ring, occlusion = true } = options
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, occlusionUniforms, { uOccLift: { value: centerLift } })
    // 정밀 반경 판정은 밑동의 수평 거리로 한다. 'far' 는 반경 안, 'near' 는 반경 밖을 숨긴다
    const ringCode =
      ring === undefined
        ? ''
        : `{
            vec3 base = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
            float inside = step( length( base.xz - uOccTarget.xz ), uDetailRadius );
            keep *= ${ring === 'far' ? '1.0 - inside' : 'inside'};
          }`
    const occlusionCode = occlusion
      ? `vec3 center = ( modelMatrix * instanceMatrix * vec4( 0.0, uOccLift, 0.0, 1.0 ) ).xyz;
          vec3 ab = uOccTarget - uOccCamera;
          float t = clamp( dot( center - uOccCamera, ab ) / max( dot( ab, ab ), 1e-4 ), 0.0, 1.0 );
          float d = length( center - ( uOccCamera + ab * t ) );
          keep = t > ${KEEP_NEAR_TARGET.toFixed(2)} ? 1.0 : smoothstep( uOccRadius * 0.5, uOccRadius, d );`
      : ''
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uOccCamera;
        uniform vec3 uOccTarget;
        uniform float uOccRadius;
        uniform float uOccLift;
        uniform float uDetailRadius;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
        {
          float keep = 1.0;
          ${occlusionCode}
          ${ringCode}
          transformed *= keep;
        }
        #endif`,
      )
  }
  material.customProgramCacheKey = () => `occlusion-shrink-${centerLift}-${ring ?? 'all'}-${occlusion}`
  return material
}

/** 그림자 깊이 재질. 도형 나무가 정밀 반경 안에서 그림자를 겹쳐 드리우지 않게 한다 */
export function ringDepthMaterial(centerLift: number, ring: 'far' | 'near') {
  return withOcclusionShrink(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), centerLift, {
    ring,
    occlusion: false,
  })
}
