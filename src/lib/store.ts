import { create } from 'zustand'

type State = {
  /** 등산로 위 진행 거리(m) */
  distance: number
  startedAt: number | null
  setDistance: (d: number) => void
}

export const useGame = create<State>((set) => ({
  distance: 0,
  startedAt: null,
  setDistance: (distance) =>
    set((s) => ({ distance, startedAt: s.startedAt ?? (distance > 0 ? Date.now() : null) })),
}))

/** 키보드·화면 버튼 입력 (매 프레임 읽으므로 React 상태가 아닌 일반 객체) */
export const input = { forward: false, backward: false, run: false }
