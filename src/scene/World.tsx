import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Sky } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { meshHeight, type Terrain as TerrainData, type Trail } from '../lib/data'
import { input, useGame } from '../lib/store'
import { Terrain } from './Terrain'
import { SummitFlag } from './SummitFlag'
import { Forest } from './Forest'
import { Landmarks } from './Landmarks'
import { TrailDetails } from './TrailDetails'
import { Rocks } from './Rocks'
import { Avatar } from './Avatar'
import type { HikerHandle } from './Hiker'
import { composePhoto } from '../lib/photo'
import { occlusionUniforms } from '../lib/occlusion'
import { PHOTO_CAMERA_BACK, summitVista } from '../lib/summit'
import { AVATARS, type AvatarKind } from '../lib/avatars'
import { playJump, playStep, setAmbience, type Surface } from '../lib/sound'
import { resolveCollision } from '../lib/obstacles'
import { groundAt, stoneSteps } from '../lib/steps'
import { localPlayer } from '../lib/net'
import { Peers } from './Peers'

const WALK_SPEED = 6 // m/s (게임 속도: 실제의 약 5배)
const RUN_SPEED = 15
const BACK_SPEED = 3 // ↓ 로 뒤로 물러나는 빠르기 m/s
const BACK_RUN_SPEED = 6
/**
 * 길 밖 자유롭게 걷기의 경계 (오픈월드 게임의 부드러운 경계처럼).
 * ROAM_SOFT 부터 바깥쪽 걸음이 점점 느려지고 화면 가장자리가 어두워지며, ROAM_LIMIT 에서는 더 나가지 못하고 경계를 따라 미끄러진다.
 */
const ROAM_SOFT = 12
export const ROAM_LIMIT = 20
/** 경계에 닿을 때 바깥쪽 걸음 빠르기가 이만큼으로 줄어든다 */
const ROAM_EDGE_SPEED = 0.25
/** 캐릭터 몸 반지름(m). 나무 줄기·바위·건물과 이만큼 떨어진다 */
const BODY_RADIUS = 0.35
/** 계단에 들어서거나 나올 때 높이 차를 메우는 빠르기. 클수록 빠르게 (약 0.1초) */
const STEP_SNAP = 24
/** 오르막 계단에서는 이만큼 느리게 걷는다 */
const STAIR_UP_SPEED = 0.8
/** 카메라 높이가 캐릭터 높이를 따라가는 빠르기. 계단에서 카메라가 덜컹거리지 않게 몸보다 느리게 */
const CAMERA_Y_RATE = 6
const TURN_SPEED = 3.6 // ←/→ 로 몸을 돌리는 빠르기(rad/s), 1초에 약 200도
/** 카메라와 캐릭터 가슴 사이 거리(m). 첫 화면은 가장 가까이에서 시작한다 */
const CAMERA_MIN_DISTANCE = 4
/**
 * 휠로 멀어질 수 있는 거리(m). 3인칭 게임은 보통 캐릭터 키의 몇 배 안쪽에서만 멀어지게 한다.
 * 더 멀면 캐릭터가 점이 되어 지도를 보는 느낌이 된다
 */
const CAMERA_MAX_DISTANCE = 15
/** 카메라가 땅 위로 떠 있어야 하는 높이(m). 마우스로 돌리다 비탈 속으로 들어가지 않게 */
const CAMERA_GROUND_CLEARANCE = 0.8
/** 첫 화면에서 카메라가 캐릭터를 내려다보는 각도 */
const CAMERA_PITCH = THREE.MathUtils.degToRad(22)
const FOLLOW_RATE = 5 // 카메라가 캐릭터 등 뒤로 돌아가는 빠르기 (클수록 빨리)
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
  /** 마우스로 카메라를 돌려 둘러보는 중. 다시 걷거나 몸을 돌리면 등 뒤로 돌아간다 */
  const freeLook = useRef(false)
  const photoFrames = useRef(0)
  /** 점프: 땅에서 떠 있는 높이(m)와 위쪽 속도(m/s) */
  const jump = useRef({ height: 0, velocity: 0 })
  /** 등산로 진행 방향 기준으로 아바타가 바라보는 각도 (0 = 정면). 같이하기 서버로 보낸다 */
  const facing = useRef(0)
  /**
   * 내 수평 위치와 몸이 보는 방향(라디안, 0 = +z 쪽). 지형 위를 자유롭게 걷고,
   * 등산로 진행 거리(distance)와 옆으로 비킨 거리(offset)는 여기서 계산해 store 에 넣는다.
   * synced 는 마지막으로 store 에 넣은 값이다. store 값이 이와 다르면(처음, 코스 바꾸기, 다시 오르기,
   * 등산로로 순간이동) 그 자리로 옮긴다.
   */
  const body = useRef({ x: 0, z: 0, yaw: 0, synced: { distance: NaN, offset: NaN } })
  /** 다음 발소리까지 남은 걸음 주기와 산속 소리를 마지막으로 맞춘 시각 */
  const footstep = useRef({ phase: 0, ambienceAt: 0 })
  /** 계단: 마지막으로 밟은 칸 번호(-1 은 땅), 계단 판정 안에 있었는지, 이어 붙이는 중 남은 높이 차(m), 마지막으로 그린 높이 */
  const stair = useRef({ index: -1, on: false, lag: 0, y: NaN })
  /** 카메라가 바라보는 높이 (계단에서 덜컹거리지 않게 따로 부드럽게 따라간다) */
  const cameraY = useRef(NaN)
  const steps = useMemo(() => stoneSteps(terrain, trail), [terrain, trail])

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
    // 캐릭터 등 뒤 가장 가까운 거리에서, 어깨 너머로 조금 내려다보며 시작한다
    const back = Math.cos(CAMERA_PITCH) * CAMERA_MIN_DISTANCE
    const up = Math.sin(CAMERA_PITCH) * CAMERA_MIN_DISTANCE
    lastTarget.current.copy(start).setY(start.y + 1.5)
    camera.position.set(start.x - Math.sin(h) * back, lastTarget.current.y + up, start.z - Math.cos(h) * back)
    controls.current.target.copy(lastTarget.current)
    controls.current.update()
  }, [camera, trail])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const game = useGame.getState()
    let { distance, offset } = game
    const before = { distance, offset }
    const b = body.current
    if (distance !== b.synced.distance || offset !== b.synced.offset) {
      const h = trail.headingAt(distance)
      const p = trail.positionAt(distance)
      b.x = p.x - Math.cos(h) * offset
      b.z = p.z + Math.sin(h) * offset
      b.yaw = h
    }

    // 1) 이동: ←/→ 로 몸을 돌리고 ↑ 로 보는 쪽으로, ↓ 로 뒤로 걷는다.
    //    나무·바위·건물에 부딪히면 둘레를 따라 미끄러지고, 등산로에서 멀어질수록 바깥쪽 걸음이 느려지다 ROAM_LIMIT 에서 멈춘다
    if (game.mode === 'hiking') {
      const turn = (input.left ? 1 : 0) - (input.right ? 1 : 0) // yaw 가 커지면 왼쪽으로 돈다
      const move = (input.forward ? 1 : 0) - (input.backward ? 1 : 0)
      b.yaw += turn * TURN_SPEED * dt
      const startX = b.x
      const startZ = b.z
      if (move !== 0) {
        let speed = move > 0 ? (input.run ? RUN_SPEED : WALK_SPEED) : input.run ? BACK_RUN_SPEED : BACK_SPEED
        const dx = Math.sin(b.yaw) * move
        const dz = Math.cos(b.yaw) * move
        // 오르막 계단은 조금 느리게
        if (stair.current.index >= 0) {
          const ahead = trail.positionAt(distance + 1).y - trail.positionAt(distance).y
          const along = dx * Math.sin(trail.headingAt(distance)) + dz * Math.cos(trail.headingAt(distance))
          if (ahead * along > 0) speed *= STAIR_UP_SPEED
        }
        // 등산로에서 멀어지는 쪽 걸음은 경계에 가까울수록 느리게
        const p0 = trail.positionAt(distance)
        const ox = b.x - p0.x
        const oz = b.z - p0.z
        const away0 = Math.hypot(ox, oz)
        if (away0 > ROAM_SOFT && ox * dx + oz * dz > 0) {
          speed *= THREE.MathUtils.lerp(1, ROAM_EDGE_SPEED, THREE.MathUtils.smoothstep(away0, ROAM_SOFT, ROAM_LIMIT))
        }
        const step = speed * dt
        b.x += dx * step
        b.z += dz * step
      }
      // 장애물 밖으로 밀어낸다 (점프 중이면 낮은 바위는 넘어간다)
      const pushed = resolveCollision(b.x, b.z, BODY_RADIUS, jump.current.height)
      b.x = pushed.x
      b.z = pushed.z

      // 등산로 기준 값으로 바꾼다
      distance = trail.nearestDistance(b.x, b.z, distance)
      const h = trail.headingAt(distance)
      const p = trail.positionAt(distance)
      const away = Math.hypot(b.x - p.x, b.z - p.z)
      if (away > ROAM_LIMIT) {
        // 보이지 않는 벽: 경계 원 위로 되돌려 경계를 따라 미끄러지게 한다
        b.x = p.x + ((b.x - p.x) / away) * ROAM_LIMIT
        b.z = p.z + ((b.z - p.z) / away) * ROAM_LIMIT
      }
      offset = (b.x - p.x) * -Math.cos(h) + (b.z - p.z) * Math.sin(h)
      if (offset !== game.offset) game.setOffset(offset)
      const roam = Math.round(THREE.MathUtils.smoothstep(Math.min(away, ROAM_LIMIT), ROAM_SOFT, ROAM_LIMIT) * 20) / 20
      if (roam !== game.roam) game.setRoam(roam)

      // 실제로 움직인 만큼 걸음 동작을 돌린다 (벽에 막히면 제자리걸음을 하지 않게). 제자리에서 돌 때도 발을 조금 뗀다
      const moved = Math.hypot(b.x - startX, b.z - startZ)
      if (move !== 0 && moved > 1e-4) hiker.current.stride(moved * Math.sign(move))
      else if (turn !== 0) hiker.current.stride(TURN_SPEED * dt * 0.3)
      if (distance !== game.distance) game.setDistance(distance)
      facing.current = b.yaw - h
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
    // 발소리: 계단에서는 한 칸 디딜 때마다, 그 밖에는 땅에 붙어 걸은 거리만큼 걸음 주기를 돌려 반 바퀴마다 한 발
    const footing = groundAt(terrain, trail, steps, distance, offset, b.x, b.z)
    const onStep = footing.step
    if (onStep && j.height === 0) {
      if (onStep.index !== stair.current.index && onStep.index >= 0) playStep('step', input.run)
      footstep.current.phase = 0
    } else if (j.height === 0) {
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
    b.synced.distance = distance
    b.synced.offset = offset
    const pos = new THREE.Vector3(b.x, 0, b.z)
    // 등산로·돌계단·지형 높이 (lib/steps 의 groundAt)
    const groundY = footing.y
    // 계단 위 높이는 stairAt 이 걸은 거리에 맞춰 칸마다 올려 주고, 계단 드나들 때도 이어 준다.
    // 계단 옆으로 비켜 나갈 때처럼 그래도 높이가 끊기면 그 차를 짧게 이어 붙인다 (순간이동·코스 바꾸기처럼 크게 끊기면 바로 옮긴다)
    const st = stair.current
    const stepIndex = onStep ? onStep.index : -1
    if (!!onStep !== st.on) {
      // 바로 앞 프레임에 딛던 높이(st.y - st.lag)와 지금 높이의 차를 이어 붙인다
      const jumpBy = Number.isNaN(st.y) ? Infinity : st.y - st.lag - groundY
      st.lag = Math.abs(jumpBy) > 3 ? 0 : st.lag + jumpBy
      st.on = !!onStep
    }
    st.index = stepIndex
    st.lag *= Math.exp(-STEP_SNAP * dt)
    pos.y = groundY + st.lag
    st.y = pos.y
    hiker.current.group.position.copy(pos).setY(pos.y + j.height)
    hiker.current.group.rotation.y = b.yaw
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
    // 바라보는 높이는 몸보다 느리게 따라가, 계단을 오를 때 화면이 덜컹거리지 않게 한다
    if (Number.isNaN(cameraY.current) || Math.abs(cameraY.current - pos.y) > 3) cameraY.current = pos.y
    cameraY.current += (pos.y - cameraY.current) * (1 - Math.exp(-CAMERA_Y_RATE * dt))
    const target = pos.clone().setY(cameraY.current + 1.5)
    const delta = target.clone().sub(lastTarget.current)
    camera.position.add(delta)

    // 카메라는 캐릭터 등 뒤로 부드럽게 돌아간다. 마우스로 둘러보는 중이면 그 자리에 두고, 다시 걷거나 몸을 돌리면 따라간다
    if (input.forward || input.backward || input.left || input.right) freeLook.current = false
    if (!freeLook.current) {
      const off = camera.position.clone().sub(target)
      const horizontal = Math.hypot(off.x, off.z)
      let azimuth = Math.atan2(off.x, off.z)
      const behind = b.yaw + Math.PI
      azimuth += Math.atan2(Math.sin(behind - azimuth), Math.cos(behind - azimuth)) * (1 - Math.exp(-FOLLOW_RATE * dt)) // 가까운 쪽으로 돈다
      camera.position.set(target.x + Math.sin(azimuth) * horizontal, camera.position.y, target.z + Math.cos(azimuth) * horizontal)
    }

    controls.current.target.copy(target)
    lastTarget.current.copy(target)
    controls.current.update()
    // 비탈 쪽에서 낮게 돌리면 카메라가 땅속으로 들어가므로 땅 위로 올린다
    const ground = meshHeight(terrain, camera.position.x, camera.position.z) + CAMERA_GROUND_CLEARANCE
    if (camera.position.y < ground) camera.position.setY(ground)
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
      <Landmarks terrain={terrain} trail={trail} />
      <Avatar ref={hiker} kind={avatar} />
      <Peers terrain={terrain} trail={trail} />
      <OrbitControls
        ref={controls}
        makeDefault
        enablePan={false}
        minDistance={CAMERA_MIN_DISTANCE}
        maxDistance={CAMERA_MAX_DISTANCE}
        // 바로 위에서 내려다보면 지도처럼 보이므로 너무 눕히지도 세우지도 않는다
        minPolarAngle={Math.PI * 0.2}
        maxPolarAngle={Math.PI * 0.49}
        // 마우스로 끌면 캐릭터 둘레를 돌아 정면도 볼 수 있다. 걷기 시작하면 다시 등 뒤로 따라간다
        rotateSpeed={0.6}
        onStart={() => {
          freeLook.current = true
        }}
      />
    </>
  )
}
