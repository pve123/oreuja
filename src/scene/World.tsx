import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Physics, useRapier, type RapierCollider } from '@react-three/rapier'
import { BrightnessContrast, EffectComposer, HueSaturation, SSAO, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { IS_TOUCH } from '../lib/device'
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
import { Daylight } from './Daylight'
import { AVATARS, type AvatarKind } from '../lib/avatars'
import { playJump, playStep, setAmbience, type Surface } from '../lib/sound'
import { STAIR_HALF_WIDTH, groundAt, stairAt, stoneSteps, trailGround } from '../lib/steps'
import { emoteBubble, localPlayer, sendEmote } from '../lib/net'
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
const ROAM_LIMIT = 20
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
/**
 * 터치 조이스틱: 좌우로 기울이면 몸을 돌리고 위아래로 기울이면 앞뒤로 걷는다. 카메라는 늘 등 뒤에서 가는 쪽을 본다.
 * 각 축은 STICK_DEAD 보다 작게 기울이면 무시하고, 위로 STICK_RUN 보다 크게 밀면 뛴다
 */
const STICK_DEAD = 0.14
const STICK_RUN = 0.82
/** 조이스틱을 옆으로 끝까지 밀었을 때 몸을 돌리는 빠르기(rad/s). 키보드(TURN_SPEED)보다 조금 느리게 해 엄지로 섬세하게 꺾는다 */
const STICK_TURN_SPEED = 2.6
/**
 * 조이스틱 좌우 반응 곡선의 지수. 1 이면 기울기에 정비례하고 2 면 제곱이라, 조금 기울이면 아주 천천히 돌고 끝으로 갈수록 빨라진다.
 * 끝까지 밀었을 때 빠르기(STICK_TURN_SPEED)는 그대로다. 콘솔 게임 스틱의 응답 곡선과 같은 방식
 */
const STICK_TURN_CURVE = 2
/** 조이스틱을 조금만 기울였을 때 걷는 빠르기 비율. 여기서부터 STICK_RUN 까지 기울일수록 빨라진다 */
const STICK_WALK_MIN = 0.4
/** 점프 중 카메라가 바라보는 높이를 발밑 땅보다 이만큼 아래로는 내리지 않는다(m). 오르막에서 기준점이 땅속에 들어가 땅 밑이 보이지 않게 */
const CAMERA_GROUND_FLOOR = 0.2
/** 카메라 자체도 그 자리 땅보다 이만큼은 위에 둔다(m) */
const CAMERA_GROUND_CLEARANCE = 0.4
/**
 * 터치로 둘러볼 때 손가락 1px 에 도는 각도(°). OrbitControls 는 화면 높이 기준이라 폰을 가로로 눕히면 두 배 빨라지므로
 * 높이와 상관없이 같게 맞춘다. 세로 폰 화면 너비만큼 끌면 약 60° 돈다
 */
const TOUCH_LOOK_DEG_PER_PX = 0.15
/**
 * 터치 둘러보기 가속: 손가락이 이 빠르기(px/ms)로 움직이면 기본 배율(TOUCH_LOOK_DEG_PER_PX)로 돌고, 느리면 덜 빠르면 더 돈다.
 * 회전량이 손가락 빠르기의 제곱을 따르므로 천천히 끌면 세밀하게 맞추고 휙 쓸면 크게 돈다. 배율은 MIN~MAX 안에 둔다
 */
const TOUCH_LOOK_REF_SPEED = 0.6
const TOUCH_LOOK_MIN_GAIN = 0.5
const TOUCH_LOOK_MAX_GAIN = 1.8
/** 터치 둘러보기 관성. 손가락을 떼면 잠깐 미끄러지다 멈춘다 (drei 와 World 가 프레임마다 한 번씩 update 하므로 두 번 적용된다) */
const TOUCH_LOOK_DAMPING = 0.08
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
/**
 * 베이스캠프 카메라: 캐릭터 앞쪽 비스듬히(정면에서 LOBBY_ANGLE 만큼 돈 곳) LOBBY_ARM 거리에서 낮게 비추고 천천히 흔든다.
 * 왼쪽(좁은 화면은 아래쪽)에 베이스캠프 창이 있어 화면을 옮겨(view offset) 캐릭터가 남은 자리 가운데에 오게 한다.
 */
const LOBBY_ANGLE = 0.55
const LOBBY_SWAY = 0.12
const LOBBY_ARM = 6
const LOBBY_PITCH = THREE.MathUtils.degToRad(9)
/** 화면을 옮기는 비율. 넓은 화면은 오른쪽과 조금 위로(아래 캐릭터 줄·출발 버튼을 피해), 좁은 화면은 위쪽으로 */
const LOBBY_SHIFT_X = 0.2
const LOBBY_SHIFT_UP = 0.16
const LOBBY_SHIFT_UP_NARROW = 0.3
const FOLLOW_RATE = 5 // 카메라가 캐릭터 등 뒤로 돌아가는 빠르기 (클수록 빨리)
/**
 * 쉬운 조작의 저절로 걷기: 등산로에서 이만큼(m) 앞 지점을 향해 몸을 돌리며 걷는다. 길에서 비켜나 있어도 이 지점을 보고 걸어 가운데로 돌아온다
 */
const AUTO_LOOKAHEAD = 5
/** 저절로 걸을 때 몸을 돌리는 가장 빠른 빠르기(rad/s). 굽은 길에서 부드럽게 돈다 */
const AUTO_TURN_SPEED = 2.4
/** 가야 할 쪽과 이 각도(rad)보다 많이 어긋나 있으면 거의 멈춘 채로 먼저 돈다 (뒤돌아 출발할 때 크게 원을 그리지 않게) */
const AUTO_TURN_FIRST = THREE.MathUtils.degToRad(70)
/** 저절로 걷는 동안 손가락·마우스로 둘러본 뒤 이 시간(ms)이 지나면 카메라가 다시 등 뒤로 돌아온다 */
const AUTO_RECENTER_MS = 2500
/** 기념사진 말풍선 꼬리 끝을 둘 높이(발에서 m). 만세 동작으로 든 스틱 끝보다 조금 위 */
const PHOTO_BUBBLE_HEIGHT = 2.6
const JUMP_SPEED = 5.5 // m/s, 약 1m 높이까지 뛴다
const GRAVITY = 15 // m/s², 실제(9.8)보다 세게 해서 경쾌하게
/** 땅에 서 있을 때도 아래로 살짝 눌러 비탈에서 뜨지 않게 (m/s) */
const GROUND_STICK = 2
/** 발이 땅보다 이만큼 아래로 내려가면 바닥을 뚫은 것으로 보고 땅 위로 올린다(m) */
const FALL_RESCUE = 0.5
/** 이 시간보다 오래 땅에서 떨어져 있으면 공중 동작으로 바꾼다(s). 턱을 내려설 때마다 다리를 접지 않게 */
const AIRBORNE_AFTER = 0.12
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

/**
 * 화면 후처리. 잘 만든 게임처럼 물체가 땅·서로 닿는 곳에 그늘을 넣어(앰비언트 오클루전) 돌·계단·나무가 떠 보이지 않게 하고,
 * 톤 매핑한 뒤 색을 조금 다듬고 가장자리를 살짝 어둡게 한다. 톤 매핑은 렌더러 대신 후처리에서 한 번 한다 (App 의 Canvas 는 NoToneMapping).
 */
function PostEffects() {
  // 색 보정은 톤 매핑 뒤(0~1 색)에서 한다. 앞에 두면 1을 넘는 밝은 HDR 색(햇빛 받은 노란 오리 등)에서 채도 계산이 깨져 새까맣게 된다
  const grade = (
    <>
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <HueSaturation saturation={0.08} />
      <BrightnessContrast contrast={0.06} />
      <Vignette offset={0.3} darkness={0.45} />
    </>
  )
  // 폰·태블릿은 GPU 가 약해서 가장 무거운 앰비언트 오클루전(법선 버퍼까지 그린다)과 멀티샘플링을 뺀다
  if (IS_TOUCH) return <EffectComposer multisampling={0}>{grade}</EffectComposer>
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
      {grade}
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
  const camera = useThree((s) => s.camera)
  const avatar = useGame((s) => s.avatar)
  const gl = useThree((s) => s.gl)
  const { world, rapier } = useRapier()
  const character = useRef<Character | null>(null)
  const lastTarget = useRef(new THREE.Vector3())
  /** 마우스로 카메라를 돌려 둘러보는 중. 다시 걷거나 몸을 돌리면 등 뒤로 돌아간다 */
  const freeLook = useRef(false)
  // 손가락·마우스로 둘러보는 중인지와 마지막으로 손을 뗀 때 (저절로 걷기 중 카메라를 다시 등 뒤로 돌릴 때 쓴다)
  const looking = useRef(false)
  const lookEndedAt = useRef(0)
  /** 베이스캠프 창을 피해 화면을 옮긴 정도 (0~1) */
  const lobbyView = useRef({ shift: 0 })
  const size = useThree((s) => s.size)
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

  // 터치 둘러보기 가속. OrbitControls 는 손가락 움직임을 document 에서 받으므로 window capture 단계에서 먼저 빠르기를 재 회전 배율을 바꾼다
  useEffect(() => {
    if (!IS_TOUCH) return
    const el = gl.domElement
    const fingers = new Map<number, { x: number; y: number; t: number }>()
    const look = { speed: TOUCH_LOOK_REF_SPEED }
    const base = () => (TOUCH_LOOK_DEG_PER_PX * el.clientHeight) / 360
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || e.target !== el) return
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp })
      look.speed = TOUCH_LOOK_REF_SPEED
      controls.current.rotateSpeed = base()
    }
    const onMove = (e: PointerEvent) => {
      const f = fingers.get(e.pointerId)
      if (!f) return
      const dt = Math.max(e.timeStamp - f.t, 1)
      const v = Math.hypot(e.clientX - f.x, e.clientY - f.y) / dt
      // 이벤트마다 튀는 값을 고르게 한다
      look.speed += (v - look.speed) * 0.5
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp })
      const gain = THREE.MathUtils.clamp(look.speed / TOUCH_LOOK_REF_SPEED, TOUCH_LOOK_MIN_GAIN, TOUCH_LOOK_MAX_GAIN)
      controls.current.rotateSpeed = base() * gain
    }
    const onUp = (e: PointerEvent) => {
      fingers.delete(e.pointerId)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
    }
  }, [gl])

  // 휠 확대·축소는 직접 맡는다 (스프링 암이 당긴 거리를 OrbitControls 가 사용자가 고른 거리로 착각하지 않게)
  useEffect(() => {
    const el = gl.domElement
    const onWheel = (e: WheelEvent) => {
      const z = zoom.current
      z.arm = THREE.MathUtils.clamp(z.arm * (e.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP), CAMERA_MIN_DISTANCE, CAMERA_MAX_DISTANCE)
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    // 터치: 두 손가락을 벌리고 오므려 확대·축소한다 (OrbitControls 의 확대는 꺼 두었다)
    const touches = new Map<number, { x: number; y: number }>()
    const pinch = { span: 0 }
    const span = () => {
      const [a, b] = [...touches.values()]
      return Math.hypot(a.x - b.x, a.y - b.y)
    }
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      pinch.span = touches.size === 2 ? span() : 0
    }
    const onMove = (e: PointerEvent) => {
      if (!touches.has(e.pointerId)) return
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.size !== 2 || pinch.span <= 0) return
      const now = span()
      const z = zoom.current
      z.arm = THREE.MathUtils.clamp((z.arm * pinch.span) / now, CAMERA_MIN_DISTANCE, CAMERA_MAX_DISTANCE)
      pinch.span = now
    }
    const onUp = (e: PointerEvent) => {
      touches.delete(e.pointerId)
      pinch.span = 0
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
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
    let running = input.run
    let stick = false
    let auto = false
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
      // 방향키를 누르면 저절로 걷기를 멈추고 직접 조작으로 넘어간다
      if (game.autoWalk && (move !== 0 || turn !== 0)) game.setAutoWalk(false)
      // 쉬운 조작의 저절로 걷기: 등산로 몇 미터 앞을 향해 몸을 돌리며 걷는다
      if (game.autoWalk && move === 0 && turn === 0) {
        const ahead = trail.positionAt(Math.min(distance + AUTO_LOOKAHEAD, trail.length))
        const want = Math.atan2(ahead.x - b.x, ahead.z - b.z)
        const diff = Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw))
        b.yaw += THREE.MathUtils.clamp(diff, -AUTO_TURN_SPEED * dt, AUTO_TURN_SPEED * dt)
        move = Math.abs(diff) > AUTO_TURN_FIRST ? 0.15 : 1
        auto = true
      }
      // 터치 조이스틱: 좌우는 몸 돌리기, 위아래는 앞뒤로 걷기. 카메라가 등 뒤로 따라와 늘 가는 쪽이 화면 앞이다
      const { x: sx, y: sy } = input.stick
      if (Math.hypot(sx, sy) > STICK_DEAD && move === 0 && turn === 0) {
        stick = true
        const axis = (v: number) => Math.sign(v) * THREE.MathUtils.clamp((Math.abs(v) - STICK_DEAD) / (1 - STICK_DEAD), 0, 1)
        const ax = axis(sx)
        const steer = -Math.sign(ax) * Math.abs(ax) ** STICK_TURN_CURVE // 오른쪽으로 밀면 yaw 가 작아진다
        b.yaw += steer * STICK_TURN_SPEED * dt
        if (steer !== 0) turn = steer
        if (sy > STICK_DEAD) {
          // 조금 기울이면 천천히, 많이 기울일수록 빨리 걷고 끝까지 밀면 뛴다
          move = THREE.MathUtils.lerp(STICK_WALK_MIN, 1, THREE.MathUtils.clamp((sy - STICK_DEAD) / (STICK_RUN - STICK_DEAD), 0, 1))
          running = running || sy > STICK_RUN
        } else if (sy < -STICK_DEAD * 2) move = -1 // 아래로 당기면 뒷걸음
      }
    }
    let dx = 0
    let dz = 0
    if (move !== 0) {
      let speed = move > 0 ? (running ? RUN_SPEED : WALK_SPEED) : running ? BACK_RUN_SPEED : BACK_SPEED
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
    // 베이스캠프·정상·사진에서는 물리를 돌리지 않고 제자리 땅 위에 선다. 비탈에서는 컨트롤러가 서 있는 캐릭터도 조금씩
    // 미끄러뜨리는데, 걷기 모드가 아니면 그 걸음이 기록되지 않아 다음 프레임에 출발점으로 되돌려지며 초당 열두 번쯤 떨렸다
    const still = game.mode !== 'hiking'
    let m = { x: 0, y: 0, z: 0 }
    if (still) {
      b.y = groundAt(terrain, trail, steps, distance, offset, b.x, b.z).y
      b.vy = 0
    } else {
      // 중력: 땅에 서 있으면 살짝 눌러 붙이고, 떠 있으면 떨어진다
      b.vy = b.grounded && b.vy <= 0 ? -GROUND_STICK : b.vy - GRAVITY * dt
      ch.collider.setTranslation({ x: b.x, y: b.y + BODY_CENTER, z: b.z })
      ch.controller.computeColliderMovement(ch.collider, { x: dx, y: b.vy * dt, z: dz })
      m = ch.controller.computedMovement()
    }
    const startX = b.x
    const startZ = b.z
    b.x += m.x
    b.y += m.y
    b.z += m.z
    b.grounded = still || ch.controller.computedGrounded()
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
        // 정상에 닿으면 머리 위에 「⛰️🚩 정상이다」를 저절로 띄운다 (같이 오르는 사람들 화면에도)
        sendEmote('summit')
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
        if (tread.index !== st.index) playStep('step', running)
        footstep.current.phase = 0
      } else {
        const moved = Math.abs(distance - before.distance) + Math.abs(offset - before.offset)
        const fs = footstep.current
        fs.phase += moved * STEP_PHASE_PER_M
        if (fs.phase >= Math.PI) {
          fs.phase %= Math.PI
          playStep(surfaceAt(distance, offset), running)
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
    hiker.current.setCheering(game.mode !== 'hiking' && game.mode !== 'lobby')
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
        // 사진 속 캐릭터 머리 위에 「⛰️🚩 정상이다」 말풍선을 그려 넣는다 (머리 위치를 화면 좌표로 바꿔 넘긴다)
        camera.updateMatrixWorld()
        const head = new THREE.Vector3(pos.x, pos.y + PHOTO_BUBBLE_HEIGHT, pos.z).project(camera)
        const bubble = { text: emoteBubble('summit'), x: (head.x + 1) / 2, y: (1 - head.y) / 2 }
        useGame.getState().setPhoto(composePhoto(gl.domElement, trail.data, bubble))
      }
      return
    }
    photoFrames.current = 0

    // 바라보는 높이는 몸보다 느리게 따라가, 계단을 오르거나 점프할 때 화면이 덜컹거리지 않게 한다 (점프는 더 느리게)
    // 처음·다시 오르기·코스 바꾸기로 자리를 옮겼으면 바로 맞춘다. 공중 높이 계산보다 먼저 해야 NaN 이 카메라에 섞이지 않는다
    if (Number.isNaN(cameraY.current) || Math.abs(cameraY.current - pos.y) > 3) cameraY.current = pos.y
    const lookY = b.airTime > 0 ? Math.min(pos.y, cameraY.current + 0.02) : pos.y
    cameraY.current += (lookY - cameraY.current) * (1 - Math.exp(-CAMERA_Y_RATE * dt))
    // 오르막으로 뛰면 앞쪽 땅이 느리게 따라오는 높이보다 높아진다. 발밑 땅보다 내려가지 않게 받친다
    cameraY.current = Math.max(cameraY.current, Math.min(pos.y, meshHeight(terrain, pos.x, pos.z)) - CAMERA_GROUND_FLOOR)
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
    const lobby = game.mode === 'lobby'
    const arm = lobby ? LOBBY_ARM : z.arm
    const dir = camera.position.clone().sub(target)
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.4, -1)
    dir.normalize()
    camera.position.copy(target).addScaledVector(dir, arm)

    // 카메라는 캐릭터 등 뒤로 부드럽게 돌아간다. 손가락·마우스로 둘러보는 중이면 그 자리에 두고, 다시 걷거나 몸을 돌리면 따라간다
    // 베이스캠프에서는 캐릭터 앞쪽 비스듬히 돌아가 낮게 비춘다
    if (input.forward || input.backward || input.left || input.right || stick || lobby) freeLook.current = false
    // 저절로 걷는 중에는 둘러보고 손을 뗀 뒤 잠깐 지나면 다시 등 뒤로 돌아와 가는 길을 보여 준다
    if (auto && performance.now() - lookEndedAt.current > AUTO_RECENTER_MS && !looking.current) freeLook.current = false
    if (!freeLook.current) {
      const off = camera.position.clone().sub(target)
      const horizontal = Math.hypot(off.x, off.z)
      let azimuth = Math.atan2(off.x, off.z)
      const want = lobby ? b.yaw + LOBBY_ANGLE + Math.sin(performance.now() / 5000) * LOBBY_SWAY : b.yaw + Math.PI
      const k = 1 - Math.exp(-FOLLOW_RATE * dt)
      azimuth += Math.atan2(Math.sin(want - azimuth), Math.cos(want - azimuth)) * k // 가까운 쪽으로 돈다
      let y = camera.position.y
      if (lobby) y += (target.y + Math.sin(LOBBY_PITCH) * arm - y) * k
      camera.position.set(target.x + Math.sin(azimuth) * horizontal, y, target.z + Math.cos(azimuth) * horizontal)
    }

    // 베이스캠프 창에 가리지 않게 화면을 옮긴다. 열고 닫을 때 부드럽게 미끄러진다
    const view = lobbyView.current
    view.shift += ((lobby ? 1 : 0) - view.shift) * (1 - Math.exp(-4 * dt))
    const persp = camera as THREE.PerspectiveCamera
    if (view.shift > 0.002) {
      const { width: w, height: h } = size
      const narrow = w < 760
      persp.setViewOffset(w, h, narrow ? 0 : -w * LOBBY_SHIFT_X * view.shift, h * (narrow ? LOBBY_SHIFT_UP_NARROW : LOBBY_SHIFT_UP) * view.shift, w, h)
    } else if (persp.view?.enabled) persp.clearViewOffset()

    controls.current.target.copy(target)
    lastTarget.current.copy(target)
    controls.current.update()

    // 스프링 암: 캐릭터에서 카메라 쪽으로 레이를 쏴 지형·계단·건물에 막히면 그 앞으로 당긴다
    dir.copy(camera.position).sub(target).normalize()
    const hit = world.castRay(
      new rapier.Ray(target, dir),
      arm,
      true,
      undefined,
      undefined,
      ch.collider,
      undefined,
      (c) => cameraBlockers.has(c.handle),
    )
    const reach = hit ? Math.max(CAMERA_MIN_ARM, hit.timeOfImpact - CAMERA_PROBE_MARGIN) : arm
    z.shown = reach < z.shown ? reach : z.shown + (reach - z.shown) * (1 - Math.exp(-CAMERA_RELEASE_RATE * dt))
    camera.position.copy(target).addScaledVector(dir, z.shown)
    // 마지막 안전망: 레이가 놓친 비탈(점프 중 낮은 기준점 등)에서도 카메라가 땅속에 들어가지 않게 올린다
    const floor = meshHeight(terrain, camera.position.x, camera.position.z) + CAMERA_GROUND_CLEARANCE
    if (camera.position.y < floor) camera.position.setY(floor)
    occlusionUniforms.uOccCamera.value.copy(camera.position)
    // 캐릭터와 카메라가 자리 잡고 몇 프레임 그린 뒤 첫 화면을 걷어 내게 알린다
    if (drawnFrames.current < 5 && ++drawnFrames.current === 5) useGame.setState({ sceneReady: true })
  })

  return (
    <>
      <Daylight />
      <fog attach="fog" args={['#c9d6e3', 800, 6000]} />
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
        // 터치는 손가락 1px 에 도는 각도를 화면 높이와 상관없이 맞추고 관성을 조금 준다
        rotateSpeed={IS_TOUCH ? (TOUCH_LOOK_DEG_PER_PX * size.height) / 360 : 0.6}
        enableDamping={IS_TOUCH}
        dampingFactor={TOUCH_LOOK_DAMPING}
        onStart={() => {
          freeLook.current = true
          looking.current = true
        }}
        onEnd={() => {
          looking.current = false
          lookEndedAt.current = performance.now()
        }}
      />
    </>
  )
}
