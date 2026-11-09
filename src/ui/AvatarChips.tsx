import { useGame } from '../lib/store'
import { AVATARS, useAvatarThumbs } from '../lib/avatars'

/** 캐릭터 고르기 버튼 줄. 베이스캠프와 걷는 화면의 캐릭터 패널이 같이 쓴다. 모습 그림을 만들기 전에는 이름을 보여 준다 */
export function AvatarChips() {
  const avatar = useGame((s) => s.avatar)
  const setAvatar = useGame((s) => s.setAvatar)
  const thumbs = useAvatarThumbs((s) => s.thumbs)
  return (
    <div className="avatar-bar" role="radiogroup" aria-label="캐릭터 고르기">
      {AVATARS.map((a) => (
        <button
          key={a.kind}
          role="radio"
          aria-checked={a.kind === avatar}
          className={a.kind === avatar ? 'avatar-chip selected' : 'avatar-chip'}
          title={`${a.name} · ${a.desc}`}
          aria-label={a.name}
          onClick={() => setAvatar(a.kind)}
        >
          {thumbs[a.kind] ? <img src={thumbs[a.kind]} alt="" className="avatar-thumb" /> : a.name}
        </button>
      ))}
    </div>
  )
}
