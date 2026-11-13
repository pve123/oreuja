import { useEffect, useState } from 'react'
import { isClimbing, othersClimbing, reclaimNet, statusText, useNet } from '../lib/net'
import { useAvatarThumbs } from '../lib/avatars'
import { useGame } from '../lib/store'
import type { Trail } from '../lib/data'
import { InviteButton } from './InviteButton'

/**
 * 터치 화면용 같이하기: 오른쪽 위 사람 버튼과 누르면 아래에서 올라오는 시트.
 * 컴퓨터의 왼쪽 아래 같이하기 패널은 폰에서 조이스틱 자리와 겹쳐 숨기므로, 인원·닉네임·다른 창 넘겨받기를 여기서 보여 준다.
 * 감정 표현은 💬 버튼(EmoteDial)이 맡는다. 컴퓨터에서는 CSS 가 숨긴다
 */
export function PeopleButton({ trail }: { trail: Trail }) {
  const status = useNet((s) => s.status)
  // 나를 뺀, 이 코스를 오르는 사람 수
  const sameCourse = useNet((s) => s.peers.filter((p) => p.course === trail.data.id && isClimbing(p)).length)
  const [open, setOpen] = useState(false)
  const online = status === 'online'
  const label = online ? `같이하기, 이 코스 ${sameCourse + 1}명` : `같이하기, ${statusText(status, 0, 0)}`

  return (
    <>
      <button className={`people-button ${status}`} aria-label={label} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <circle cx="9" cy="8" r="3.2" fill="currentColor" />
          <path d="M3 19c0-3.3 2.7-5.6 6-5.6s6 2.3 6 5.6z" fill="currentColor" />
          <circle cx="16.5" cy="9" r="2.6" fill="currentColor" opacity="0.7" />
          <path d="M14.6 13.6c3.1-.6 6.4 1.4 6.4 5.4h-4.6c0-2.1-.7-4-1.8-5.4z" fill="currentColor" opacity="0.7" />
        </svg>
        {/* 이 코스에 나 말고 누가 있으면 숫자로, 아니면 접속 상태 점만 */}
        {online && sameCourse > 0 ? <span className="people-count">{sameCourse + 1}</span> : <i className={`dot ${status}`} aria-hidden />}
      </button>
      {open && <PeopleSheet trail={trail} onClose={() => setOpen(false)} />}
    </>
  )
}

/** 같이하기 시트: 접속 상태, 이 코스에 있는 사람 목록, 내 닉네임 바꾸기 */
function PeopleSheet({ trail, onClose }: { trail: Trail; onClose: () => void }) {
  const status = useNet((s) => s.status)
  const name = useNet((s) => s.name)
  const setName = useNet((s) => s.setName)
  const peers = useNet((s) => s.peers)
  const total = useNet((s) => othersClimbing(s.counts))
  const thumbs = useAvatarThumbs((s) => s.thumbs)
  const myAvatar = useGame((s) => s.avatar)
  const here = peers.filter((p) => p.course === trail.data.id && isClimbing(p))
  const [draft, setDraft] = useState(name)

  // 뒤로 가기 대신 Esc 로도 닫는다 (블루투스 키보드)
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [onClose])

  const saveName = () => {
    if (draft.trim() && draft !== name) setName(draft)
  }

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel sheet people-sheet" role="dialog" aria-modal="true" aria-labelledby="people-title">
        <div className="sheet-handle" aria-hidden />
        <div className="sheet-head">
          <h2 id="people-title">같이하기</h2>
          <button className="sheet-close" aria-label="닫기" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="people-status">
          <i className={`dot ${status}`} aria-hidden />
          {statusText(status, here.length, Math.max(total, here.length))}
          {status === 'replaced' && (
            <button type="button" className="together-reclaim" onClick={reclaimNet}>
              이 창에서
            </button>
          )}
        </p>

        {status === 'online' && (
          <ul className="people-list" aria-label="이 코스에 있는 사람">
            <li className="me">
              <Avatar src={thumbs[myAvatar]} />
              <span className="people-name">{name}</span>
              <span className="people-tag">나</span>
            </li>
            {here.map((p) => (
              <li key={p.id}>
                <Avatar src={thumbs[p.avatar]} />
                <span className="people-name">{p.name}</span>
                <span className="people-where">{p.mode === 'summit' || p.mode === 'photo' || p.mode === 'photoResult' ? '정상' : `${Math.round(p.distance)}m`}</span>
              </li>
            ))}
            {here.length === 0 && <li className="people-empty">아직 이 코스에는 나 혼자예요</li>}
          </ul>
        )}

        <InviteButton trail={trail} className="btn primary people-invite" />

        <form
          className="people-rename"
          onSubmit={(e) => {
            e.preventDefault()
            saveName()
            ;(document.activeElement as HTMLElement | null)?.blur()
          }}
        >
          <label htmlFor="people-name-input">내 닉네임</label>
          <div className="people-rename-row">
            <input id="people-name-input" value={draft} maxLength={12} enterKeyHint="done" onChange={(e) => setDraft(e.target.value)} onBlur={saveName} />
            <button className="btn" type="submit" disabled={!draft.trim() || draft === name}>
              바꾸기
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** 사람 목록의 캐릭터 얼굴. 모습 그림을 아직 못 만들었으면 빈 동그라미 */
function Avatar({ src }: { src?: string }) {
  return <span className="people-avatar">{src && <img src={src} alt="" />}</span>
}
