import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Sky } from '@react-three/drei'
import { Physics, useRapier, type RapierCollider } from '@react-three/rapier'
import { BrightnessContrast, EffectComposer, HueSaturation, SSAO, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { meshHeight, standHeight, type Terrain as TerrainData, type Trail } from '../lib/data'
import { input, useGame } from '../lib/store'
import { Terrain } from './Terrain'
import { SummitFlag } from './SummitFlag'
import { Forest } from './Forest'
import { Landmarks } from './Landmarks'
import { TrailDetails } from './TrailDetails'
import { Rocks } from './Rocks'
import { Avatar } from './Avatar'
import { Colliders } from './Colliders'
import { cameraBlockers } from '../lib/obstacles'
import type { HikerHandle } from './Hiker'
import { composePhoto } from '../lib/photo'
import { occlusionUniforms } from '../lib/occlusion'
import { PHOTO_CAMERA_BACK, summitVista } from '../lib/summit'
import { AVATARS, type AvatarKind } from '../lib/avatars'
import { playJump, playStep, setAmbience, type Surface } from '../lib/sound'
import { STAIR_HALF_WIDTH, groundAt, stairAt, stoneSteps, trailGround } from '../lib/steps'
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

/**
 * 캐릭터 컨트롤러 (Unity CharacterController·Unreal CharacterMovement 와 같은 방식).
 * 몸은 캡슐이고, 부딪히면 미끄러지며, 낮은 턱은 자동으로 오르고, 내리막에서는 땅에 붙는다.
 */
const BODY_RADIUS = 0.35
/** 캡슐 가운데 원기둥 반높이(m). 키 = 2 × (반높이 + 반지름) = 1.8m */
const BODY_HALF_HEIGHT = 0.55
/** 발바닥에서 캡슐 가운데까지 높이 */
const BODY_CENTER = BODY_HALF_HEIGHT + BODY_RADIUS
/** 충돌체와 띄워 두는 틈(m). 너무 작으면 걸리고 크면 떠 보인다 */
const SKIN = 0.02
/** 이 높이까지의 턱은 걸어서 오른다(m). Unreal 기본 45cm 와 비슷하게 */
const AUTOSTEP_HEIGHT = 0.45
/** 내리막에서 이 거리 안이면 땅에 붙여 통통 튀지 않게(m) */
const SNAP_TO_GROUND = 0.6
/**
 * 이보다 가파른 비탈은 오르지 못하고 미끄러진다. Unity·Unreal 기본은 45° 안팎이지만 북한산 등산로가 가팔라서 넉넉히 둔다.
 * 코스 4개를 Rapier 로 끝까지 걸어 본 시험에서 55° 는 계단 옆·급경사에서 막히는 곳이 남았고 60° 는 0곳이었다
 */
const MAX_SLOPE = THREE.MathUtils.degToRad(60)

/** 계단 모습(디딤판)과 물리 경사로의 높이 차를 몸 그림에 얹는 빠르기. 클수록 바로 붙는다 */
const STEP_VISUAL_RATE = 30
/** 오르막 계단에서는 이만큼 느리게 걷는다 */
const STAIR_UP_SPEED = 0.8
/** 카메라 높이가 캐릭터 높이를 따라가는 빠르기. 계단에서 카메라가 덜컹거리지 않게 몸보다 느리게 */
const CAMERA_Y_RATE = 6
const TURN_SPEED = 3.6 // ←/→ 로 몸을 돌리는 빠르기(rad/s), 1초에 약 200도
/** 카메라와 캐릭터 가슴 사이 가장 가까운 거리(m) */
const CAMERA_MIN_DISTANCE = 4
/** 첫 화면 카메라 거리(m). 캐릭터 온몸과 앞길이 함께 보이게 가장 가까운 거리보다 조금 떨어져 시작한다 */
const CAMERA_START_DISTANCE = 7
/**
 * 휠로 멀어질 수 있는 거리(m). 3인칭 게임은 보통 캐릭터 키의 몇 배 안쪽에서만 멀어지게 한다.
 * 더 멀면 캐릭터가 점이 되어 지도를 보는 느낌이 된다
 */
const CAMERA_MAX_DISTANCE = 15
/** 휠 한 칸에 바뀌는 거리 비율 */
const ZOOM_STEP = 1.12
/**
 * 스프링 암 (Unreal SpringArm 과 같은 방식): 캐릭터에서 카메라 쪽으로 레이를 쏴 지형·건물에 막히면 그 앞으로 당긴다.
 * 막히면 바로 당기고, 풀리면 천천히 원래 거리로 돌아간다.
 */
const CAMERA_PROBE_MARGIN = 0.3
const CAMERA_MIN_ARM = 1.2
const CAMERA_RELEASE_RATE = 3
/** 첫 화면에서 카메라가 캐릭터를 내려다보는 각도 */
const CAMERA_PITCH = THREE.MathUtils.degToRad(22)
const FOLLOW_RATE = 5 // 카메라가 캐릭터 등 뒤로 돌아가는 빠르기 (클수록 빨리)
const JUMP_SPEED = 5.5 // m/s, 약 1m 높이까지 뛴다
const GRAVITY = 15 // m/s², 실제(9.8)보다 세게 해서 경쾌하게
/** 땅에 서 있을 때도 아래로 살짝 눌러 비탈에서 뜨지 않게 (m/s) */
const GROUND_STICK = 2
/** 발이 땅보다 이만큼 아래로 내려가면 바닥을 뚫은 것으로 보고 땅 위로 올린다(m) */
const FALL_RESCUE = 0.5
/** 이 시간보다 오래 땅에서 떨어져 있으면 공중 동작으로 바꾼다(s). 턱을 내려설 때마다 다리를 접지 않게 */
const AIRBORNE_AFTER = 0.12
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

/**
 * 화면 후처리. 잘 만든 게임처럼 물체가 땅·서로 닿는 곳에 그늘을 넣어(앰비언트 오클루전) 돌·계단·나무가 떠 보이지 않게 하고,
 * 색을 조금 다듬은 뒤 가장자리를 살짝 어둡게 한다. 톤 매핑은 렌더러 대신 맨 끝에서 한 번 한다 (App 의 Canvas 는 NoToneMapping).
 */
function PostEffects() {
  return (
    // SSAO 는 법선 버퍼가 필요하다. (N8AO 2.0.1 은 three 0.187 에서 렌더 타깃 오류가 나서 postprocessing 의 SSAO 를 쓴다)
    <EffectComposer multisampling={4} enableNormalPass>
      <SSAO
        samples={16}
        rings={4}
        radius={0.06}
        intensity={9}
        luminanceInfluence={0.5}
        // 거리는 m 단위로 잰다: 캐릭터 둘레 40m 안에서만 진하게, 0.5m 안쪽 틈에 그늘을 넣는다
        worldDistanceThreshold={40}
        worldDistanceFalloff={10}
        worldProximityThreshold={0.5}
        worldProximityFalloff={0.2}
      />
      <HueSaturation saturation={0.08} />
      <BrightnessContrast contrast={0.06} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.3} darkness={0.45} />
    </EffectComposer>
  )
}

/** 물리 세계(Rapier). 시뮬레이션할 물체는 없고 캐릭터 컨트롤러와 카메라 레이가 충돌체를 묻는 데만 쓴다 */
export function World(props: Props) {
  return (
    <Suspense fallback={null}>
      <Physics gravity={[0, 0, 0]} timeStep="vary">
        <Colliders terrain={props.terrain} trail={props.trail} />
        <WorldScene {...props} />
      </Physics>
    </Suspense>
  )
}

type Character = { collider: RapierCollider; controller: ReturnType<ReturnType<typeof useRapier>['world']['createCharacterController']> }

function WorldScene({ terrain, trail }: Props) {
  const hiker = useRef<HikerHandle>(null!)
  const controls = useRef<OrbitControlsImpl>(null!)
  const sun = useRef<THREE.DirectionalLight>(null!)
  const camera = useThree((s) => s.camera)
  const avatar = useGame((s) => s.avatar)
  const gl = useThree((s) => s.gl)
  const { world, rapier } = useRapier()
  const character = useRef<Character | null>(null)
  const lastTarget = useRef(new THREE.Vector3())
  /** 마우스로 카메라를 돌려 둘러보는 중. 다시 걷거나 몸을 돌리면 등 뒤로 돌아간다 */
  const freeLook = useRef(false)
  /** 휠로 고른 카메라 거리(arm)와 스프링 암이 실제로 보여 주는 거리(shown) */
  const zoom = useRef({ arm: CAMERA_START_DISTANCE, shown: CAMERA_START_DISTANCE })
  const photoFrames = useRef(0)
  /** 처음 몇 프레임을 그렸는지 (첫 화면을 걷어 낼 때를 정한다) */
  const drawnFrames = useRef(0)
  /** 등산로 진행 방향 기준으로 아바타가 바라보는 각도 (0 = 정면). 같이하기 서버로 보낸다 */
  const facing = useRef(0)
  /**
   * 내 발바닥 위치와 몸이 보는 방향(라디안, 0 = +z 쪽), 위쪽 속도, 땅에 붙어 있는지.
   * 등산로 진행 거리(distance)와 옆으로 비킨 거리(offset)는 여기서 계산해 store 에 넣는다.
   * synced 는 마지막으로 store 에 넣은 값이다. store 값이 이와 다르면(처음, 코스 바꾸기, 다시 오르기) 그 자리로 옮긴다.
   */
  const body = useRef({ x: 0, y: 0, z: 0, yaw: 0, vy: 0, grounded: true, airTime: 0, synced: { distance: NaN, offset: NaN } })
  /** 다음 발소리까지 남은 걸음 주기와 산속 소리를 마지막으로 맞춘 시각 */
  const footstep = useRef({ phase: 0, ambienceAt: 0 })
  /** 계단: 마지막으로 디딘 칸 번호(-1 은 땅), 몸 그림에 얹는 디딤판 높이 차(m) */
  const stair = useRef({ index: -1, visual: 0 })
  /** 카메라가 바라보는 높이 (계단에서 덜컹거리지 않게 따로 부드럽게 따라간다) */
  const cameraY = useRef(NaN)
  const steps = useMemo(() => stoneSteps(terrain, trail), [terrain, trail])
  const groundOfTrail = useMemo(() => trailGround(terrain, trail), [terrain, trail])

  // 캐릭터 캡슐과 컨트롤러. 몸에 리지드바디를 달지 않고 충돌체를 직접 옮긴다 (시뮬레이션할 일이 없다)
  useEffect(() => {
    const collider = world.createCollider(rapier.ColliderDesc.capsule(BODY_HALF_HEIGHT, BODY_RADIUS))
    const controller = world.createCharacterController(SKIN)
    controller.setUp({ x: 0, y: 1, z: 0 })
    controller.setSlideEnabled(true)
    controller.enableAutostep(AUTOSTEP_HEIGHT, 0.15, false)
    controller.enableSnapToGround(SNAP_TO_GROUND)
    controller.setMaxSlopeClimbAngle(MAX_SLOPE)
    controller.setMinSlopeSlideAngle(MAX_SLOPE)
    character.current = { collider, controller }
    // 다음 프레임에 지금 store 위치로 다시 놓는다
    body.current.synced.distance = NaN
    return () => {
      character.current = null
      world.removeCharacterController(controller)
      world.removeCollider(collider, false)
    }
  }, [world, rapier])

  // 휠 확대·축소는 직접 맡는다 (스프링 암이 당긴 거리를 OrbitControls 가 사용자가 고른 거리로 착각하지 않게)
  useEffect(() => {
    const el = gl.domElement
    const onWheel = (e: WheelEvent) => {
      const z = zoom.current
      z.arm = THREE.MathUtils.clamp(z.arm * (e.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP), CAMERA_MIN_DISTANCE, CAMERA_MAX_DISTANCE)
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => el.removeEventListener('wheel', onWheel)
  }, [gl])

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
    // 캐릭터 등 뒤 7m 에서, 어깨 너머로 조금 내려다보며 시작한다
    const back = Math.cos(CAMERA_PITCH) * CAMERA_START_DISTANCE
    const up = Math.sin(CAMERA_PITCH) * CAMERA_START_DISTANCE
    zoom.current.arm = zoom.current.shown = CAMERA_START_DISTANCE
    lastTarget.current.copy(start).setY(start.y + 1.5)
    camera.position.set(start.x - Math.sin(h) * back, lastTarget.current.y + up, start.z - Math.cos(h) * back)
    controls.current.target.copy(lastTarget.current)
    controls.current.update()
  }, [camera, trail])

  useFrame((_, rawDt) => {
    const ch = character.current
    if (!ch) return
    const dt = Math.min(rawDt, 0.1)
    const game = useGame.getState()
    let { distance, offset } = game
    const before = { distance, offset }
    const b = body.current
    if (distance !== b.synced.distance || offset !== b.synced.offset) {
      // 처음·코스 바꾸기·다시 오르기: 그 등산로 지점의 땅(또는 디딤판) 위에 놓는다
      const h = trail.headingAt(distance)
      const p = trail.positionAt(distance)
      b.x = p.x - Math.cos(h) * offset
      b.z = p.z + Math.sin(h) * offset
      b.y = groundAt(terrain, trail, steps, distance, offset, b.x, b.z).y + 0.05
      b.yaw = h
      b.vy = 0
      cameraY.current = NaN
    }

    // 1) 이동: ←/→ 로 몸을 돌리고 ↑ 로 보는 쪽으로, ↓ 로 뒤로 걷는다. 점프와 중력도 여기서.
    //    캐릭터 컨트롤러가 나무·바위·건물에 부딪히면 미끄러뜨리고, 낮은 턱은 오르고, 너무 가파른 비탈은 막는다.
    //    등산로에서 멀어질수록 바깥쪽 걸음이 느려지다 ROAM_LIMIT 에서 멈춘다
    let move = 0
    let turn = 0
    if (input.jump) {
      input.jump = false
      if (b.grounded && game.mode === 'hiking') {
        b.vy = JUMP_SPEED
        playJump()
      }
    }
    if (game.mode === 'hiking') {
      turn = (input.left ? 1 : 0) - (input.right ? 1 : 0) // yaw 가 커지면 왼쪽으로 돈다
      move = (input.forward ? 1 : 0) - (input.backward ? 1 : 0)
      b.yaw += turn * TURN_SPEED * dt
    }
    let dx = 0
    let dz = 0
    if (move !== 0) {
      let speed = move > 0 ? (input.run ? RUN_SPEED : WALK_SPEED) : input.run ? BACK_RUN_SPEED : BACK_SPEED
      const fx = Math.sin(b.yaw) * move
      const fz = Math.cos(b.yaw) * move
      // 오르막 계단은 조금 느리게
      if (stair.current.index >= 0) {
        const ahead = trail.positionAt(distance + 1).y - trail.positionAt(distance).y
        const along = fx * Math.sin(trail.headingAt(distance)) + fz * Math.cos(trail.headingAt(distance))
        if (ahead * along > 0) speed *= STAIR_UP_SPEED
      }
      // 등산로에서 멀어지는 쪽 걸음은 경계에 가까울수록 느리게
      const p0 = trail.positionAt(distance)
      const ox = b.x - p0.x
      const oz = b.z - p0.z
      const away0 = Math.hypot(ox, oz)
      if (away0 > ROAM_SOFT && ox * fx + oz * fz > 0) {
        speed *= THREE.MathUtils.lerp(1, ROAM_EDGE_SPEED, THREE.MathUtils.smoothstep(away0, ROAM_SOFT, ROAM_LIMIT))
      }
      dx = fx * speed * dt
      dz = fz * speed * dt
      // 경계 밖으로 나갈 걸음이면 바깥쪽 성분을 빼고 컨트롤러에 넘긴다. 위치를 나중에 억지로 되돌리면
      // 바깥이 내리막일 때 오르막 쪽 땅속으로 끌려 들어가 바닥 밑으로 빠진다
      const nx = ox + dx
      const nz = oz + dz
      const next = Math.hypot(nx, nz)
      if (next > ROAM_LIMIT) {
        const out = (dx * nx + dz * nz) / next
        if (out > 0) {
          dx -= (nx / next) * out
          dz -= (nz / next) * out
        }
      }
    }
    // 중력: 땅에 서 있으면 살짝 눌러 붙이고, 떠 있으면 떨어진다
    b.vy = b.grounded && b.vy <= 0 ? -GROUND_STICK : b.vy - GRAVITY * dt
    ch.collider.setTranslation({ x: b.x, y: b.y + BODY_CENTER, z: b.z })
    ch.controller.computeColliderMovement(ch.collider, { x: dx, y: b.vy * dt, z: dz })
    const m = ch.controller.computedMovement()
    const startX = b.x
    const startZ = b.z
    b.x += m.x
    b.y += m.y
    b.z += m.z
    b.grounded = ch.controller.computedGrounded()
    if (b.grounded && b.vy < 0) b.vy = -GROUND_STICK
    // 머리를 부딪히면 위로 가던 힘을 없앤다
    if (b.vy > 0 && m.y < b.vy * dt * 0.5) b.vy = 0
    b.airTime = b.grounded ? 0 : b.airTime + dt

    // 등산로 기준 값으로 바꾼다
    distance = trail.nearestDistance(b.x, b.z, distance)
    const h = trail.headingAt(distance)
    const p = trail.positionAt(distance)
    const away = Math.hypot(b.x - p.x, b.z - p.z)
    if (away > ROAM_LIMIT) {
      // 굽은 길에서 기준점이 바뀌며 조금 넘친 만큼만 경계 위로 되돌리고, 그 자리 땅보다 낮으면 올린다
      b.x = p.x + ((b.x - p.x) / away) * ROAM_LIMIT
      b.z = p.z + ((b.z - p.z) / away) * ROAM_LIMIT
      b.y = Math.max(b.y, standHeight(terrain, b.x, b.z))
    }
    // 안전망 (게임들의 '바닥 밑으로 떨어지면 되살리기'): 어떤 이유로든 땅보다 한참 아래면 그 자리 땅 위로 올린다
    if (b.y < meshHeight(terrain, b.x, b.z) - FALL_RESCUE) {
      b.y = standHeight(terrain, b.x, b.z) + 0.05
      b.vy = 0
    }
    ch.collider.setTranslation({ x: b.x, y: b.y + BODY_CENTER, z: b.z })
    offset = (b.x - p.x) * -Math.cos(h) + (b.z - p.z) * Math.sin(h)

    if (game.mode === 'hiking') {
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
    b.synced.distance = distance
    b.synced.offset = offset

    // 2) 계단 모습과 발소리. 물리는 매끈한 경사로를 걷고, 몸 그림만 칸마다 평평하게 딛는 높이로 얹는다
    const onStairs = b.grounded && Math.abs(offset) < STAIR_HALF_WIDTH
    const tread = onStairs ? stairAt(steps, distance, groundOfTrail) : null
    const ramp = tread ? stairAt(steps, distance, groundOfTrail, 'ramp') : null
    const st = stair.current
    const visualTarget = tread && ramp ? tread.y - ramp.y : 0
    st.visual += (visualTarget - st.visual) * (1 - Math.exp(-STEP_VISUAL_RATE * dt))
    if (b.grounded) {
      if (tread && tread.index >= 0) {
        if (tread.index !== st.index) playStep('step', input.run)
        footstep.current.phase = 0
      } else {
        const moved = Math.abs(distance - before.distance) + Math.abs(offset - before.offset)
        const fs = footstep.current
        fs.phase += moved * STEP_PHASE_PER_M
        if (fs.phase >= Math.PI) {
          fs.phase %= Math.PI
          playStep(surfaceAt(distance, offset), input.run)
        }
      }
    }
    st.index = tread ? tread.index : -1

    // 3) 아바타 배치
    const pos = new THREE.Vector3(b.x, b.y + st.visual, b.z)
    // 떠 있는 높이 (같이하기 친구 화면에서 점프로 보인다)
    const lift = Math.max(0, b.y - standHeight(terrain, b.x, b.z))
    hiker.current.group.position.copy(pos)
    hiker.current.group.rotation.y = b.yaw
    hiker.current.setCheering(game.mode !== 'hiking')
    hiker.current.setAirborne(b.airTime > AIRBORNE_AFTER)
    // 같이하기 서버로 보낼 내 상태
    Object.assign(localPlayer, {
      course: trail.data.id,
      avatar: game.avatar,
      distance,
      offset,
      facing: facing.current,
      jump: b.airTime > AIRBORNE_AFTER ? lift : 0,
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
    occlusionUniforms.uOccTarget.value.copy(pos).setY(pos.y + 1.2)

    // 4) 카메라
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

    // 바라보는 높이는 몸보다 느리게 따라가, 계단을 오르거나 점프할 때 화면이 덜컹거리지 않게 한다 (점프는 더 느리게)
    // 처음·다시 오르기·코스 바꾸기로 자리를 옮겼으면 바로 맞춘다. 공중 높이 계산보다 먼저 해야 NaN 이 카메라에 섞이지 않는다
    if (Number.isNaN(cameraY.current) || Math.abs(cameraY.current - pos.y) > 3) cameraY.current = pos.y
    const lookY = b.airTime > 0 ? Math.min(pos.y, cameraY.current + 0.02) : pos.y
    cameraY.current += (lookY - cameraY.current) * (1 - Math.exp(-CAMERA_Y_RATE * dt))
    const target = new THREE.Vector3(pos.x, cameraY.current + 1.5, pos.z)
    // 안전망: 카메라 값이 한 번이라도 깨지면 다음 프레임에도 계속 깨진 채로 남아 화면이 비므로, 캐릭터 등 뒤로 다시 놓는다
    if (!Number.isFinite(camera.position.x + camera.position.y + camera.position.z + lastTarget.current.x + lastTarget.current.y + lastTarget.current.z)) {
      lastTarget.current.copy(target)
      camera.position.set(target.x - Math.sin(b.yaw) * CAMERA_START_DISTANCE, target.y + 2.5, target.z - Math.cos(b.yaw) * CAMERA_START_DISTANCE)
    }
    const delta = target.clone().sub(lastTarget.current)
    camera.position.add(delta)

    // 스프링 암이 당겨 둔 거리를 풀어, 사용자가 고른 거리(arm) 기준으로 각도를 다룬다
    const z = zoom.current
    const dir = camera.position.clone().sub(target)
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.4, -1)
    dir.normalize()
    camera.position.copy(target).addScaledVector(dir, z.arm)

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

    // 스프링 암: 캐릭터에서 카메라 쪽으로 레이를 쏴 지형·계단·건물에 막히면 그 앞으로 당긴다
    dir.copy(camera.position).sub(target).normalize()
    const hit = world.castRay(
      new rapier.Ray(target, dir),
      z.arm,
      true,
      undefined,
      undefined,
      ch.collider,
      undefined,
      (c) => cameraBlockers.has(c.handle),
    )
    const want = hit ? Math.max(CAMERA_MIN_ARM, hit.timeOfImpact - CAMERA_PROBE_MARGIN) : z.arm
    z.shown = want < z.shown ? want : z.shown + (want - z.shown) * (1 - Math.exp(-CAMERA_RELEASE_RATE * dt))
    camera.position.copy(target).addScaledVector(dir, z.shown)
    occlusionUniforms.uOccCamera.value.copy(camera.position)
    // 캐릭터와 카메라가 자리 잡고 몇 프레임 그린 뒤 첫 화면을 걷어 내게 알린다
    if (drawnFrames.current < 5 && ++drawnFrames.current === 5) useGame.setState({ sceneReady: true })
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
      <PostEffects />
      <OrbitControls
        ref={controls}
        makeDefault
        enablePan={false}
        // 거리는 휠 처리와 스프링 암이 맡는다
        enableZoom={false}
        minDistance={0.5}
        maxDistance={100}
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
