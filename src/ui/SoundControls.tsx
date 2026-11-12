import { useEffect } from 'react'
import { useGame } from '../lib/store'
import { playChime, playFanfare, playShutter, unlockAudio, useSound } from '../lib/sound'

/**
 * 소리 켜기·끄기 버튼과 게임 사건 소리(이정표 도착, 정상, 기념사진).
 * 브라우저가 첫 입력 전에는 소리를 막아서, 첫 키·클릭·터치에서 소리를 연다.
 */
export function SoundControls() {
  const muted = useSound((s) => s.muted)
  const toggle = useSound((s) => s.toggle)
  const label = muted ? '소리 켜기' : '소리 끄기'

  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('keydown', unlock)
    window.addEventListener('pointerdown', unlock)
    return () => {
      window.removeEventListener('keydown', unlock)
      window.removeEventListener('pointerdown', unlock)
    }
  }, [])

  // 게임 상태가 바뀌는 순간에 맞춰 소리를 낸다
  useEffect(
    () =>
      useGame.subscribe((s, prev) => {
        if (s.arrival && s.arrival.at !== prev.arrival?.at) playChime()
        if (s.mode === 'summit' && prev.mode === 'hiking') playFanfare()
        if (s.mode === 'photo' && prev.mode !== 'photo') playShutter()
      }),
    [],
  )

  return (
    <button
      className="sound-toggle"
      aria-pressed={!muted}
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
        <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
        {muted ? (
          <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        ) : (
          <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        )}
      </svg>
    </button>
  )
}
