import { useEffect, useState } from 'react'
import { estimateMinutes, type Trail } from '../lib/data'
import { input, useGame } from '../lib/store'

function formatMinutes(min: number) {
  const h = Math.floor(min / 60)
  return h ? `${h}시간 ${min % 60}분` : `${min}분`
}

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60)
  return `${m}분 ${String(sec % 60).padStart(2, '0')}초`
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
  const mode = useGame((s) => s.mode)
  const progress = distance / trail.length
  const elevation = Math.round(trail.positionAt(distance).y)
  const remaining = Math.max(0, trail.length - distance)
  const realMinutes = estimateMinutes(trail.data.length, trail.data.elevationGain)

  if (mode !== 'hiking') return null

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

export function SummitModal({ trail }: { trail: Trail }) {
  const mode = useGame((s) => s.mode)
  const photo = useGame((s) => s.photo)
  const startedAt = useGame((s) => s.startedAt)
  const finishedAt = useGame((s) => s.finishedAt)
  const records = useGame((s) => s.records)
  const { takePhoto, closePhoto, restart } = useGame.getState()
  const [now] = useState(() => new Date())

  if (mode === 'photo') return <div className="flash" />

  if (mode === 'photoResult' && photo) {
    return (
      <div className="overlay">
        <div className="panel modal photo-modal">
          <img src={photo} alt="정상 기념사진" />
          <div className="actions">
            <a className="btn primary" href={photo} download={`${trail.data.id}-${now.toISOString().slice(0, 10)}.png`}>
              사진 저장
            </a>
            <button className="btn" onClick={closePhoto}>
              닫기
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (mode !== 'summit') return null

  const count = records.filter((r) => r.trailId === trail.data.id).length
  const duration = startedAt && finishedAt ? Math.round((finishedAt - startedAt) / 1000) : 0

  return (
    <div className="overlay">
      <div className="panel modal">
        <Badge trail={trail} />
        <h2>정상 도착!</h2>
        <p className="modal-sub">
          {trail.data.mountain} {trail.data.summit} {trail.data.summitElevation}m 를 완등했어요.
        </p>
        <dl className="stats">
          <div>
            <dt>걸린 시간</dt>
            <dd>{formatDuration(duration)}</dd>
          </div>
          <div>
            <dt>실제라면</dt>
            <dd>약 {formatMinutes(estimateMinutes(trail.data.length, trail.data.elevationGain))}</dd>
          </div>
          <div>
            <dt>완등 횟수</dt>
            <dd>{count}회</dd>
          </div>
        </dl>
        <div className="actions">
          <button className="btn primary" onClick={takePhoto}>
            기념사진 찍기
          </button>
          <button className="btn" onClick={restart}>
            다시 오르기
          </button>
        </div>
      </div>
    </div>
  )
}

function Badge({ trail }: { trail: Trail }) {
  return (
    <svg className="badge" viewBox="0 0 120 120" role="img" aria-label="완등 인증 배지">
      <circle cx="60" cy="60" r="56" fill="#1d3557" stroke="#f2c14e" strokeWidth="5" />
      <path d="M22 84 L48 44 L60 60 L72 38 L98 84 Z" fill="#a8dadc" />
      <path d="M72 38 L80 51 L66 51 Z" fill="#fff" />
      <path d="M48 44 L54 53 L42 53 Z" fill="#fff" />
      <text x="60" y="100" textAnchor="middle" fontSize="11" fontWeight="800" fill="#f2c14e">
        {trail.data.summit} {Math.round(trail.data.summitElevation)}m
      </text>
      <text x="60" y="28" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff" letterSpacing="2">
        완등 인증
      </text>
    </svg>
  )
}
