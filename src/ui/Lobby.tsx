import { useEffect, useMemo, useRef, useState } from 'react'
import { estimateMinutes, formatDuration, formatMinutes, type Trail, type TrailData } from '../lib/data'
import { useGame, type ClimbRecord, type ControlMode } from '../lib/store'
import { loadCourses, switchMountain, type Mountain } from '../lib/mountains'
import { othersClimbing, useNet } from '../lib/net'
import { AVATARS } from '../lib/avatars'
import { AvatarChips } from './AvatarChips'
import { playHudEnter } from '../lib/splash'
import { SKY_PRESETS, currentPhase, useSky, type Phase } from '../lib/daylight'

type LobbyProps = { trail: Trail; trails: Trail[]; mountains: Mountain[]; mountain: Mountain }
/** 코스 카드에 보여 줄 코스들. 다른 산은 받는 동안 'loading', 못 받으면 'failed' */
type CourseList = TrailData[] | 'loading' | 'failed'

/** 「지금」 하늘이 어떤 시간대인지 다시 보는 간격(ms). 베이스캠프를 오래 열어 두면 시간대가 바뀔 수 있다 */
const PHASE_CHECK_MS = 30000

/**
 * 베이스캠프: 출발 전에 산·코스·캐릭터·조작·하늘을 고르는 창.
 * 게임 로비처럼 출발점 3D 장면(내 캐릭터) 위에 띄운다. 다시 온 사람은 지난번 고른 것이 그대로라 「출발」만 누르면 된다.
 * 걷는 중에도 Esc(또는 코스 패널 버튼)로 다시 연다.
 */
export function Lobby(props: LobbyProps) {
  const mode = useGame((s) => s.mode)
  const open = mode === 'lobby'

  // Esc 로 열고 닫는다. 정상 도착 창·사진 중에는 열지 않는다
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat || e.target instanceof HTMLInputElement) return
      const g = useGame.getState()
      if (g.mode === 'hiking') g.openLobby()
      else if (g.mode === 'lobby') g.resume()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])

  // 베이스캠프를 닫고 걷기 시작하면 걷기 화면 패널들이 차례로 들어온다
  const wasOpen = useRef(open)
  useEffect(() => {
    if (wasOpen.current && !open) playHudEnter()
    wasOpen.current = open
  }, [open])

  if (!open) return null
  return <LobbyPanel {...props} />
}

function LobbyPanel({ trail, trails, mountains, mountain }: LobbyProps) {
  // 탭에서 보고 있는 산. 지금 지형이 열린 산(mountain)과 다를 수 있다
  const [shownMountain, setShownMountain] = useState(mountain)
  const [courseId, setCourseId] = useState(trail.data.id)
  const [otherCourses, setOtherCourses] = useState<{ mountainId: string; courses: CourseList }>()
  const distance = useGame((s) => s.distance)
  const records = useGame((s) => s.records)
  const onOpenMountain = shownMountain.id === mountain.id

  // 다른 산 탭을 누르면 그 산의 코스 목록만 받아 카드로 보여 준다 (지형은 출발할 때 받는다)
  useEffect(() => {
    if (onOpenMountain) return
    let alive = true
    loadCourses(shownMountain.id)
      .then((courses) => {
        if (!alive) return
        setOtherCourses({ mountainId: shownMountain.id, courses })
        setCourseId((id) => (courses.some((c) => c.id === id) ? id : courses[0]?.id ?? id))
      })
      .catch(() => alive && setOtherCourses({ mountainId: shownMountain.id, courses: 'failed' }))
    return () => {
      alive = false
    }
  }, [onOpenMountain, shownMountain.id])

  const courses: CourseList = onOpenMountain
    ? trails.map((t) => t.data)
    : otherCourses?.mountainId === shownMountain.id
      ? otherCourses.courses
      : 'loading'
  const picked = Array.isArray(courses) ? courses.find((c) => c.id === courseId) : undefined
  // 오르다 만 코스. 그 코스를 고르면 이어서 오를 수 있다
  const unfinishedId = onOpenMountain && distance > 0 ? trail.data.id : null
  const midway = courseId === unfinishedId

  const pickMountain = (m: Mountain) => {
    setShownMountain(m)
    if (m.id === mountain.id) setCourseId(trail.data.id)
  }

  const start = (fromScratch = false) => {
    if (!picked) return
    const g = useGame.getState()
    if (!onOpenMountain) switchMountain(shownMountain, picked.id)
    else if (picked.id !== trail.data.id) g.setCourse(picked.id)
    else if (fromScratch) g.restart()
    else g.resume()
  }

  // Enter 로 출발 (닉네임을 고치는 중에는 끈다)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || e.target instanceof HTMLInputElement) return
      // 「처음부터」 같은 일반 버튼에 포커스가 있으면 그 버튼이 눌리게 둔다. 코스 카드·산 탭·캐릭터처럼 고르는 버튼이면 출발한다
      if (e.target instanceof HTMLButtonElement) {
        const role = e.target.getAttribute('role')
        if (role !== 'radio' && role !== 'tab') return
      }
      e.preventDefault()
      start()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  })

  return (
    <div className="lobby" role="dialog" aria-label="베이스캠프">
      <section className="panel lobby-panel">
        <header className="lobby-head">
          <div className="eyebrow">베이스캠프</div>
          <h2>어디로 오를까요?</h2>
        </header>

        {mountains.length > 1 && (
          <div className="mountain-tabs" role="tablist" aria-label="산">
            {mountains.map((m) => (
              <MountainTab key={m.id} mountain={m} selected={m.id === shownMountain.id} done={doneIn(records, m)} onPick={() => pickMountain(m)} />
            ))}
          </div>
        )}

        <div className="lobby-courses" role="radiogroup" aria-label="코스">
          {courses === 'loading' && <p className="lobby-note">코스를 불러오는 중…</p>}
          {courses === 'failed' && <p className="lobby-note">코스를 불러오지 못했어요. 잠시 뒤 다시 눌러 주세요</p>}
          {Array.isArray(courses) &&
            courses.map((c) => (
              <CourseCard
                key={c.id}
                course={c}
                selected={c.id === courseId}
                unfinished={c.id === unfinishedId}
                climbs={records.filter((r) => r.trailId === c.id).length}
                best={bestOf(records, c.id)}
                onPick={() => setCourseId(c.id)}
              />
            ))}
        </div>
      </section>

      {/* 게임 로비처럼 모드와 캐릭터를 출발 버튼 곁에 둔다 (좁은 창에서도 스크롤 없이 보인다) */}
      <div className="lobby-actions">
        <AvatarStrip />
        <ControlSwitch />
        <SkySwitch />
        <div className="lobby-buttons">
          {midway && (
            <button className="btn lobby-restart" onClick={() => start(true)}>
              처음부터
            </button>
          )}
          <button className="btn primary lobby-start" disabled={!picked} onClick={() => start()}>
            {midway ? '이어서 오르기' : onOpenMountain ? '출발' : `${shownMountain.name}으로 출발`}
            <span className="lobby-key" aria-hidden>
              Enter
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

/** 그 코스의 가장 빠른 완등 시간(초). 오른 적이 없으면 null */
function bestOf(records: ClimbRecord[], courseId: string) {
  const times = records.filter((r) => r.trailId === courseId).map((r) => r.durationSec)
  return times.length ? Math.min(...times) : null
}

/** 그 산에서 한 번이라도 오른 코스 수. 코스 id 가 「산 id-」로 시작한다 (예: bukhansan-baegundae) */
function doneIn(records: ClimbRecord[], m: Mountain) {
  const ids = new Set(records.filter((r) => r.trailId.startsWith(`${m.id}-`)).map((r) => r.trailId))
  return Math.min(ids.size, m.courses)
}

/** 산 탭: 이름과 높이, 오른 코스가 있으면 「2/5 완등」, 없으면 코스 수 */
function MountainTab({ mountain, selected, done, onPick }: { mountain: Mountain; selected: boolean; done: number; onPick: () => void }) {
  return (
    <button role="tab" aria-selected={selected} className={selected ? 'mountain-tab selected' : 'mountain-tab'} onClick={onPick}>
      <span className="mountain-tab-name">{mountain.name}</span>
      <span className="mountain-tab-meta">
        {mountain.elevation}m · {done > 0 ? `${done}/${mountain.courses} 완등` : `코스 ${mountain.courses}개`}
      </span>
    </button>
  )
}

/** 코스 카드: 이름·난이도, 출발→도착, 거리·오르막·실제 예상 시간, 고도 그래프, 완등 횟수와 지금 오르는 사람 수 */
function CourseCard({
  course,
  selected,
  unfinished,
  climbs,
  best,
  onPick,
}: {
  course: TrailData
  selected: boolean
  /** 오르다 만 코스인지 */
  unfinished: boolean
  climbs: number
  /** 가장 빠른 완등 시간(초). 오른 적이 없으면 null */
  best: number | null
  onPick: () => void
}) {
  const climbing = useNet((s) => (s.status === 'online' ? othersClimbing(s.counts, course.id) : 0))
  const minutes = estimateMinutes(course.length, course.elevationGain)
  return (
    <button role="radio" aria-checked={selected} className={selected ? 'course-card selected' : 'course-card'} onClick={onPick}>
      <span className="course-card-top">
        <span className="course-card-name">{course.name}</span>
        <span className={`level level-${course.level}`}>{course.level}</span>
        {unfinished && <span className="course-card-tag">오르던 코스</span>}
      </span>
      <span className="course-card-route">
        {course.start} → {course.summit}
      </span>
      <Profile points={course.points} />
      <span className="course-card-stats">
        <span>{(course.length / 1000).toFixed(1)}km</span>
        <span>↗ {course.elevationGain}m</span>
        <span>약 {formatMinutes(minutes)}</span>
        {climbs > 0 && (
          <span className="course-card-done">
            ✓ 완등 {climbs}회{best !== null && ` · 최고 ${formatDuration(best)}`}
          </span>
        )}
        {climbing > 0 && <span className="course-card-live">● {climbing}명 오르는 중</span>}
      </span>
    </button>
  )
}

/** 고도 그래프 그림판 크기. CSS 가 카드 너비에 맞춰 늘린다 */
const PROFILE_W = 300
const PROFILE_H = 34
/** 그래프에 찍는 점 수. 이 정도면 굴곡이 보이고 SVG 가 가볍다 */
const PROFILE_SAMPLES = 60

/** 고도 단면 그래프 (등산 앱 코스 카드처럼). 가로는 등산로 거리, 세로는 해발. points 는 [x, 해발, z] */
function Profile({ points }: { points: [number, number, number][] }) {
  const path = useMemo(() => {
    // 출발점부터 각 점까지 걸은 거리
    const walked = [0]
    for (let i = 1; i < points.length; i++)
      walked.push(walked[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][2] - points[i - 1][2]))
    const total = walked[walked.length - 1] || 1
    let lowest = Infinity
    let highest = -Infinity
    for (const p of points) {
      lowest = Math.min(lowest, p[1])
      highest = Math.max(highest, p[1])
    }
    const span = Math.max(highest - lowest, 1)
    const coords: string[] = []
    let k = 0
    for (let s = 0; s <= PROFILE_SAMPLES; s++) {
      const at = (total * s) / PROFILE_SAMPLES
      while (k < walked.length - 2 && walked[k + 1] < at) k++
      const height = (points[k][1] - lowest) / span
      // 아래 2px, 위 4px 여백을 남기고 그린다
      coords.push(`${((at / total) * PROFILE_W).toFixed(1)},${(PROFILE_H - 2 - height * (PROFILE_H - 6)).toFixed(1)}`)
    }
    return `M0,${PROFILE_H} L${coords.join(' L')} L${PROFILE_W},${PROFILE_H} Z`
  }, [points])
  return (
    <svg className="course-card-profile" viewBox={`0 0 ${PROFILE_W} ${PROFILE_H}`} preserveAspectRatio="none" aria-hidden>
      <path d={path} />
    </svg>
  )
}

/** 「지금」 타일에 보여 줄 미니 하늘. 실제 시간대마다 다른 그라데이션(index.css 의 .sky-swatch) */
const PHASE_SWATCH: Record<Phase, string> = { 새벽: 'dawn', 아침: 'morning', 낮: 'day', 저녁: 'sunset', 밤: 'night' }

/** 하늘 고르기. 「지금」은 실제 한국 시각을 따라가고 나머지는 그 시간대로 고정한다. 타일마다 미니 하늘을 보여 주고, 고르면 뒤의 장면이 1초쯤에 걸쳐 바뀐다 */
function SkySwitch() {
  const preset = useSky((s) => s.preset)
  const setPreset = useSky((s) => s.setPreset)
  // 「지금」이 어떤 시간대인지 보여 준다
  const [phase, setPhase] = useState(currentPhase)
  useEffect(() => {
    const t = window.setInterval(() => setPhase(currentPhase()), PHASE_CHECK_MS)
    return () => window.clearInterval(t)
  }, [])
  return (
    <div className="panel lobby-sky">
      <div className="lobby-label">
        하늘 <b>{preset === 'now' ? `지금은 ${phase}` : SKY_PRESETS.find((p) => p.kind === preset)?.label}</b>
      </div>
      <div className="segmented sky-segmented" role="radiogroup" aria-label="하늘 고르기">
        {SKY_PRESETS.map((p) => (
          <button key={p.kind} role="radio" aria-checked={preset === p.kind} className={preset === p.kind ? 'selected' : ''} onClick={() => setPreset(p.kind)}>
            <span className={`sky-swatch ${p.kind === 'now' ? PHASE_SWATCH[phase] : p.kind}`} aria-hidden />
            <span className="segmented-title">{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** 조작 방식 [값, 이름, 설명] */
const CONTROL_MODES: [ControlMode, string, string][] = [
  ['easy', '쉬운 조작', '버튼 하나로 길 따라 걸어요'],
  ['free', '자유 조작', '길 밖까지 마음대로 걸어요'],
]

/** 조작 방식 고르기. 쉬운 조작은 큰 「걷기」 버튼 하나로 등산로를 따라 저절로 걷는다 */
function ControlSwitch() {
  const controlMode = useGame((s) => s.controlMode)
  const setControlMode = useGame((s) => s.setControlMode)
  return (
    <div className="panel lobby-control">
      <div className="lobby-label">
        조작 <b>{CONTROL_MODES.find(([m]) => m === controlMode)?.[1]}</b>
      </div>
      <div className="segmented control-segmented" role="radiogroup" aria-label="조작 방식 고르기">
        {CONTROL_MODES.map(([mode, title, desc]) => (
          <button key={mode} role="radio" aria-checked={controlMode === mode} className={controlMode === mode ? 'selected' : ''} onClick={() => setControlMode(mode)}>
            <span className="segmented-title">{title}</span>
            <span className="segmented-sub">{desc}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** 캐릭터 고르기 줄. 고르면 뒤의 3D 캐릭터가 바로 바뀐다 */
function AvatarStrip() {
  const avatar = useGame((s) => s.avatar)
  const current = AVATARS.find((a) => a.kind === avatar)
  return (
    <div className="panel lobby-avatars">
      <div className="lobby-label">
        캐릭터 <b>{current?.name}</b>
      </div>
      <AvatarChips />
    </div>
  )
}
