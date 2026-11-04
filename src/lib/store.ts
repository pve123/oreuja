import { create } from 'zustand'

export type Mode = 'hiking' | 'summit' | 'photo' | 'photoResult'

export type ClimbRecord = {
  trailId: string
  finishedAt: string
  durationSec: number
}

type State = {
  /** 등산로 위 진행 거리(m) */
  distance: number
  /** 등산로에서 옆으로 비킨 거리(m). 오른쪽이 + */
  offset: number
  /** 노란 등산로 안내선을 보일지 */
  showGuide: boolean
  toggleGuide: () => void
  mode: Mode
  startedAt: number | null
  finishedAt: number | null
  photo: string | null
  records: ClimbRecord[]
  /** 지금까지 지난 마지막 이정표 번호 (-1 은 아직 없음) */
  reachedCheckpoint: number
  /** 이정표 도착 알림. at 이 바뀌면 알림을 새로 띄운다 */
  arrival: { index: number; at: number } | null
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
  distance: 0,
  offset: 0,
  showGuide: false,
  toggleGuide: () => set((s) => ({ showGuide: !s.showGuide })),
  mode: 'hiking',
  startedAt: null,
  finishedAt: null,
  photo: null,
  records: loadRecords(),
  reachedCheckpoint: -1,
  arrival: null,
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
  restart: () =>
    set({
      distance: 0,
      offset: 0,
      mode: 'hiking',
      startedAt: null,
      finishedAt: null,
      photo: null,
      reachedCheckpoint: -1,
      arrival: null,
    }),
}))

/** 키보드·화면 버튼 입력 (매 프레임 읽으므로 React 상태가 아닌 일반 객체) */
export const input = { forward: false, backward: false, left: false, right: false, run: false, jump: false }
