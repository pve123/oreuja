import * as THREE from 'three'

/**
 * 카메라에서 아바타까지 보이지 않는 원기둥을 그리고, 그 안에 들어온 나무·바위를 통째로 작게 줄여 숨긴다.
 * World 가 매 프레임 카메라와 아바타 위치를 넣어 준다.
 */
export const occlusionUniforms = {
  uOccCamera: { value: new THREE.Vector3() },
  uOccTarget: { value: new THREE.Vector3() },
  uOccRadius: { value: 4.5 },
}

/** 아바타 쪽 끝 이 비율만큼은 줄이지 않는다 (아바타 바로 옆 나무까지 사라지지 않게) */
const KEEP_NEAR_TARGET = 0.9

/**
 * InstancedMesh 재질에 카메라 가림 숨기기를 붙인다. 같은 재질에 한 번만 부른다.
 * 그루마다 중심(밑동에서 centerLift 만큼 위)이 원기둥 안에 가까울수록 밑동 쪽으로 줄어든다.
 * 조각을 지우는 방식(디더링)과 달리 점무늬가 생기지 않는다.
 *
 * @param centerLift 판정에 쓸 중심 높이(모델 단위). 나무는 수관 가운데, 바위는 0
 */
export function withOcclusionShrink<T extends THREE.Material>(material: T, centerLift: number): T {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, occlusionUniforms, { uOccLift: { value: centerLift } })
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uOccCamera;
        uniform vec3 uOccTarget;
        uniform float uOccRadius;
        uniform float uOccLift;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
        {
          vec3 center = ( modelMatrix * instanceMatrix * vec4( 0.0, uOccLift, 0.0, 1.0 ) ).xyz;
          vec3 ab = uOccTarget - uOccCamera;
          float t = clamp( dot( center - uOccCamera, ab ) / max( dot( ab, ab ), 1e-4 ), 0.0, 1.0 );
          float d = length( center - ( uOccCamera + ab * t ) );
          float keep = t > ${KEEP_NEAR_TARGET.toFixed(2)} ? 1.0 : smoothstep( uOccRadius * 0.5, uOccRadius, d );
          transformed *= keep;
        }
        #endif`,
      )
  }
  material.customProgramCacheKey = () => `occlusion-shrink-${centerLift}`
  return material
}
