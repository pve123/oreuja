import { IS_TOUCH } from './device'

/**
 * 짧은 진동으로 손맛을 준다. 감정 표현을 보내거나 받을 때, 정상에 닿을 때.
 * 안드로이드 크롬만 진동하고, 아이폰 사파리는 웹 진동(navigator.vibrate)을 막아 조용히 넘어간다.
 * 컴퓨터는 진동이 없어 부르지 않는다
 */

/** 진동 모양(ms). 숫자가 진동, 진동, 쉼… 차례로 번갈아 간다 */
const PATTERNS = {
  /** 내가 감정 표현을 보냄: 톡 */
  send: 12,
  /** 다른 사람이 감정 표현을 보냄: 톡톡 */
  receive: [18, 60, 18],
  /** 정상 도착: 점점 길게 세 번 */
  summit: [40, 70, 60, 70, 120],
} satisfies Record<string, number | number[]>

/** 받은 감정 표현 진동 사이 최소 간격(ms). 여럿이 한꺼번에 보내도 폰이 계속 떨지 않게 한다 */
const RECEIVE_GAP_MS = 1500
let lastReceive = 0

export function haptic(kind: keyof typeof PATTERNS) {
  if (!IS_TOUCH || typeof navigator.vibrate !== 'function') return
  if (kind === 'receive') {
    const now = Date.now()
    if (now - lastReceive < RECEIVE_GAP_MS) return
    lastReceive = now
  }
  try {
    navigator.vibrate(PATTERNS[kind])
  } catch {
    // 진동을 막은 브라우저·설정이면 그냥 넘어간다
  }
}
