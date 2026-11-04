import { useEffect, useMemo, useState } from 'react'
import { estimateMinutes, type Trail } from '../lib/data'
import { input, useGame } from '../lib/store'

function formatMinutes(min: number) {
  const h = Math.floor(min / 60)
  return h ? `${h}시간 ${min % 60}분` : `${min}분`
}

function formatDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)}km` : `${Math.round(m)}m`
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
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        // 페이지 스크롤이나 포커스된 버튼 누름을 막고, 꾹 눌러도 한 번만 뛴다
        e.preventDefault()
        if (!e.repeat) input.jump = true
        return
      }
      set(e, true)
    }
    const up = (e: KeyboardEvent) => set(e, false)
    const blur = () => Object.assign(input, { forward: false, backward: false, run: false, jump: false })
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
  const sections = useMemo(() => trail.sections(), [trail])
  const progress = distance / trail.length
  const elevation = Math.round(trail.positionAt(distance).y)
  const remaining = Math.max(0, trail.length - distance)
  const realMinutes = estimateMinutes(trail.data.length, trail.data.elevationGain)
  const left = trail.statsBetween(distance, trail.length)
  const leftMinutes = estimateMinutes(left.length, left.gain)
  const current = sections.findIndex((s) => distance < s.end)
  const next = sections[current === -1 ? sections.length - 1 : current]

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
        {/* 실제로 걸을 때 구간별 거리와 예상 시간 (코스 예습) */}
        <ol className="sections">
          {sections.map((sec, i) => (
            <li key={sec.to} className={i < current || current === -1 ? 'done' : i === current ? 'now' : ''}>
              <span className="sec-name">{sec.to}</span>
              <span className="sec-meta">
                {formatDistance(sec.length)} · 약 {formatMinutes(sec.minutes)}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="panel progress">
        <div className="progress-row">
          <span>
            현재 고도 <b>{elevation}m</b>
          </span>
          <span>
            다음 <b>{next.to}</b> {formatDistance(Math.max(0, next.end - distance))}
          </span>
        </div>
        <div className="bar">
          <div className="bar-fill" style={{ width: `${progress * 100}%` }} />
          {trail.data.checkpoints.map((cp) => (
            <i
              key={cp.name}
              className={distance >= cp.distance ? 'tick passed' : 'tick'}
              style={{ left: `${(cp.distance / trail.length) * 100}%` }}
              title={cp.name}
            />
          ))}
        </div>
        <div className="progress-row sub">
          <span>정상까지 {formatDistance(remaining)}</span>
          <span>실제로는 약 {formatMinutes(leftMinutes)} 남음</span>
        </div>
        <div className="hint">W/↑ 걷기 · S/↓ 뒤로 · Shift 빨리 · Space 점프 · 마우스로 시점 회전</div>
      </div>

      <ArrivalToast trail={trail} />
      <HoldButton label="걷기" onHold={(on) => (input.forward = on)} />
      <HoldButton label="점프" className="jump" onHold={(on) => on && (input.jump = true)} />
    </>
  )
}

const TOAST_MS = 4500

/** 이정표에 처음 닿으면 몇 초 동안 이름과 설명, 남은 실제 시간을 띄운다 */
function ArrivalToast({ trail }: { trail: Trail }) {
  const arrival = useGame((s) => s.arrival)
  // 시간이 지나 숨긴 알림의 at. 새 도착(at 이 다름)은 바로 보인다
  const [hiddenAt, setHiddenAt] = useState<number | null>(null)

  useEffect(() => {
    if (!arrival) return
    const t = setTimeout(() => setHiddenAt(arrival.at), TOAST_MS)
    return () => clearTimeout(t)
  }, [arrival])

  if (!arrival || hiddenAt === arrival.at) return null
  const cp = trail.data.checkpoints[arrival.index]
  const left = trail.statsBetween(cp.distance, trail.length)
  return (
    <div className="toast" key={arrival.at} role="status">
      <div className="toast-title">{cp.name} 도착</div>
      <div className="toast-note">{cp.note}</div>
      <div className="toast-meta">
        해발 {Math.round(trail.positionAt(cp.distance).y)}m · 정상까지 {formatDistance(left.length)}, 실제로 약{' '}
        {formatMinutes(estimateMinutes(left.length, left.gain))}
      </div>
    </div>
  )
}

/** 터치 화면용 버튼: 누르면 onHold(true), 떼면 onHold(false) */
function HoldButton({ label, className, onHold }: { label: string; className?: string; onHold: (on: boolean) => void }) {
  return (
    <button
      className={className ? `hold-button ${className}` : 'hold-button'}
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
