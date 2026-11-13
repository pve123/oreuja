import { useEffect, useState } from 'react'
import { isClimbing, useNet } from '../lib/net'
import type { Trail } from '../lib/data'

/** 알림 하나가 떠 있는 시간(ms). CSS 의 join-toast 애니메이션 길이와 같게 */
const TOAST_MS = 3200
/** 한꺼번에 보이는 알림 수. 여럿이 한 번에 들어오면 오래된 것부터 밀어낸다 */
const MAX_TOASTS = 3
/**
 * 같이하기에 막 붙은 직후(ms)에는 이미 오르던 사람들이 한꺼번에 들어오므로 알리지 않는다.
 * 위치 메시지는 1초에 5번 오니 이 정도면 첫 목록을 다 받는다
 */
const SETTLE_MS = 1500

type Toast = { key: string; text: string }

/**
 * 다른 사람이 내 코스에 들어오면 화면 아래쪽 가운데에 「○○님이 같이 오르기 시작했어요」를 잠깐 띄운다.
 * 처음 붙었을 때나 다시 붙었을 때 이미 있던 사람, 코스를 바꿨을 때 그 코스에 있던 사람은 알리지 않는다
 */
export function JoinToast({ trail }: { trail: Trail }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const course = trail.data.id
    /** 이미 알렸거나 처음부터 있던 사람 */
    const known = new Set<string>()
    let onlineSince = useNet.getState().status === 'online' ? 0 : Infinity
    const climbers = () => useNet.getState().peers.filter((p) => p.course === course && isClimbing(p))
    for (const p of climbers()) known.add(p.id)

    return useNet.subscribe((s, prev) => {
      if (s.status !== prev.status) {
        // 끊기면 목록이 비니 다시 붙은 뒤 첫 목록은 새로 들어온 사람으로 치지 않는다
        if (s.status === 'online') onlineSince = performance.now()
        else known.clear()
      }
      if (s.peers === prev.peers) return
      const now = climbers()
      const settling = performance.now() - onlineSince < SETTLE_MS
      const joined = now.filter((p) => !known.has(p.id))
      for (const p of joined) known.add(p.id)
      // 내려간 사람은 잊어서 다시 오르면 또 알린다
      const here = new Set(now.map((p) => p.id))
      for (const id of known) if (!here.has(id)) known.delete(id)
      if (settling || joined.length === 0) return
      const added = joined.map((p) => ({ key: `${p.id}-${Date.now()}`, text: `${p.name}님이 같이 오르기 시작했어요` }))
      setToasts((list) => [...list, ...added].slice(-MAX_TOASTS))
      for (const t of added) setTimeout(() => setToasts((list) => list.filter((x) => x.key !== t.key)), TOAST_MS)
    })
  }, [trail])

  if (toasts.length === 0) return null
  return (
    <div className="join-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.key} className="join-toast">
          <span aria-hidden>👋</span> {t.text}
        </div>
      ))}
    </div>
  )
}
