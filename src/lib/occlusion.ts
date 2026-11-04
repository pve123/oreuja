import * as THREE from 'three'

/**
 * 카메라에서 아바타까지 보이지 않는 원기둥을 그리고, 그 안에 들어온 나무·바위 조각을 비운다.
 * World 가 매 프레임 카메라와 아바타 위치를 넣어 준다.
 */
export const occlusionUniforms = {
  uOccCamera: { value: new THREE.Vector3() },
  uOccTarget: { value: new THREE.Vector3() },
  uOccRadius: { value: 3.5 },
}

/** 아바타 쪽 끝 이 비율만큼은 비우지 않는다 (아바타 바로 옆 나무까지 사라지지 않게) */
const KEEP_NEAR_TARGET = 0.9

/** 재질에 카메라 가림 비우기를 붙인다. 같은 재질에 한 번만 부른다 */
export function withOcclusionCutout<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, occlusionUniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOccWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 occPos = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          occPos = instanceMatrix * occPos;
        #endif
        vOccWorld = ( modelMatrix * occPos ).xyz;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vOccWorld;
        uniform vec3 uOccCamera;
        uniform vec3 uOccTarget;
        uniform float uOccRadius;`,
      )
      .replace(
        'void main() {',
        `void main() {
        {
          vec3 ab = uOccTarget - uOccCamera;
          float t = clamp( dot( vOccWorld - uOccCamera, ab ) / max( dot( ab, ab ), 1e-4 ), 0.0, 1.0 );
          float d = length( vOccWorld - ( uOccCamera + ab * t ) );
          if ( t < ${KEEP_NEAR_TARGET.toFixed(2)} && d < uOccRadius ) {
            // 가장자리는 성기게(디더링) 비워서 구멍 경계가 딱딱하지 않게 한다
            float edge = smoothstep( uOccRadius * 0.55, uOccRadius, d );
            float noise = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
            if ( noise > edge ) discard;
          }
        }`,
      )
  }
  material.customProgramCacheKey = () => 'occlusion-cutout'
  return material
}
