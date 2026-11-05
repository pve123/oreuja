import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Sky } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { meshHeight, sampleHeight, type Terrain as TerrainData, type Trail } from '../lib/data'
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
import { PHOTO_CAMERA_BACK, summitVista } from '../lib/summit'
import { AVATARS, type AvatarKind } from '../lib/avatars'
import { playJump, playStep, setAmbience, type Surface } from '../lib/sound'
import { localPlayer } from '../lib/net'
import { Peers } from './Peers'

const WALK_SPEED = 6 // m/s (게임 속도: 실제의 약 5배)
const RUN_SPEED = 15
const STRAFE_SPEED = 3 // 옆걸음 m/s
const STRAFE_RUN_SPEED = 7
/** 등산로에서 이만큼 넘게 멀어지면 등산로 위로 순간이동한다 (m) */
export const ROAM_LIMIT = 30
const TURN_SPEED = 1.8 // Q/E 시점 회전 속도(rad/s)
const FOLLOW_RATE = 2.2 // 카메라가 캐릭터 뒤로 돌아가는 빠르기 (클수록 빨리)
const MANUAL_HOLD_MS = 2000 // Q/E 로 돌린 뒤 이 시간 동안은 자동으로 돌지 않는다
const JUMP_SPEED = 5.5 // m/s, 약 1m 높이까지 뛴다
const GRAVITY = 15 // m/s², 실제(9.8)보다 세게 해서 경쾌하게
const SUN = new THREE.Vector3(-0.5, 0.55, 0.65).normalize() // 남서쪽 하늘의 해
/** Hiker 걸음 주기와 같게: 1m 에 2.2 라디안, 반 바퀴(π)마다 한 발 */
const STEP_PHASE_PER_M = 2.2

type Props = { terrain: TerrainData; trail: Trail }

/** from 에서 to 까지 땅에 가리지 않고 보이는지 (선분 위 몇 점의 지형 높이를 잰다) */
function clearView(terrain: TerrainData, from: THREE.Vector3, to: THREE.Vector3) {
  const p = new THREE.Vector3()
  for (let k = 1; k < 12; k++) {
    p.lerpVectors(from, to, k / 12)
    if (meshHeight(terrain, p.x, p.z) > p.y - 0.6) return false // 땅과 시선 사이 0.6m 여유
  }
  return true
}

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
  const avatar = useGame((s) => s.avatar)
  const gl = useThree((s) => s.gl)
  const lastTarget = useRef(new THREE.Vector3())
  const photoFrames = useRef(0)
  /** 점프: 땅에서 떠 있는 높이(m)와 위쪽 속도(m/s) */
  const jump = useRef({ height: 0, velocity: 0 })
  /** 등산로 진행 방향 기준으로 아바타가 바라보는 각도 (0 = 정면) */
  const facing = useRef(0)
  /** Q/E 로 마지막으로 시점을 직접 돌린 시각 */
  const manualTurnAt = useRef(0)
  /** 다음 발소리까지 남은 걸음 주기와 산속 소리를 마지막으로 맞춘 시각 */
  const footstep = useRef({ phase: 0, ambienceAt: 0 })

  // 발소리 바닥: 위문부터는 바위, 그 전 가파른 곳은 돌계단, 나머지는 흙길
  const gate = useMemo(() => trail.data.checkpoints.find((cp) => cp.name.includes('위문'))?.distance ?? Infinity, [trail])
  const surfaceAt = (d: number, offset: number): Surface => {
    if (Math.abs(offset) > 1.5) return 'dirt'
    if (d >= gate) return 'rock'
    const slope = Math.abs(trail.positionAt(d + 2).y - trail.positionAt(d - 2).y) / 4
    return slope >= 0.3 ? 'step' : 'dirt'
  }

  // 정상에서 가장 낮게 트인 방향 (기념사진 배경으로 쓸 풍경 쪽)
  const vista = useMemo(() => summitVista(terrain, trail), [terrain, trail])

  // 처음 카메라 위치: 출발점 뒤쪽 위
  useEffect(() => {
    // 개발 중에는 ?d=1700 처럼 중간 지점부터 시작해 확인할 수 있다
    const debugStart = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('d')) || 0 : 0
    if (debugStart) useGame.getState().setDistance(Math.min(debugStart, trail.length))
    // ?avatar=duck 처럼 주면 그 캐릭터로 시작한다
    const debugAvatar = import.meta.env.DEV ? new URLSearchParams(location.search).get('avatar') : null
    if (debugAvatar && AVATARS.some((a) => a.kind === debugAvatar)) useGame.getState().setAvatar(debugAvatar as AvatarKind)
    // ?o=12 처럼 주면 등산로에서 옆으로 비킨 곳에서 시작한다
    const debugOffset = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('o')) || 0 : 0
    if (debugOffset) useGame.getState().setOffset(THREE.MathUtils.clamp(debugOffset, -ROAM_LIMIT, ROAM_LIMIT))
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
    const before = { distance, offset }
    let walkingAlong = false // 이번 프레임에 앞뒤로 걸었는지 (카메라 자동 따라 돌기에 쓴다)

    // 1) 이동: 앞뒤는 등산로를 따라, 옆은 자유롭게. 등산로에서 ROAM_LIMIT 넘게 멀어지면 등산로로 순간이동
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
        const next = offset + side * speed * dt
        if (Math.abs(next) > ROAM_LIMIT) {
          offset = 0
          game.returnToTrail()
        } else {
          hiker.current.stride(next - offset)
          offset = next
          game.setOffset(offset)
        }
      }
      // 움직이는 쪽을 바라본다. 멈추면 마지막 방향을 유지
      if (dir !== 0 || side !== 0) facing.current = Math.atan2(-side, dir)
      walkingAlong = dir !== 0
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
      if (j.height === 0 && game.mode !== 'photo') {
        j.velocity = JUMP_SPEED
        playJump()
      }
    }
    // 발소리: 땅에 붙어 걸은 거리만큼 걸음 주기를 돌리고 반 바퀴마다 한 발
    if (j.height === 0) {
      const moved = Math.abs(distance - before.distance) + Math.abs(offset - before.offset)
      const fs = footstep.current
      fs.phase += moved * STEP_PHASE_PER_M
      if (fs.phase >= Math.PI) {
        fs.phase %= Math.PI
        playStep(surfaceAt(distance, offset), input.run)
      }
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
    // 같이하기 서버로 보낼 내 상태
    Object.assign(localPlayer, {
      course: trail.data.id,
      avatar: game.avatar,
      distance,
      offset,
      facing: facing.current,
      jump: j.height,
      mode: game.mode,
    })

    // 산속 소리: 1초에 한 번, 높이 올라갈수록 바람이 세지고 새소리는 줄어든다
    const now0 = performance.now()
    if (now0 - footstep.current.ambienceAt > 1000) {
      footstep.current.ambienceAt = now0
      setAmbience((pos.y - terrain.minHeight) / (terrain.maxHeight - terrain.minHeight))
    }

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
      // 정상부 바위 둔덕이 아바타 발끝을 가리면 몸 전체가 보일 때까지 카메라를 올린다
      const feet = new THREE.Vector3(pos.x, pos.y + 0.2, pos.z)
      const shot = pos.clone().addScaledVector(d, -PHOTO_CAMERA_BACK).setY(pos.y + 3)
      for (let lift = 0; lift < 20 && !clearView(terrain, shot, feet); lift++) shot.y += 0.5
      camera.position.copy(shot)
      camera.lookAt(pos.x + d.x * 2, pos.y + 1.2, pos.z + d.z * 2)
      occlusionUniforms.uOccCamera.value.copy(camera.position)
      // 카메라가 자리 잡고 몇 프레임 그린 뒤 촬영 (방금 그린 프레임을 복사)
      if (++photoFrames.current === 3) {
        useGame.getState().setPhoto(composePhoto(gl.domElement, trail.data))
      }
      return
    }
    photoFrames.current = 0

    // 아바타를 따라가되, 지금 보는 각도는 유지
    const target = pos.clone().setY(pos.y + 1.5)
    const delta = target.clone().sub(lastTarget.current)
    camera.position.add(delta)

    // 시점 돌리기: Q/E 는 직접 돌리고, 앞뒤로 걸을 때는 캐릭터 뒤쪽으로 부드럽게 돌아간다
    const off = camera.position.clone().sub(target)
    const horizontal = Math.hypot(off.x, off.z)
    let azimuth = Math.atan2(off.x, off.z)
    const turn = (input.turnRight ? 1 : 0) - (input.turnLeft ? 1 : 0)
    const now = performance.now()
    if (turn !== 0) {
      azimuth += turn * TURN_SPEED * dt
      manualTurnAt.current = now
    } else if (walkingAlong && now - manualTurnAt.current > MANUAL_HOLD_MS) {
      const behind = heading + facing.current + Math.PI // 캐릭터가 보는 방향의 반대편
      const diff = Math.atan2(Math.sin(behind - azimuth), Math.cos(behind - azimuth)) // 가까운 쪽으로 돈다
      azimuth += diff * (1 - Math.exp(-FOLLOW_RATE * dt))
    }
    camera.position.set(target.x + Math.sin(azimuth) * horizontal, camera.position.y, target.z + Math.cos(azimuth) * horizontal)

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
      <SummitFlag terrain={terrain} trail={trail} />
      <Signposts trail={trail} />
      <Hiker ref={hiker} kind={avatar} />
      <Peers terrain={terrain} trail={trail} />
      <OrbitControls
        ref={controls}
        makeDefault
        enablePan={false}
        minDistance={4}
        maxDistance={400}
        maxPolarAngle={Math.PI * 0.49}
        // 시점은 자동 따라 돌기와 Q/E 로만 바꾼다. 마우스는 휠 확대·축소만
        enableRotate={false}
      />
    </>
  )
}
