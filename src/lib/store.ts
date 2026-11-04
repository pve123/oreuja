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
  mode: Mode
  startedAt: number | null
  finishedAt: number | null
  photo: string | null
  records: ClimbRecord[]
  setDistance: (d: number) => void
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
  mode: 'hiking',
  startedAt: null,
  finishedAt: null,
  photo: null,
  records: loadRecords(),
  setDistance: (distance) =>
    set((s) => ({ distance, startedAt: s.startedAt ?? (distance > 0 ? Date.now() : null) })),
  reachSummit: (record) => {
    const records = [...get().records, record]
    saveRecords(records)
    set({ mode: 'summit', finishedAt: Date.now(), records })
  },
  takePhoto: () => set({ mode: 'photo' }),
  setPhoto: (photo) => set({ photo, mode: 'photoResult' }),
  closePhoto: () => set({ mode: 'summit' }),
  restart: () => set({ distance: 0, mode: 'hiking', startedAt: null, finishedAt: null, photo: null }),
}))

/** 키보드·화면 버튼 입력 (매 프레임 읽으므로 React 상태가 아닌 일반 객체) */
export const input = { forward: false, backward: false, run: false }
