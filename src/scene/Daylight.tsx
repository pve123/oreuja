import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Sky } from '@react-three/drei'
import * as THREE from 'three'
import type { Sky as SkyImpl } from 'three-stdlib'
import { MOON, MOON_COLOR, SUN, applySky, daylight, kstNow, parseDebugTime, settle, useSky } from '../lib/daylight'
import { occlusionUniforms } from '../lib/occlusion'
import { IS_TOUCH } from '../lib/device'

const STAR_COUNT = 1500
const STAR_RADIUS = 4000

/**
 * 실제 한국 시각 또는 베이스캠프에서 고른 시간대에 맞춘 하늘과 빛 (src/lib/daylight.ts). 하늘 상자와 별은 카메라를 따라다녀 높은 곳에서도 보인다.
 * 태양 조명은 그림자가 캐릭터 둘레에서 선명하도록 캐릭터(World 가 매 프레임 넣는 uOccTarget)를 따라 옮긴다.
 */
export function Daylight() {
  const group = useRef<THREE.Group>(null!)
  const sun = useRef<THREE.DirectionalLight>(null!)
  const moon = useRef<THREE.DirectionalLight>(null!)
  const sky = useRef<SkyImpl>(null!)
  const hemi = useRef<THREE.HemisphereLight>(null!)
  const stars = useRef<THREE.PointsMaterial>(null!)
  const scene = useThree((s) => s.scene)
  // 개발 중 ?time= 으로 고정한 시각 (없으면 실제 시각). 「지금」을 골랐을 때만 쓴다
  const debugTime = useMemo(() => (import.meta.env.DEV ? parseDebugTime(new URLSearchParams(location.search).get('time')) : null), [])

  // 별: 하늘 위쪽 반구에 흩뿌린 점. 지평선 가까이는 성기게
  const starGeometry = useMemo(() => {
    const pos = new Float32Array(STAR_COUNT * 3)
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    for (let i = 0; i < STAR_COUNT; i++) {
      const a = rand() * Math.PI * 2
      const e = Math.asin(0.05 + rand() * 0.95)
      pos[i * 3] = Math.cos(e) * Math.cos(a) * STAR_RADIUS
      pos[i * 3 + 1] = Math.sin(e) * STAR_RADIUS
      pos[i * 3 + 2] = Math.cos(e) * Math.sin(a) * STAR_RADIUS
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [])

  useFrame(({ camera }, dt) => {
    group.current.position.copy(camera.position)
    applySky(useSky.getState().preset, debugTime ?? kstNow())
    settle(dt)

    const u = sky.current.material.uniforms
    u.sunPosition.value.copy(daylight.skySun)
    u.rayleigh.value = daylight.rayleigh
    u.turbidity.value = daylight.turbidity
    u.mieCoefficient.value = daylight.mie
    stars.current.opacity = daylight.stars

    hemi.current.color.copy(daylight.skyColor)
    hemi.current.groundColor.copy(daylight.groundColor)
    hemi.current.intensity = daylight.hemiIntensity

    const pos = occlusionUniforms.uOccTarget.value
    const light = sun.current
    light.color.copy(daylight.sunColor)
    light.intensity = daylight.sunIntensity
    light.position.copy(pos).addScaledVector(SUN, 300)
    light.target.position.copy(pos)
    light.target.updateMatrixWorld()
    const night = moon.current
    night.intensity = daylight.moonIntensity
    night.position.copy(pos).addScaledVector(MOON, 300)
    night.target.position.copy(pos)
    night.target.updateMatrixWorld()
    if (scene.fog) scene.fog.color.copy(daylight.fogColor)
  })

  return (
    <>
      <group ref={group}>
        <Sky ref={sky} distance={5000} sunPosition={daylight.skySun.toArray()} turbidity={daylight.turbidity} rayleigh={daylight.rayleigh} />
        <points geometry={starGeometry}>
          <pointsMaterial ref={stars} color="#ffffff" size={2.2} sizeAttenuation={false} transparent opacity={daylight.stars} fog={false} depthWrite={false} />
        </points>
      </group>
      <hemisphereLight ref={hemi} args={[daylight.skyColor, daylight.groundColor, daylight.hemiIntensity]} />
      <directionalLight
        ref={sun}
        intensity={daylight.sunIntensity}
        castShadow
        // 폰·태블릿은 그림자 지도를 절반 크기로 (GPU 를 아낀다)
        shadow-mapSize={IS_TOUCH ? [1024, 1024] : [2048, 2048]}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-far={800}
        shadow-bias={-0.0005}
      />
      {/* 달빛: 그림자 없이 은은하게. 밤에도 길이 보이게 한다 */}
      <directionalLight ref={moon} color={MOON_COLOR} intensity={daylight.moonIntensity} />
    </>
  )
}
