import { useEffect, useState } from 'react'
import { climbersOn, EMOTES, NAME_MAX, othersClimbing, reclaimNet, sendEmote, statusText, useNet } from '../lib/net'
import type { Trail } from '../lib/data'
import { InviteButton } from './InviteButton'

/** 컴퓨터 왼쪽 아래 같이하기 패널: 접속 상태, 같은 코스 인원, 내 닉네임, 감정 표현 버튼, 친구 부르기. 터치 화면은 PeopleSheet 가 맡는다 */
export function TogetherPanel({ trail }: { trail: Trail }) {
  const status = useNet((s) => s.status)
  const name = useNet((s) => s.name)
  const setName = useNet((s) => s.setName)
  // 나를 뺀 사람 수: 같은 코스, 모든 코스
  const sameCourse = useNet((s) => climbersOn(s.peers, trail.data.id).length)
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
            maxLength={NAME_MAX}
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
      <InviteButton trail={trail} className="together-invite link-button" />
    </div>
  )
}
