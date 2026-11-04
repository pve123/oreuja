import { useEffect } from 'react'
import { estimateMinutes, type Trail } from '../lib/data'
import { input, useGame } from '../lib/store'

function formatMinutes(min: number) {
  const h = Math.floor(min / 60)
  return h ? `${h}시간 ${min % 60}분` : `${min}분`
}

/** 키보드 입력 연결 */
function useKeyboard() {
  useEffect(() => {
    const set = (e: KeyboardEvent, on: boolean) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') input.forward = on
      else if (e.code === 'KeyS' || e.code === 'ArrowDown') input.backward = on
      else if (e.key === 'Shift') input.run = on
    }
    const down = (e: KeyboardEvent) => set(e, true)
    const up = (e: KeyboardEvent) => set(e, false)
    const blur = () => Object.assign(input, { forward: false, backward: false, run: false })
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
}

export function Hud({ trail }: { trail: Trail }) {
  useKeyboard()
  const distance = useGame((s) => s.distance)
  const progress = distance / trail.length
  const elevation = Math.round(trail.positionAt(distance).y)
  const remaining = Math.max(0, trail.length - distance)
  const realMinutes = estimateMinutes(trail.data.length, trail.data.elevationGain)

  return (
    <>
      <div className="panel course">
        <div className="eyebrow">{trail.data.mountain}</div>
        <h1>{trail.data.name}</h1>
        <div className="course-meta">
          {trail.data.start} → {trail.data.summit}
        </div>
        <dl className="stats">
          <div>
            <dt>거리</dt>
            <dd>{(trail.data.length / 1000).toFixed(2)}km</dd>
          </div>
          <div>
            <dt>오르막</dt>
            <dd>{trail.data.elevationGain}m</dd>
          </div>
          <div>
            <dt>실제 예상</dt>
            <dd>{formatMinutes(realMinutes)}</dd>
          </div>
        </dl>
      </div>

      <div className="panel progress">
        <div className="progress-row">
          <span>
            현재 고도 <b>{elevation}m</b>
          </span>
          <span>
            정상까지 <b>{remaining >= 1000 ? `${(remaining / 1000).toFixed(2)}km` : `${Math.round(remaining)}m`}</b>
          </span>
        </div>
        <div className="bar">
          <div className="bar-fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="hint">W/↑ 걷기 · S/↓ 뒤로 · Shift 빨리 · 마우스로 시점 회전</div>
      </div>

      <HoldButton label="걷기" onHold={(on) => (input.forward = on)} />
    </>
  )
}

/** 터치 화면용: 누르고 있는 동안 앞으로 */
function HoldButton({ label, onHold }: { label: string; onHold: (on: boolean) => void }) {
  return (
    <button
      className="hold-button"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        onHold(true)
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  )
}
