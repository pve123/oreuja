import { create } from 'zustand'
import { loadAvatar, saveAvatar, type AvatarKind } from './avatars'
import { IS_TOUCH } from './device'
import { haptic } from './haptics'
import { readStored, removeStored, writeStored } from './storage'

/** lobby 는 출발 전 베이스캠프(산·코스·혼자/같이·캐릭터를 고르는 화면). 걷는 중에도 Esc 로 다시 연다 */
export type Mode = 'lobby' | 'hiking' | 'summit' | 'photo' | 'photoResult'

/**
 * 조작 방식. easy 는 큰 「걷기」 버튼 하나로 등산로를 따라 저절로 걷는다 (어르신·아이·3D 게임이 낯선 사람).
 * free 는 조이스틱(폰)이나 방향키(컴퓨터)로 길 밖까지 자유롭게 걷는다
 */
export type ControlMode = 'easy' | 'free'

/** 정상까지 한 번 오른 기록 */
export type ClimbRecord = {
  trailId: string
  finishedAt: string
  durationSec: number
}

type State = {
  /** 고른 코스 id (브라우저에 기억). 없으면 첫 코스 */
  courseId: string | null
  /** 코스를 바꾸면 처음부터 다시 오른다 */
  setCourse: (id: string) => void
  /** 등산로 위 진행 거리(m) */
  distance: number
  /** 등산로에서 옆으로 비킨 거리(m). 오른쪽이 + */
  offset: number
  /** 고른 아바타 (브라우저에 기억) */
  avatar: AvatarKind
  setAvatar: (kind: AvatarKind) => void
  mode: Mode
  /** 처음 걸음을 뗀 시각(ms). 출발점에 서 있기만 하면 null 이다 */
  startedAt: number | null
  /** 정상에 닿은 시각(ms) */
  finishedAt: number | null
  /** 정상 기념사진 (이미지 주소) */
  photo: string | null
  /** 지금까지 오른 기록 (브라우저에 기억) */
  records: ClimbRecord[]
  /** 지금까지 지난 마지막 이정표 번호 (-1 은 아직 없음) */
  reachedCheckpoint: number
  /** 이정표 도착 알림. at 이 바뀌면 알림을 새로 띄운다 */
  arrival: { index: number; at: number } | null
  /** 등산로에서 멀어진 정도. 0 은 걱정 없는 거리, 1 은 더 나갈 수 없는 경계 (화면 가장자리 어둡게·안내에 쓴다) */
  roam: number
  setRoam: (v: number) => void
  /** 3D 장면(물리·내 캐릭터 포함)이 처음 그려졌는지. 첫 화면(스플래시)을 걷어 낼 때 쓴다 */
  sceneReady: boolean
  setDistance: (d: number) => void
  setOffset: (m: number) => void
  reachCheckpoint: (index: number) => void
  reachSummit: (record: ClimbRecord) => void
  takePhoto: () => void
  setPhoto: (url: string) => void
  closePhoto: () => void
  restart: () => void
  /** 베이스캠프를 연다 (걷던 자리와 시간은 그대로 둔다) */
  openLobby: () => void
  /** 베이스캠프를 닫고 걷던 곳에서 이어 오른다 */
  resume: () => void
  /** 조작 방식 (브라우저에 기억). 폰은 쉬운 조작, 컴퓨터는 자유 조작이 기본 */
  controlMode: ControlMode
  setControlMode: (mode: ControlMode) => void
  /** 쉬운 조작에서 등산로를 따라 저절로 걷는 중인지 */
  autoWalk: boolean
  setAutoWalk: (on: boolean) => void
}

export const AUTOSTART_STORAGE_KEY = 'hiking-metaverse:autostart'
const RECORDS_KEY = 'hiking-metaverse:climbs'
const COURSE_KEY = 'hiking-metaverse:course'
const CONTROL_KEY = 'hiking-metaverse:control'

/** 저장된 조작 방식. 없거나 깨졌으면 폰은 쉬운 조작, 컴퓨터는 자유 조작 */
function loadControl(): ControlMode {
  const saved = readStored(CONTROL_KEY)
  return saved === 'easy' || saved === 'free' ? saved : IS_TOUCH ? 'easy' : 'free'
}

export function saveCourse(id: string) {
  writeStored(COURSE_KEY, id)
}

/** 다른 산을 골라 새로 불러온 직후면 베이스캠프를 건너뛰고 바로 출발한다 (src/lib/mountains.ts switchMountain) */
function initialMode(): Mode {
  if (readStored(AUTOSTART_STORAGE_KEY, 'session')) {
    removeStored(AUTOSTART_STORAGE_KEY, 'session')
    return 'hiking'
  }
  return 'lobby'
}

/** 처음부터 다시 오를 때 되돌리는 값 */
const freshClimb = {
  distance: 0,
  offset: 0,
  mode: 'hiking' as Mode,
  startedAt: null,
  finishedAt: null,
  photo: null,
  reachedCheckpoint: -1,
  arrival: null,
  roam: 0,
  autoWalk: false,
}

/** 브라우저에 저장된 오르기 기록 */
function loadRecords(): ClimbRecord[] {
  try {
    return JSON.parse(readStored(RECORDS_KEY) ?? '[]')
  } catch {
    return [] // 값이 깨졌으면 비운다
  }
}

export const useGame = create<State>((set, get) => ({
  ...freshClimb,
  mode: initialMode(),
  // 첫 화면을 걷어 낼 신호. 한 번 켜지면 다시 끄지 않는다 (다시 오르기·코스 바꾸기에는 첫 화면이 없다)
  sceneReady: false,
  courseId: readStored(COURSE_KEY),
  setCourse: (courseId) => {
    saveCourse(courseId)
    set({ ...freshClimb, courseId })
  },
  avatar: loadAvatar(),
  setAvatar: (avatar) => {
    saveAvatar(avatar)
    set({ avatar })
  },
  records: loadRecords(),
  setRoam: (roam) => set({ roam }),
  // 처음 앞으로 나아간 순간을 출발 시각으로 잡는다
  setDistance: (distance) => set((s) => ({ distance, startedAt: s.startedAt ?? (distance > 0 ? Date.now() : null) })),
  setOffset: (offset) => set({ offset }),
  reachCheckpoint: (index) => set({ reachedCheckpoint: index, arrival: { index, at: Date.now() } }),
  reachSummit: (record) => {
    const records = [...get().records, record]
    writeStored(RECORDS_KEY, JSON.stringify(records))
    set({ mode: 'summit', finishedAt: Date.now(), records, autoWalk: false })
    haptic('summit')
  },
  takePhoto: () => set({ mode: 'photo' }),
  setPhoto: (photo) => set({ photo, mode: 'photoResult' }),
  closePhoto: () => set({ mode: 'summit' }),
  restart: () => set(freshClimb),
  // 베이스캠프를 열면 저절로 걷기를 멈춘다 (닫았을 때 모르는 새 걸어가 있지 않게)
  openLobby: () => set({ mode: 'lobby', autoWalk: false }),
  resume: () => set({ mode: 'hiking' }),
  controlMode: loadControl(),
  setControlMode: (controlMode) => {
    writeStored(CONTROL_KEY, controlMode)
    set({ controlMode, autoWalk: false })
  },
  setAutoWalk: (autoWalk) => set({ autoWalk }),
}))

/** 키보드·화면 버튼 입력 (매 프레임 읽으므로 React 상태가 아닌 일반 객체) */
export const input = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  run: false,
  jump: false,
  /** 터치 조이스틱 기울기. 화면 기준으로 x 는 오른쪽 +, y 는 위쪽 +, 길이 0~1 (src/ui/TouchControls.tsx) */
  stick: { x: 0, y: 0 },
}

/** 누르고 있던 입력을 모두 뗀 상태로 되돌린다 (창이 포커스를 잃으면 keyup 이 오지 않아 계속 걷는 것을 막는다) */
export function releaseInput() {
  Object.assign(input, { forward: false, backward: false, left: false, right: false, run: false, jump: false })
  input.stick.x = 0
  input.stick.y = 0
}
