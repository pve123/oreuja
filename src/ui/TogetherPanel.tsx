import { useEffect, useState } from 'react'
import { EMOTES, sendEmote, useNet } from '../lib/net'
import type { Trail } from '../lib/data'

/** 왼쪽 아래 같이하기 패널: 접속 상태, 같은 코스 인원, 내 닉네임, 감정 표현 버튼 */
export function TogetherPanel({ trail }: { trail: Trail }) {
  const status = useNet((s) => s.status)
  const name = useNet((s) => s.name)
  const setName = useNet((s) => s.setName)
  const sameCourse = useNet((s) => s.peers.filter((p) => p.course === trail.data.id).length)
  const total = useNet((s) => s.peers.length)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  // 숫자 1·2·3 키로 감정 표현 (이름을 고치는 중에는 끈다)
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
    <div className="panel together" aria-label="같이하기">
      <div className="together-status">
        <i className={`dot ${status}`} aria-hidden />
        {status === 'online'
          ? `이 코스 ${sameCourse + 1}명${total > sameCourse ? ` · 다른 코스 ${total - sameCourse}명` : ''}`
          : status === 'connecting'
            ? '연결하는 중…'
            : '혼자 오르는 중 (서버 없음)'}
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
  )
}
