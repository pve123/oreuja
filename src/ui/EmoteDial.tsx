import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { EMOTES, sendEmote } from '../lib/net'

/**
 * 터치 화면용 감정 표현 버튼. 점프 버튼 위 💬 를 누르면 일곱 가지 인사가 그림 한 줄로 펼쳐지고, 하나를 고르면 보내고 닫힌다.
 * 말(「안녕하세요」 등)은 보낸 뒤 머리 위 말풍선에 뜨고, 화면 읽기 프로그램에는 aria-label 로 읽힌다.
 * 바깥을 눌러도 닫힌다. 컴퓨터에서는 같이하기 패널의 버튼과 숫자 키를 쓰므로 CSS 가 숨긴다
 */
export function EmoteDial() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null!)

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePress = (e: PointerEvent) => {
      if (!root.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', closeOnOutsidePress, true)
    return () => window.removeEventListener('pointerdown', closeOnOutsidePress, true)
  }, [open])

  return (
    <div ref={root} className="emote-dial">
      {open && (
        <div className="emote-dial-menu" role="menu" aria-label="감정 표현">
          {EMOTES.map((e, i) => (
            <button
              key={e.kind}
              role="menuitem"
              className="emote-dial-item"
              aria-label={e.label}
              title={e.label}
              style={{ '--i': EMOTES.length - 1 - i } as CSSProperties}
              onClick={() => {
                sendEmote(e.kind)
                setOpen(false)
              }}
            >
              <span className="emote-dial-icon" aria-hidden>
                {e.icon}
              </span>
            </button>
          ))}
        </div>
      )}
      <button
        className={open ? 'emote-dial-toggle on' : 'emote-dial-toggle'}
        aria-label="감정 표현 보내기"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        💬
      </button>
    </div>
  )
}
