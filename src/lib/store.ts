import { create } from 'zustand'
import { loadAvatar, saveAvatar, type AvatarKind } from './avatars'

export type Mode = 'hiking' | 'summit' | 'photo' | 'photoResult'

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
  startedAt: number | null
  finishedAt: number | null
  photo: string | null
  records: ClimbRecord[]
  /** 지금까지 지난 마지막 이정표 번호 (-1 은 아직 없음) */
  reachedCheckpoint: number
  /** 이정표 도착 알림. at 이 바뀌면 알림을 새로 띄운다 */
  arrival: { index: number; at: number } | null
  /** 등산로에서 멀어진 정도. 0 은 걱정 없는 거리, 1 은 더 나갈 수 없는 경계 (화면 가장자리 어둡게·안내에 쓴다) */
  roam: number
  setRoam: (v: number) => void
  setDistance: (d: number) => void
  setOffset: (m: number) => void
  reachCheckpoint: (index: number) => void
  reachSummit: (record: ClimbRecord) => void
  takePhoto: () => void
  setPhoto: (url: string) => void
  closePhoto: () => void
  restart: () => void
}

const RECORDS_KEY = 'hiking-metaverse:climbs'
const COURSE_KEY = 'hiking-metaverse:course'

function loadCourse(): string | null {
  try {
    return localStorage.getItem(COURSE_KEY)
  } catch {
    return null
  }
}
function saveCourse(id: string) {
  try {
    localStorage.setItem(COURSE_KEY, id)
  } catch {
    // 저장소를 못 쓰는 환경이면 무시
  }
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
}

// 기록은 우선 브라우저에만 저장한다 (나중에 Supabase 로 옮김)
function loadRecords(): ClimbRecord[] {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY) ?? '[]')
  } catch {
    return []
  }
}
function saveRecords(records: ClimbRecord[]) {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records))
  } catch {
    // 저장소를 못 쓰는 환경이면 무시
  }
}

export const useGame = create<State>((set, get) => ({
  ...freshClimb,
  courseId: loadCourse(),
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
  setDistance: (distance) =>
    set((s) => ({ distance, startedAt: s.startedAt ?? (distance > 0 ? Date.now() : null) })),
  setOffset: (offset) => set({ offset }),
  reachCheckpoint: (index) => set({ reachedCheckpoint: index, arrival: { index, at: Date.now() } }),
  reachSummit: (record) => {
    const records = [...get().records, record]
    saveRecords(records)
    set({ mode: 'summit', finishedAt: Date.now(), records })
  },
  takePhoto: () => set({ mode: 'photo' }),
  setPhoto: (photo) => set({ photo, mode: 'photoResult' }),
  closePhoto: () => set({ mode: 'summit' }),
  restart: () => set(freshClimb),
}))

/** 키보드·화면 버튼 입력 (매 프레임 읽으므로 React 상태가 아닌 일반 객체) */
export const input = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  run: false,
  jump: false,
}
