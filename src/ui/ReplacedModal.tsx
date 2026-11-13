import { useEffect, useRef, useState } from 'react'
import { reclaimNet, useNet } from '../lib/net'
import { releaseInput, useGame } from '../lib/store'

/**
 * 같은 브라우저의 다른 창이 같이하기를 넘겨받았을 때 이 창에 띄우는 창.
 * 패널의 작은 글자만으로는 밀려난 줄 모르기 쉬워서 화면을 덮어 알리고, 이 창에서 다시 같이할지 혼자 오를지 고르게 한다.
 * 떠 있는 동안 걷기를 멈추고 뒤쪽 키 입력을 막는다. 다시 밀려나면 또 뜬다
 */
export function ReplacedModal() {
  const replaced = useNet((s) => s.status === 'replaced')
  const setAutoWalk = useGame((s) => s.setAutoWalk)
  const [dismissed, setDismissed] = useState(false)
  const [wasReplaced, setWasReplaced] = useState(replaced)
  const box = useRef<HTMLDivElement>(null)
  // 밀려난 상태가 풀리면(이 창에서 다시 붙으면) 다음에 또 밀려날 때 다시 띄운다. effect 대신 그리는 중에 맞춘다
  if (replaced !== wasReplaced) {
    setWasReplaced(replaced)
    if (!replaced) setDismissed(false)
  }
  const open = replaced && !dismissed

  useEffect(() => {
    if (!open) return
    releaseInput()
    setAutoWalk(false)
    // 창 밖으로 가는 키는 걷기·점프·감정 표현이 먹지 않게 먼저 가로챈다. Esc 는 혼자 계속 오르기
    const block = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDismissed(true)
      if (!box.current?.contains(e.target as Node)) {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
    }
    window.addEventListener('keydown', block, true)
    return () => window.removeEventListener('keydown', block, true)
  }, [open, setAutoWalk])

  if (!open) return null
  return (
    <div className="overlay">
      <div ref={box} className="panel modal replaced-modal" role="dialog" aria-modal="true" aria-labelledby="replaced-title">
        <div className="modal-brand">같이하기</div>
        <h2 id="replaced-title">다른 창에서 같이하는 중이에요</h2>
        <p className="modal-sub">같이하기는 한 창에서만 돼요. 이 창에서는 다른 사람이 보이지 않아요.</p>
        <div className="actions">
          <button className="btn" onClick={() => setDismissed(true)}>
            혼자 계속 오르기
          </button>
          <button className="btn primary" autoFocus onClick={reclaimNet}>
            이 창에서 같이하기
          </button>
        </div>
      </div>
    </div>
  )
}
