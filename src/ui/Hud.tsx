import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { estimateMinutes, formatDuration, formatMinutes, type Trail } from '../lib/data'
import { input, releaseInput, useGame } from '../lib/store'
import { AVATARS, useAvatarThumbs } from '../lib/avatars'
import { LANDMARK_ICON, landmarkKind } from '../lib/landmarks'
import { MiniMap } from './MiniMap'
import { TogetherPanel } from './TogetherPanel'
import { TouchControls, TouchGuide } from './TouchControls'
import { AvatarChips } from './AvatarChips'
import { EmoteDial } from './EmoteDial'
import { useWakeLock } from '../lib/wakeLock'
import { IS_IOS, IS_TOUCH } from '../lib/device'
import { readStored, writeStored } from '../lib/storage'

function formatDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)}km` : `${Math.round(m)}m`
}

/** 키보드 입력 연결 */
function useKeyboard() {
  useEffect(() => {
    const set = (e: KeyboardEvent, on: boolean) => {
      if (e.code === 'ArrowUp') input.forward = on
      else if (e.code === 'ArrowDown') input.backward = on
      else if (e.code === 'ArrowLeft') input.left = on
      else if (e.code === 'ArrowRight') input.right = on
      else if (e.key === 'Shift') input.run = on
    }
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return // 닉네임을 고치는 중
      if (e.code === 'Space') {
        // 페이지 스크롤이나 포커스된 버튼 누름을 막고, 꾹 눌러도 한 번만 뛴다
        e.preventDefault()
        if (!e.repeat) input.jump = true
        return
      }
      set(e, true)
    }
    const up = (e: KeyboardEvent) => set(e, false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', releaseInput)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', releaseInput)
    }
  }, [])
}

export function Hud({ trail, trails }: { trail: Trail; trails: Trail[] }) {
  useKeyboard()
  // 코스 정보는 컴퓨터에서는 펼쳐 두고, 폰에서는 3D 화면을 가리지 않게 접어 둔다 (이름만 보인다).
  // 컴퓨터라도 창이 작으면 접어 둔다. 작은 창에서 직접 펴거나 접은 것은 이번에 여는 동안 작은 창일 때만 따른다
  const [storedFold, toggleStoredFold] = useFolded('course', !OPEN_BY_DEFAULT)
  const smallWindow = useMediaQuery(SMALL_WINDOW) && !IS_TOUCH
  // 작은 창에서 직접 고른 값. 지금 창이 크면 쓰지 않고 저장해 둔 값(storedFold)을 따른다
  const [smallFold, setSmallFold] = useState<{ small: boolean; folded: boolean } | null>(null)
  const courseFolded = smallFold?.small === smallWindow ? smallFold.folded : smallWindow || storedFold
  const toggleCourse = () => (smallWindow ? setSmallFold({ small: true, folded: !courseFolded }) : toggleStoredFold())
  const distance = useGame((s) => s.distance)
  const mode = useGame((s) => s.mode)
  const controlMode = useGame((s) => s.controlMode)
  const sections = useMemo(() => trail.sections(), [trail])
  const progress = distance / trail.length
  const elevation = Math.round(trail.positionAt(distance).y)
  const remaining = Math.max(0, trail.length - distance)
  const realMinutes = estimateMinutes(trail.data.length, trail.data.elevationGain)
  const left = trail.statsBetween(distance, trail.length)
  const leftMinutes = estimateMinutes(left.length, left.gain)
  const current = sections.findIndex((s) => distance < s.end)
  const next = sections[current === -1 ? sections.length - 1 : current]
  // 폰에서 걷는 동안은 화면이 꺼지지 않게 한다
  useWakeLock(IS_TOUCH && mode === 'hiking')

  if (mode !== 'hiking') return null

  return (
    <>
      {/* 위쪽 패널들: 왼쪽은 코스, 오른쪽은 캐릭터와 도움말. 좁은 화면에서는 위아래로 쌓인다 */}
      <div className="hud-top">
        <section className="panel course">
          <div className="course-head">
            <div className="eyebrow">
              {trail.data.mountain} · {trail.data.level}
            </div>
            <button className="link-button" title="베이스캠프 열기 (Esc)" onClick={() => useGame.getState().openLobby()}>
              산·코스 바꾸기
            </button>
            <FoldButton label="코스 정보" collapsed={courseFolded} onToggle={toggleCourse} />
          </div>
          <h1>{trail.data.name}</h1>
          {!courseFolded && (
            <>
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
            </>
          )}
        </section>
        <div className="side-stack">
          <AvatarPanel />
          <HelpPanel />
        </div>
        {/* 걷는 동안 보는 패널: 해발 고도와 다음 이정표만 크게, 나머지는 작게 */}
        <div className="panel progress">
          <div className="progress-main">
            <div>
              <span className="progress-label">해발</span>
              <span className="progress-alt">
                {elevation}
                <small>m</small>
              </span>
            </div>
            <div className="progress-next">
              <span className="progress-label">다음</span>
              <span className="progress-next-name">{next.to}</span>
              <span className="progress-next-dist">{formatDistance(Math.max(0, next.end - distance))}</span>
            </div>
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
          <div className="progress-row">
            <span>정상까지 {formatDistance(remaining)}</span>
            <span>실제로는 약 {formatMinutes(leftMinutes)}</span>
          </div>
        </div>
      </div>

      <ArrivalTitle trail={trail} />
      <RoamNotice />
      <MiniMap trail={trail} trails={trails} />
      <TogetherPanel trail={trail} />
      {/* 터치 화면: 왼쪽 아래 조이스틱으로 걷고 오른쪽 아래 버튼으로 뛴다. 마우스 기기에서는 CSS 가 숨긴다 */}
      {/* 쉬운 조작은 조이스틱 대신 큰 「걷기」 버튼 하나로 등산로를 따라 걷는다 */}
      {controlMode === 'free' ? <TouchControls /> : <WalkButton />}
      <TouchGuide />
      <EmoteDial />
      <HoldButton label="점프" className="jump" onHold={(on) => on && (input.jump = true)} />
    </>
  )
}

/** 코스와 캐릭터 패널을 기본으로 펼쳐 두는 것으로 바꿔, 예전에 접어 둔 기억(folded2:)은 쓰지 않는다 */
const FOLD_KEY = 'hiking-metaverse:folded3:'
/** 코스·캐릭터 패널을 처음에 펼쳐 둘지. 폰·태블릿은 펼치면 3D 화면을 많이 가려 접어 둔다 */
const OPEN_BY_DEFAULT = !IS_TOUCH
/** 코스 패널을 접어 두는 작은 컴퓨터 창. 이보다 작으면 펼친 코스 패널이 산과 캐릭터를 가린다 */
const SMALL_WINDOW = '(max-width: 1000px), (max-height: 700px)'

/** 미디어 쿼리가 맞는지. 창 크기가 바뀌면 다시 그린다 */
function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

/** 패널을 접었는지. 패널마다 브라우저에 기억하고, 기억이 없으면 foldedByDefault 를 따른다 */
function useFolded(name: string, foldedByDefault = true): [boolean, () => void] {
  const [folded, setFolded] = useState(() => {
    const saved = readStored(FOLD_KEY + name)
    return saved === null ? foldedByDefault : saved === '1'
  })
  const toggle = () =>
    setFolded((f) => {
      writeStored(FOLD_KEY + name, f ? '0' : '1')
      return !f
    })
  return [folded, toggle]
}

function FoldIcon() {
  return (
    <svg className="fold-icon" width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 접기·펼치기 단추 (코스 패널처럼 머리줄에 다른 단추가 있을 때) */
function FoldButton({ label, collapsed, onToggle }: { label: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <button className="fold-button" aria-expanded={!collapsed} aria-label={`${label} ${collapsed ? '펼치기' : '접기'}`} onClick={onToggle}>
      <FoldIcon />
    </button>
  )
}

/** 오른쪽 위 패널. 머리줄 전체를 눌러 접고 편다 */
function SidePanel({
  name,
  title,
  sub,
  className,
  open,
  children,
}: {
  name: string
  title: string
  sub?: ReactNode
  className?: string
  /** 처음에 펼쳐 둘지 (기억이 없을 때) */
  open?: boolean
  children: ReactNode
}) {
  const [folded, toggle] = useFolded(name, !open)
  return (
    <section className={`panel side-panel ${className ?? ''}`}>
      <button className="side-head" aria-expanded={!folded} onClick={toggle}>
        <span className="side-title">{title}</span>
        {sub && <span className="side-sub">{sub}</span>}
        <FoldIcon />
      </button>
      {!folded && <div className="side-body">{children}</div>}
    </section>
  )
}

/** 캐릭터 고르기. 모습 그림을 누르면 바로 바뀐다 (그림을 만들기 전에는 이름) */
function AvatarPanel() {
  const avatar = useGame((s) => s.avatar)
  const thumbs = useAvatarThumbs((s) => s.thumbs)
  const current = AVATARS.find((a) => a.kind === avatar)

  return (
    <SidePanel
      name="avatar"
      open={OPEN_BY_DEFAULT}
      title="캐릭터"
      className="avatar-panel"
      sub={
        <>
          {thumbs[avatar] && <img src={thumbs[avatar]} alt="" className="avatar-mini" />}
          {current?.name}
        </>
      }
    >
      <AvatarChips />
    </SidePanel>
  )
}

/** 키보드 조작 도움말 [누를 키 묶음, 설명, 덧붙임] */
const HELP: [string[][], string, string?][] = [
  [[['↑']], '앞으로 걷기', '보고 있는 쪽으로 걸어요'],
  [[['←', '→']], '몸 돌리기', '↑ 와 같이 누르면 걸으면서 돌아요'],
  [[['↓']], '뒤로 물러나기'],
  [[['Shift']], '빨리 걷기', '걷는 키와 같이 눌러요'],
  [[['Space']], '점프'],
  [[['드래그']], '둘러보기', '마우스로 끌면 내 캐릭터 정면도 봐요. 다시 걸으면 등 뒤로 돌아와요'],
  [[['휠']], '확대·축소', '마우스 휠을 굴려요'],
  [[['1', '~', '7']], '인사하기', '👋 안녕하세요부터 🔥 파이팅까지 일곱 가지가 머리 위에 떠요'],
  [[['길 밖']], '자유롭게 걷기', '등산로에서 20m까지 걸어 나갈 수 있어요. 나무와 바위는 돌아서 가요'],
]

function HelpPanel() {
  return (
    <SidePanel name="help" title="도움말" sub="키보드 조작" className="help-panel">
      <dl className="help-list">
        {HELP.map(([groups, label, note]) => (
          <div key={label} className="help-row">
            <dt>
              {groups.map((keys, gi) => (
                <span key={gi} className="help-keys">
                  {gi > 0 && <span className="help-or">또는</span>}
                  {keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </span>
              ))}
            </dt>
            <dd>
              {label}
              {note && <small>{note}</small>}
            </dd>
          </div>
        ))}
      </dl>
    </SidePanel>
  )
}

/** 등산로에서 멀어질수록 화면 가장자리가 어두워지고, 경계에 가까우면 돌아가라는 안내가 뜬다 */
function RoamNotice() {
  const roam = useGame((s) => s.roam)
  return (
    <>
      <div className="roam-vignette" style={{ opacity: roam }} aria-hidden />
      {roam >= 0.35 && (
        <div className="roam-hint" role="status">
          <span aria-hidden>🧭</span> 등산로에서 멀어지고 있어요. 길 쪽으로 돌아가요
        </div>
      )}
    </>
  )
}

/** 도착 연출이 떠 있는 시간(ms). CSS 의 arrival 애니메이션 길이와 같게 */
const ARRIVAL_MS = 4800

/**
 * 이정표에 처음 닿으면 오픈월드 게임의 지역 진입 연출처럼 화면 위쪽 가운데에 이름을 크게 띄웠다가 걷어 낸다.
 * 상자 없이 글씨만 띄워 풍경을 가리지 않는다
 */
function ArrivalTitle({ trail }: { trail: Trail }) {
  const arrival = useGame((s) => s.arrival)
  // 시간이 지나 숨긴 알림의 at. 새 도착(at 이 다름)은 바로 보인다
  const [hiddenAt, setHiddenAt] = useState<number | null>(null)

  useEffect(() => {
    if (!arrival) return
    const t = setTimeout(() => setHiddenAt(arrival.at), ARRIVAL_MS)
    return () => clearTimeout(t)
  }, [arrival])

  if (!arrival || hiddenAt === arrival.at) return null
  const cp = trail.data.checkpoints[arrival.index]
  const left = trail.statsBetween(cp.distance, trail.length)
  const total = trail.data.checkpoints.length
  return (
    <div className="arrival" key={arrival.at} role="status" aria-label={`${cp.name} 도착`}>
      <div className="arrival-eyebrow">
        이정표 {arrival.index + 1} / {total} · 해발 {Math.round(trail.positionAt(cp.distance).y)}m
      </div>
      <div className="arrival-title">
        <span className="arrival-icon" aria-hidden>
          {LANDMARK_ICON[landmarkKind(cp.name)]}
        </span>
        {cp.name}
      </div>
      {cp.note && <div className="arrival-note">{cp.note}</div>}
      <div className="arrival-meta">
        정상까지 {formatDistance(left.length)} · 실제로는 약 {formatMinutes(estimateMinutes(left.length, left.gain))}
      </div>
    </div>
  )
}

/**
 * 쉬운 조작의 「걷기」 버튼. 한 번 누르면 등산로를 따라 저절로 걷고, 다시 누르면 멈춘다 (src/scene/World.tsx).
 * 어르신·아이도 누를 수 있게 크게 두고 지금 상태를 글자로 보여 준다
 */
function WalkButton() {
  const autoWalk = useGame((s) => s.autoWalk)
  const setAutoWalk = useGame((s) => s.setAutoWalk)
  return (
    <button className={autoWalk ? 'walk-button on' : 'walk-button'} aria-pressed={autoWalk} onClick={() => setAutoWalk(!autoWalk)}>
      <svg className="walk-icon" viewBox="0 0 24 24" aria-hidden>
        {autoWalk ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /> : <path d="M8 4.5v15l12-7.5z" fill="currentColor" />}
      </svg>
      <span>{autoWalk ? '멈추기' : '걷기'}</span>
    </button>
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
  const photoName = `${trail.data.id}-${now.toISOString().slice(0, 10)}.png`
  const shareFile = useShareFile(mode === 'photoResult' ? photo : null, photoName)
  const saveViaShare = IS_IOS && shareFile !== null

  if (mode === 'photo') return <div className="flash" />

  if (mode === 'photoResult' && photo) {
    return (
      <div className="overlay">
        <div className="panel modal photo-modal">
          <div className="modal-brand">방구석 등반대 · 정상 기념사진</div>
          <img src={photo} alt="정상 기념사진" />
          <div className="actions">
            {/* 폰에서는 카카오톡·인스타그램 등으로 바로 보내는 공유가 주 버튼이고, 공유를 못 하는 컴퓨터에서는 저장이 주 버튼이다 */}
            {shareFile && (
              <button
                className="btn primary"
                onClick={() => {
                  const { mountain, summit, summitElevation } = trail.data
                  navigator
                    .share({ files: [shareFile], title: '방구석 등반대', text: `${mountain} ${summit} ${summitElevation}m 완등! ⛰️🚩 방구석 등반대에서 올랐어요` })
                    .catch(() => {
                      // 공유 창을 닫은 것(AbortError)은 그냥 둔다
                    })
                }}
              >
                사진 공유
              </button>
            )}
            {saveViaShare ? (
              // 아이폰: 내려받으면 파일 앱에 들어가므로 공유 창을 열어 「이미지 저장」으로 사진 앱에 넣게 한다.
              // 글을 같이 넘기면 공유 창에 「이미지 저장」이 빠지기도 해서 사진 파일만 넘긴다
              <button
                className="btn"
                onClick={() => {
                  navigator.share({ files: [shareFile] }).catch(() => {
                    // 공유 창을 닫은 것(AbortError)은 그냥 둔다
                  })
                }}
              >
                사진 저장
              </button>
            ) : (
              <a className={shareFile ? 'btn' : 'btn primary'} href={photo} download={photoName}>
                사진 저장
              </a>
            )}
            <button className="btn" onClick={closePhoto}>
              닫기
            </button>
          </div>
          {saveViaShare && <p className="photo-hint">공유 창에서 「이미지 저장」을 누르면 사진 앱에 들어가요.</p>}
        </div>
      </div>
    )
  }

  if (mode !== 'summit') return null

  const mine = records.filter((r) => r.trailId === trail.data.id)
  const count = mine.length
  const duration = startedAt && finishedAt ? Math.round((finishedAt - startedAt) / 1000) : 0
  // 방금 저장한 기록(맨 끝)을 뺀 예전 기록 가운데 가장 빠른 것과 비교한다. 첫 완등이면 비교하지 않는다
  const before = mine.slice(0, -1).map((r) => r.durationSec)
  const prevBest = before.length ? Math.min(...before) : null
  const best = Math.min(duration, prevBest ?? duration)
  const faster = prevBest !== null && duration < prevBest ? prevBest - duration : 0

  return (
    <div className="overlay">
      <div className="panel modal summit-modal">
        <div className="modal-brand">방구석 등반대</div>
        <div className="badge-wrap">
          <Badge trail={trail} />
        </div>
        <h2>정상 도착!</h2>
        <p className="modal-sub">
          {trail.data.mountain} {trail.data.summit} {trail.data.summitElevation}m 를 완등했어요.
        </p>
        <dl className="stats summit-stats">
          <div>
            <dt>걸린 시간</dt>
            <dd>{formatDuration(duration)}</dd>
          </div>
          <div>
            <dt>최고 기록</dt>
            <dd>{formatDuration(best)}</dd>
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
        {faster > 0 && (
          <p className="summit-best" role="status">
            🎉 새 최고 기록이에요! {faster >= 60 ? `${Math.floor(faster / 60)}분 ${faster % 60}초` : `${faster}초`} 빨라졌어요
          </p>
        )}
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

/**
 * 기념사진을 폰 공유 창(Web Share API)으로 보낼 파일. 공유할 수 없는 브라우저(대부분의 컴퓨터)면 null.
 * 파일을 미리 만들어 둔다. 누른 뒤에 만들면 iOS 사파리가 사용자가 누른 동작이 아니라고 보고 공유 창을 막는다
 */
function useShareFile(photo: string | null, fileName: string) {
  const [file, setFile] = useState<{ photo: string; file: File } | null>(null)
  useEffect(() => {
    if (!photo || typeof navigator.canShare !== 'function') return
    let alive = true
    fetch(photo)
      .then((r) => r.blob())
      .then((blob) => {
        const f = new File([blob], fileName, { type: 'image/png' })
        if (alive && navigator.canShare({ files: [f] })) setFile({ photo, file: f })
      })
      .catch(() => {
        // 파일을 못 만들면 저장 버튼만 쓴다
      })
    return () => {
      alive = false
    }
  }, [photo, fileName])
  // 다시 찍어 사진이 바뀌면 예전 파일은 쓰지 않는다
  return file && file.photo === photo ? file.file : null
}

function Badge({ trail }: { trail: Trail }) {
  return (
    <svg className="badge" viewBox="0 0 120 120" role="img" aria-label="완등 인증 배지">
      <defs>
        <linearGradient id="badge-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c2c47" />
          <stop offset="0.6" stopColor="#3b4a6b" />
          <stop offset="1" stopColor="#a7798a" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="56" fill="url(#badge-sky)" stroke="#ffd58a" strokeWidth="5" />
      <circle cx="60" cy="60" r="49" fill="none" stroke="rgba(255,213,138,0.35)" strokeWidth="1" />
      <circle cx="84" cy="44" r="7" fill="#ffb36b" />
      <path d="M22 84 L48 44 L60 60 L72 38 L98 84 Z" fill="#4c5677" />
      <path d="M72 38 L80 51 L66 51 Z" fill="#fdf6ec" />
      <path d="M48 44 L54 53 L42 53 Z" fill="#fdf6ec" />
      <text x="60" y="100" textAnchor="middle" fontSize="11" fontWeight="800" fill="#ffd58a">
        {trail.data.summit} {Math.round(trail.data.summitElevation)}m
      </text>
      <text x="60" y="28" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff" letterSpacing="2">
        완등 인증
      </text>
    </svg>
  )
}
