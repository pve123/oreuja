import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Sky } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { sampleHeight, type Terrain as TerrainData, type Trail } from '../lib/data'
import { input, useGame } from '../lib/store'
import { Terrain } from './Terrain'
import { SummitFlag } from './SummitFlag'
import { Forest } from './Forest'
import { Signposts } from './Signposts'
import { TrailDetails } from './TrailDetails'
import { Rocks } from './Rocks'
import { Hiker, type HikerHandle } from './Hiker'
import { composePhoto } from '../lib/photo'
import { occlusionUniforms } from '../lib/occlusion'

const WALK_SPEED = 6 // m/s (게임 속도: 실제의 약 5배)
const RUN_SPEED = 15
const STRAFE_SPEED = 3 // 옆걸음 m/s
const STRAFE_RUN_SPEED = 7
/** 등산로 좌우로 이만큼까지만 비킬 수 있다 (m) */
export const MAX_OFFSET = 18
const JUMP_SPEED = 5.5 // m/s, 약 1m 높이까지 뛴다
const GRAVITY = 15 // m/s², 실제(9.8)보다 세게 해서 경쾌하게
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
  const gl = useThree((s) => s.gl)
  const lastTarget = useRef(new THREE.Vector3())
  const photoFrames = useRef(0)
  /** 점프: 땅에서 떠 있는 높이(m)와 위쪽 속도(m/s) */
  const jump = useRef({ height: 0, velocity: 0 })
  /** 등산로 진행 방향 기준으로 아바타가 바라보는 각도 (0 = 정면) */
  const facing = useRef(0)

  // 정상에서 가장 낮게 트인 방향 (기념사진 배경으로 쓸 풍경 쪽)
  const vista = useMemo(() => {
    const top = trail.positionAt(trail.length)
    let best = new THREE.Vector3(1, 0, 0)
    let lowest = Infinity
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2
      const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a))
      let sum = 0
      for (const r of [30, 60, 120]) sum += sampleHeight(terrain, top.x + dir.x * r, top.z + dir.z * r)
      if (sum < lowest) {
        lowest = sum
        best = dir
      }
    }
    return best
  }, [terrain, trail])

  // 처음 카메라 위치: 출발점 뒤쪽 위
  useEffect(() => {
    // 개발 중에는 ?d=1700 처럼 중간 지점부터 시작해 확인할 수 있다
    const debugStart = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('d')) || 0 : 0
    if (debugStart) useGame.getState().setDistance(Math.min(debugStart, trail.length))
    // ?o=12 처럼 주면 등산로에서 옆으로 비킨 곳에서 시작한다
    const debugOffset = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('o')) || 0 : 0
    if (debugOffset) useGame.getState().setOffset(THREE.MathUtils.clamp(debugOffset, -MAX_OFFSET, MAX_OFFSET))
    // ?photo 를 붙이면 정상 도착 직후 기념사진까지 자동으로 찍는다
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('photo')) {
      const off = useGame.subscribe((s) => {
        if (s.mode === 'summit') {
          off()
          setTimeout(() => useGame.getState().takePhoto(), 500)
        }
      })
    }
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
    let { distance, offset } = game

    // 1) 이동: 앞뒤는 등산로를 따라, 옆은 등산로 좌우 MAX_OFFSET 안에서
    if (game.mode === 'hiking') {
      const dir = (input.forward ? 1 : 0) - (input.backward ? 1 : 0)
      const side = (input.right ? 1 : 0) - (input.left ? 1 : 0)
      if (dir !== 0) {
        const speed = input.run ? RUN_SPEED : WALK_SPEED
        const next = THREE.MathUtils.clamp(distance + dir * speed * dt, 0, trail.length)
        hiker.current.stride(next - distance)
        distance = next
        game.setDistance(distance)
      }
      if (side !== 0) {
        const speed = input.run ? STRAFE_RUN_SPEED : STRAFE_SPEED
        const next = THREE.MathUtils.clamp(offset + side * speed * dt, -MAX_OFFSET, MAX_OFFSET)
        hiker.current.stride(next - offset)
        offset = next
        game.setOffset(offset)
      }
      // 움직이는 쪽을 바라본다. 멈추면 마지막 방향을 유지
      if (dir !== 0 || side !== 0) facing.current = Math.atan2(-side, dir)
      // 앞으로 걸어서 이정표를 처음 지나면 도착 알림
      const cps = trail.data.checkpoints
      let reached = game.reachedCheckpoint
      while (reached + 1 < cps.length && distance >= cps[reached + 1].distance) reached++
      if (reached > game.reachedCheckpoint) game.reachCheckpoint(reached)
      if (distance >= trail.length - 0.5) {
        const startedAt = game.startedAt ?? Date.now()
        game.reachSummit({
          trailId: trail.data.id,
          finishedAt: new Date().toISOString(),
          durationSec: Math.round((Date.now() - startedAt) / 1000),
        })
      }
    }

    // 2) 점프 (사진 찍는 동안은 땅에 붙여 둔다)
    const j = jump.current
    if (input.jump) {
      input.jump = false
      if (j.height === 0 && game.mode !== 'photo') j.velocity = JUMP_SPEED
    }
    if (game.mode === 'photo') {
      j.height = 0
      j.velocity = 0
    } else if (j.height > 0 || j.velocity > 0) {
      j.height += j.velocity * dt
      j.velocity -= GRAVITY * dt
      if (j.height <= 0) {
        j.height = 0
        j.velocity = 0
      }
    }

    // 3) 아바타 배치: 등산로 위 점에서 오른쪽으로 offset 만큼 비키고 높이는 지형에서 읽는다
    const heading = trail.headingAt(distance)
    const pos = trail.positionAt(distance)
    if (offset !== 0) {
      pos.x += -Math.cos(heading) * offset
      pos.z += Math.sin(heading) * offset
      pos.y = sampleHeight(terrain, pos.x, pos.z)
    }
    hiker.current.group.position.copy(pos).setY(pos.y + j.height)
    hiker.current.group.rotation.y = heading + facing.current
    hiker.current.setCheering(game.mode !== 'hiking')
    hiker.current.setAirborne(j.height > 0)

    // 그림자가 아바타 주변에서 선명하도록 태양을 따라 옮김
    sun.current.position.copy(pos).addScaledVector(SUN, 300)
    sun.current.target.position.copy(pos)
    sun.current.target.updateMatrixWorld()

    // 카메라와 아바타 사이에 낀 나무·바위를 비울 기준점 (아바타 가슴 높이)
    occlusionUniforms.uOccTarget.value.copy(hiker.current.group.position).setY(hiker.current.group.position.y + 1.2)

    // 4) 카메라 (점프해도 흔들리지 않게 땅 높이 기준)
    if (game.mode === 'photo') {
      // 카메라는 오르막 쪽, 아바타는 카메라를 바라봄 → 트인 풍경이 배경
      const d = vista
      hiker.current.group.rotation.y = Math.atan2(-d.x, -d.z)
      camera.position.copy(pos).addScaledVector(d, -6).setY(pos.y + 3)
      camera.lookAt(pos.x + d.x * 2, pos.y + 1.2, pos.z + d.z * 2)
      occlusionUniforms.uOccCamera.value.copy(camera.position)
      // 카메라가 자리 잡고 몇 프레임 그린 뒤 촬영 (방금 그린 프레임을 복사)
      if (++photoFrames.current === 3) {
        useGame.getState().setPhoto(composePhoto(gl.domElement, trail.data))
      }
      return
    }
    photoFrames.current = 0

    // 아바타를 따라가되, 마우스로 돌려 본 각도는 유지
    const target = pos.clone().setY(pos.y + 1.5)
    const delta = target.clone().sub(lastTarget.current)
    camera.position.add(delta)
    controls.current.target.copy(target)
    lastTarget.current.copy(target)
    controls.current.update()
    occlusionUniforms.uOccCamera.value.copy(camera.position)
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
      <Terrain terrain={terrain} trail={trail} />
      <Forest terrain={terrain} trail={trail} />
      <Rocks terrain={terrain} trail={trail} />
      <TrailDetails terrain={terrain} trail={trail} />
      <SummitFlag trail={trail} />
      <Signposts trail={trail} />
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
