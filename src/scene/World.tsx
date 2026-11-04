import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Sky } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Terrain as TerrainData, Trail } from '../lib/data'
import { input, useGame } from '../lib/store'
import { Terrain } from './Terrain'
import { TrailPath } from './TrailPath'
import { Forest } from './Forest'
import { Hiker, type HikerHandle } from './Hiker'

const WALK_SPEED = 6 // m/s (게임 속도: 실제의 약 5배)
const RUN_SPEED = 15
const SUN = new THREE.Vector3(-0.5, 0.55, 0.65).normalize() // 남서쪽 하늘의 해

type Props = { terrain: TerrainData; trail: Trail }

/** 하늘 상자가 카메라를 따라다니게 해서 높은 곳에서도 하늘이 보이게 한다 */
function SkyDome() {
  const group = useRef<THREE.Group>(null!)
  useFrame(({ camera }) => group.current.position.copy(camera.position))
  return (
    <group ref={group}>
      <Sky distance={5000} sunPosition={SUN.toArray()} turbidity={6} rayleigh={1.2} />
    </group>
  )
}

export function World({ terrain, trail }: Props) {
  const hiker = useRef<HikerHandle>(null!)
  const controls = useRef<OrbitControlsImpl>(null!)
  const sun = useRef<THREE.DirectionalLight>(null!)
  const camera = useThree((s) => s.camera)
  const lastTarget = useRef(new THREE.Vector3())

  // 처음 카메라 위치: 출발점 뒤쪽 위
  useEffect(() => {
    // 개발 중에는 ?d=1700 처럼 중간 지점부터 시작해 확인할 수 있다
    const debugStart = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('d')) || 0 : 0
    if (debugStart) useGame.getState().setDistance(Math.min(debugStart, trail.length))
    const d = useGame.getState().distance
    const start = trail.positionAt(d)
    const h = trail.headingAt(d)
    camera.position.set(start.x - Math.sin(h) * 18, start.y + 9, start.z - Math.cos(h) * 18)
    lastTarget.current.copy(start).setY(start.y + 1.5)
    controls.current.target.copy(lastTarget.current)
    controls.current.update()
  }, [camera, trail])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const game = useGame.getState()
    let { distance } = game

    // 1) 이동
    const speed = input.run ? RUN_SPEED : WALK_SPEED
    const dir = (input.forward ? 1 : 0) - (input.backward ? 1 : 0)
    if (dir !== 0) {
      const next = THREE.MathUtils.clamp(distance + dir * speed * dt, 0, trail.length)
      hiker.current.stride(next - distance)
      distance = next
      game.setDistance(distance)
    }

    // 2) 아바타 배치
    const pos = trail.positionAt(distance)
    hiker.current.group.position.copy(pos)
    hiker.current.group.rotation.y = trail.headingAt(distance)

    // 그림자가 아바타 주변에서 선명하도록 태양을 따라 옮김
    sun.current.position.copy(pos).addScaledVector(SUN, 300)
    sun.current.target.position.copy(pos)
    sun.current.target.updateMatrixWorld()

    // 3) 아바타를 따라가되, 마우스로 돌려 본 각도는 유지
    const target = pos.clone().setY(pos.y + 1.5)
    const delta = target.clone().sub(lastTarget.current)
    camera.position.add(delta)
    controls.current.target.copy(target)
    lastTarget.current.copy(target)
    controls.current.update()
  })

  return (
    <>
      <SkyDome />
      <fog attach="fog" args={['#c9d6e3', 800, 6000]} />
      <hemisphereLight args={['#dfefff', '#4a5d3a', 0.6]} />
      <directionalLight
        ref={sun}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-far={800}
        shadow-bias={-0.0005}
      />
      <Terrain terrain={terrain} />
      <Forest terrain={terrain} trail={trail} />
      <TrailPath trail={trail} />
      <Hiker ref={hiker} />
      <OrbitControls
        ref={controls}
        makeDefault
        enablePan={false}
        minDistance={4}
        maxDistance={400}
        maxPolarAngle={Math.PI * 0.49}
      />
    </>
  )
}
