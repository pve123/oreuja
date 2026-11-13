import { useEffect, useRef, useState } from 'react'
import { EMOTES, othersClimbing, reclaimNet, sendEmote, useNet } from '../lib/net'
import { releaseInput, useGame } from '../lib/store'
import type { Trail } from '../lib/data'

type NetStatus = ReturnType<typeof useNet.getState>['status']

/** 접속 상태 한 줄. 연결되면 이 코스와 다른 코스에 있는 사람 수(나 포함)를 보여 준다 */
function statusText(status: NetStatus, sameCourse: number, total: number) {
  if (status === 'connecting') return '연결하는 중…'
  if (status === 'replaced') return '다른 창에서 같이하는 중'
  if (status !== 'online') return '혼자 오르는 중'
  const elsewhere = total - sameCourse
  return `이 코스 ${sameCourse + 1}명${elsewhere > 0 ? ` · 다른 코스 ${elsewhere}명` : ''}`
}

/** 왼쪽 아래 같이하기 패널: 접속 상태, 같은 코스 인원, 내 닉네임, 감정 표현 버튼 */
export function TogetherPanel({ trail }: { trail: Trail }) {
  const status = useNet((s) => s.status)
  const name = useNet((s) => s.name)
  const setName = useNet((s) => s.setName)
  // 나를 뺀 사람 수: 같은 코스, 모든 코스
  const sameCourse = useNet((s) => s.peers.filter((p) => p.course === trail.data.id).length)
  const total = useNet((s) => Math.max(othersClimbing(s.counts), sameCourse))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  // 숫자 1~7 키로 감정 표현 (이름을 고치는 중에는 끈다)
  useEffect(() => {
    if (editing) return
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return
      const emote = EMOTES.find((x) => x.key === e.key)
      if (emote) sendEmote(emote.kind)
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [editing])

  return (
    <>
      <ReplacedModal />
      <div className="panel together" aria-label="같이하기">
        <div className="together-status">
          <i className={`dot ${status}`} aria-hidden />
          {statusText(status, sameCourse, total)}
          {status === 'replaced' && (
            <button type="button" className="together-reclaim" onClick={reclaimNet}>
              이 창에서
            </button>
          )}
        </div>
        {editing ? (
          <form
            className="together-name"
            onSubmit={(e) => {
              e.preventDefault()
              setName(draft)
              setEditing(false)
            }}
          >
            <input
              autoFocus
              value={draft}
              maxLength={12}
              aria-label="닉네임"
              onChange={(e) => setDraft(e.target.value)}
              // 이름을 치는 동안 걷기·감정 표현 키가 먹지 않게 한다
              onKeyDown={(e) => e.stopPropagation()}
              onBlur={() => setEditing(false)}
            />
          </form>
        ) : (
          <button
            className="together-name link-button"
            title="닉네임 바꾸기"
            onClick={() => {
              setDraft(name)
              setEditing(true)
            }}
          >
            {name} ✎
          </button>
        )}
        <div className="emotes">
          {EMOTES.map((e) => (
            <button key={e.kind} className="emote-button" title={`${e.label} (${e.key})`} aria-label={e.label} onClick={() => sendEmote(e.kind)}>
              {e.icon}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

/**
 * 같은 브라우저의 다른 창이 같이하기를 넘겨받았을 때 이 창에 띄우는 창.
 * 패널의 작은 글자만으로는 밀려난 줄 모르기 쉬워서 화면을 덮어 알리고, 이 창에서 다시 같이할지 혼자 오를지 고르게 한다.
 * 떠 있는 동안 걷기를 멈추고 뒤쪽 키 입력을 막는다. 다시 밀려나면 또 뜬다
 */
function ReplacedModal() {
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
