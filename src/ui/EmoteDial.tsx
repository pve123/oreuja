import { useEffect, useRef, useState } from 'react'
import { EMOTES, sendEmote } from '../lib/net'

/**
 * 터치 화면용 감정 표현 버튼. 점프 버튼 위 💬 를 누르면 일곱 가지 인사가 왼쪽으로 펼쳐지고, 하나를 고르면 보내고 닫힌다.
 * 바깥을 눌러도 닫힌다. 컴퓨터에서는 같이하기 패널의 버튼과 숫자 키를 쓰므로 CSS 가 숨긴다
 */
export function EmoteDial() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null!)

  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (!root.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', outside, true)
    return () => window.removeEventListener('pointerdown', outside, true)
  }, [open])

  return (
    <div ref={root} className="emote-dial">
      {open && (
        <div className="emote-dial-menu" role="menu" aria-label="감정 표현">
          {EMOTES.map((e) => (
            <button
              key={e.kind}
              role="menuitem"
              className="emote-dial-item"
              onClick={() => {
                sendEmote(e.kind)
                setOpen(false)
              }}
            >
              <span className="emote-dial-icon" aria-hidden>
                {e.icon}
              </span>
              {e.label}
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
