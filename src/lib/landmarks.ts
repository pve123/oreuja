import * as THREE from 'three'
import { meshHeight, type Checkpoint, type Terrain, type Trail } from './data'
import type { Obstacle } from './obstacles'

/**
 * 이정표 이름에 맞춰 세우는 랜드마크 종류.
 * - cairn: 고개·재(하루재)에 쌓은 돌탑
 * - pass: 깔딱고개. 돌탑 옆에 숨 고르는 나무 벤치
 * - temple: 절·암자(인수암, 보리사, 대동사). 붉은 기둥, 기와지붕, 연등
 * - hut: 산장(백운산장)·대피소(도봉산대피소). 막돌 벽에 처마가 넓은 낮은 지붕을 얹은 돌 산장. 대피소는 연두색 2층을 더 얹는다
 * - gate: 성문(백운봉암문). 이름에 암문·성문이 든 곳. 등산로가 위가 평평한 네모 문 사이로 지나간다
 * - ruins: 문터(수문터). 무너진 성벽 터
 * - waterfall: 폭포(개연폭포). 비스듬한 너럭바위를 타고 미끄러져 내리는 물줄기와 얕은 물웅덩이
 * - junction: 갈림길(소귀천계곡 갈림길). 화살표 판 세 장이 서로 다른 쪽을 가리키는 이정표 기둥
 * - spring: 샘터·약수터. 돌로 두른 물받이, 돌벽에서 나오는 물줄기, 기둥에 건 바가지
 * - sign: 그 밖의 이름. 나무 표지판
 * - boulder: 이름 붙은 바위(코끼리바위, 하마바위, 철모바위, 치마바위). 둥근 화강암 덩어리를 이름에 맞게 짜 맞춘다
 * - peak: 봉우리(도솔봉, 관음사 국기봉). 둥근 바위 무더기와 검은 정상석
 * - slab: 마당바위. 등산로를 따라 넓은 화강암 너럭바위를 지형 위에 깔고 표지판을 세운다
 * - ropes: 기차바위. 등산로를 따라 가파른 맨바위를 깔고, 바위 틈과 양쪽 밧줄을 놓는다
 * - rockgate: 바위 문(관악문). 바위 기둥 둘 위에 큰 바위가 얹히고 그 사이로 등산로가 지나간다
 * - ridge: 능선(포대능선). 등산로를 따라 좁은 바위 능선을 깔고 낮은 쪽에 쇠줄 난간을 놓는다
 * - pavilion: 정자(매월정). 육각 정자에 붉은 기둥, 초록 단청, 기와지붕
 * - trailhead: 출발점(탐방지원센터). 등산로를 가로지르는 나무 입구 문과 등산 안내도. 이정표가 아니라 코스마다 하나 세운다
 */
type LandmarkKind =
  | 'cairn'
  | 'pass'
  | 'temple'
  | 'hut'
  | 'gate'
  | 'ruins'
  | 'waterfall'
  | 'boulder'
  | 'peak'
  | 'slab'
  | 'ropes'
  | 'rockgate'
  | 'ridge'
  | 'pavilion'
  | 'junction'
  | 'spring'
  | 'sign'
  | 'trailhead'

/** 산성 대문(북한산성 대동문) 크기(m): 문구멍 반폭, 홍예가 시작하는 높이, 성벽 반길이·높이·두께 (src/scene/Landmarks.tsx 의 FortressGate) */
export const FORTRESS = { half: 1.5, spring: 2.4, wall: 10, top: 5.2, depth: 3 }

/** 산성 대문 충돌 원 (+z 가 진행 방향). 문구멍 양옆 벽을 1.15m 간격 원으로 막는다 */
export const FORTRESS_COLLIDERS: Obstacle[] = [-1, 1].flatMap((s) =>
  Array.from({ length: 8 }, (_, i) => ({ x: s * (FORTRESS.half + 0.9 + i * 1.15), z: 0, r: 0.9, height: FORTRESS.top })),
)

/** 출발점 입구 문을 세울 거리(m). 처음 화면에서 캐릭터 앞에 보이게 */
const TRAILHEAD_AT = 10

/** 랜드마크 이름표와 이정표 도착 연출에 붙이는 그림 문자 */
export const LANDMARK_ICON: Record<LandmarkKind, string> = {
  cairn: '🪨',
  pass: '😮‍💨',
  temple: '🏮',
  hut: '🏠',
  gate: '🏯',
  ruins: '🧱',
  waterfall: '💧',
  boulder: '🪨',
  peak: '⛰️',
  slab: '🪨',
  ropes: '🧗',
  rockgate: '🪨',
  ridge: '⛰️',
  pavilion: '⛩️',
  junction: '🧭',
  spring: '🚰',
  sign: '🪧',
  trailhead: '🥾',
}

/** 이정표 이름에 든 낱말로 랜드마크 종류를 고른다. 위에서부터 먼저 맞는 것을 쓴다 */
export function landmarkKind(name: string): LandmarkKind {
  if (name.includes('폭포')) return 'waterfall'
  if (name.includes('산장') || name.includes('대피소')) return 'hut'
  if (name.includes('갈림길')) return 'junction'
  if (name.includes('샘터') || name.includes('약수')) return 'spring'
  if (name.includes('관악문')) return 'rockgate'
  if (name.includes('능선')) return 'ridge'
  if (name.includes('문터')) return 'ruins'
  // 성문은 암문·성문만. 우이암 코스의 하늘문처럼 「문」이 든 다른 지점은 표지판으로 둔다
  if (name.includes('암문') || name.includes('성문')) return 'gate'
  if (name.includes('깔딱')) return 'pass'
  if (name.endsWith('재') || name.includes('고개')) return 'cairn'
  if (name.endsWith('암') || name.endsWith('사')) return 'temple'
  if (name.includes('마당바위')) return 'slab'
  if (name.includes('기차바위')) return 'ropes'
  if (name.endsWith('바위')) return 'boulder'
  if (name.endsWith('봉')) return 'peak'
  if (name.endsWith('정')) return 'pavilion'
  return 'sign'
}

/** 랜드마크 종류마다 정한 크기와 자리 */
type Spec = {
  /** 등산로 가운데에서 옆으로 비킨 거리(m). 0 이면 등산로 위에 걸쳐 선다 */
  side: number
  /** 이 반경 안에는 나무·바위를 심지 않는다(m) */
  clear: number
  /** 이름표를 띄울 높이(m) */
  label: number
  /** 바닥 크기 [가로, 세로](m). 비탈에서 가장 높은 모서리에 맞춰 세운다 */
  footprint: [number, number]
  /** 지나갈 수 없는 바닥 원 (랜드마크 기준 좌표. +z 가 등산로 쪽 정면) */
  colliders: Obstacle[]
}

/** xs × zs 격자 자리마다 같은 크기의 충돌 원을 놓는다 */
const circleGrid = (xs: number[], zs: number[], r: number, height: number) => xs.flatMap((x) => zs.map((z) => ({ x, z, r, height })))

const SPECS: Record<LandmarkKind, Spec> = {
  cairn: { side: 3.4, clear: 3, label: 2.6, footprint: [1.6, 1.6], colliders: [{ x: 0, z: 0, r: 0.85, height: 1.7 }] },
  pass: {
    side: 3.6,
    clear: 4,
    label: 2.6,
    footprint: [3.6, 1.6],
    colliders: [
      { x: -0.9, z: 0, r: 0.85, height: 1.7 },
      { x: 1.3, z: 0.2, r: 0.55, height: 0.5 },
    ],
  },
  temple: { side: 7, clear: 6.5, label: 5.6, footprint: [4.6, 3.6], colliders: circleGrid([-1.4, 0, 1.4], [-0.6, 0.6], 1.2, 5) },
  hut: { side: 7.5, clear: 7, label: 5.4, footprint: [5.4, 4.4], colliders: circleGrid([-1.7, 0, 1.7], [-0.8, 0.8], 1.4, 5) },
  gate: {
    side: 0,
    clear: 7,
    label: 6.2,
    footprint: [7, 2.6],
    // 벽 양쪽과 벽이 기댄 바위 (src/scene/Landmarks.tsx 의 GATE_ROCKS)
    colliders: [
      ...circleGrid([-2.95, -1.9, 1.9, 2.95], [-0.6, 0.6], 0.7, 5.5),
      { x: -4.7, z: 0.2, r: 1.6, height: 4.5 },
      { x: -3.9, z: 2, r: 0.9, height: 1.5 },
      { x: 4.8, z: -0.1, r: 1.8, height: 5.3 },
      { x: 4, z: 2, r: 1, height: 2.2 },
    ],
  },
  ruins: { side: 0, clear: 5, label: 2.4, footprint: [8, 1.4], colliders: circleGrid([-3.7, -2.8, -1.9, 1.9, 2.8, 3.7], [0], 0.5, 1.1) },
  waterfall: {
    side: 11,
    clear: 9,
    label: 8.4,
    footprint: [3.6, 3.6],
    // 비스듬한 너럭바위와 둘레 바위(src/scene/Landmarks.tsx 의 FALL_ROCKS), 물웅덩이
    colliders: [...circleGrid([-2.8, -0.9, 0.9, 2.8], [-2.6, -5], 1.3, 5), { x: 0, z: 0.6, r: 2.2, height: 1 }],
  },
  boulder: { side: 7.5, clear: 7, label: 5.4, footprint: [4, 3], colliders: [{ x: 0, z: 0, r: 2.6, height: 4 }] },
  peak: {
    side: 6,
    clear: 6,
    label: 4.4,
    footprint: [4, 3],
    colliders: [
      { x: -1.5, z: -0.6, r: 1.7, height: 3.2 },
      { x: 1.7, z: -0.4, r: 1.5, height: 3 },
      { x: 0.2, z: 1.3, r: 0.3, height: 1.2 },
    ],
  },
  // 등산로를 따라 지형 위에 까는 바위라 길을 막지 않는다. 충돌 원이 없고 자리도 옮기지 않는다
  slab: { side: 0, clear: 9, label: 2.8, footprint: [0.3, 0.3], colliders: [] },
  ropes: { side: 0, clear: 9, label: 3, footprint: [0.3, 0.3], colliders: [] },
  ridge: { side: 0, clear: 4, label: 2.8, footprint: [0.3, 0.3], colliders: [] },
  // 바위 기둥 둘 사이로 길이 지나간다 (src/scene/NamedRocks.tsx 의 RockGate)
  rockgate: {
    side: 0,
    clear: 7,
    label: 6.8,
    footprint: [6, 3],
    colliders: [
      { x: -2.6, z: 0, r: 1.35, height: 4.2 },
      { x: 2.6, z: 0.1, r: 1.3, height: 3.8 },
      { x: -3.6, z: 1.2, r: 0.9, height: 0.8 },
      { x: 3.5, z: -1, r: 0.8, height: 0.6 },
    ],
  },
  pavilion: { side: 7, clear: 6.5, label: 6.4, footprint: [4.6, 4.6], colliders: [{ x: 0, z: 0, r: 2.5, height: 4.5 }] },
  junction: { side: 2.2, clear: 1.6, label: 2.8, footprint: [0.3, 0.3], colliders: [{ x: 0, z: 0, r: 0.2, height: 2.3 }] },
  spring: { side: 3, clear: 2.6, label: 2.2, footprint: [2.2, 1.8], colliders: [{ x: 0, z: -0.3, r: 1, height: 1.1 }] },
  sign: { side: 2.5, clear: 1.5, label: 2.7, footprint: [0.3, 0.3], colliders: [{ x: 0, z: 0, r: 0.2, height: 2.2 }] },
  trailhead: {
    side: 0,
    clear: 6,
    label: 4.4,
    footprint: [9, 1.5],
    colliders: [
      { x: -2.6, z: 0, r: 0.3, height: 3.6 },
      { x: 2.6, z: 0, r: 0.3, height: 3.6 },
      { x: 4.1, z: -0.6, r: 0.6, height: 2.2 },
    ],
  },
}

export type Landmark = Checkpoint & {
  kind: LandmarkKind
  /** 세울 자리. y 는 바닥(비탈이면 가장 높은 모서리) 높이 */
  position: THREE.Vector3
  /** y 축 회전. 기준 좌표 +z 가 이쪽을 본다 (옆에 서면 등산로 쪽, 길 위에 서면 진행 방향) */
  rotation: number
  label: number
  clear: number
  /** 세계 좌표의 바닥 원 */
  colliders: Obstacle[]
}

/** 길 위에 걸치는 랜드마크를 이정표에서 앞뒤로 옮겨 볼 수 있는 거리와 간격(m) */
const SHIFT_RANGE = 12
const SHIFT_STEP = 0.5
/** 길 위에 걸치는 랜드마크 앞뒤 3m 에서 길이 꺾여도 되는 각도. 더 꺾이면 문에 들어갔다가 벽 끝을 돌아 나가게 된다 */
const MAX_THROUGH_TURN = THREE.MathUtils.degToRad(20)
/** 몸 반지름(m). World 의 BODY_RADIUS 와 같게 */
const BODY = 0.35
/** 랜드마크 앞뒤로 등산로가 걸리는지 살피는 거리(m) */
const CHECK_RANGE = 30

const landmarkCache = new WeakMap<Trail, Landmark[]>()

/** 코스의 이정표마다 세울 랜드마크 */
export function landmarks(terrain: Terrain, trail: Trail): Landmark[] {
  const cached = landmarkCache.get(trail)
  if (cached) return cached
  // 출발점(탐방지원센터)도 이정표처럼 세운다
  const start = { name: trail.data.start, note: '', distance: Math.min(TRAILHEAD_AT, trail.length / 2) }
  const list = [start, ...trail.data.checkpoints].map((cp): Landmark => {
    const kind = cp === start ? 'trailhead' : landmarkKind(cp.name)
    const spec = SPECS[kind]
    const { position, rotation } = spec.side === 0 ? placeAcrossTrail(trail, cp.distance, kind, spec) : placeBesideTrail(terrain, trail, cp.distance, spec)
    // 그래도 등산로 가운데 줄에 걸리는 원은 뺀다. 랜드마크 때문에 길이 막히는 일은 없게
    const colliders = place(spec.colliders, position, rotation).filter((c) => trailHits(trail, cp.distance, [c]) === 0)
    // 2층짜리 대피소는 이름표를 한 층 더 높이 띄운다
    const label = spec.label + (kind === 'hut' && cp.name.includes('대피소') ? 2.6 : 0)
    return { ...cp, kind, position, rotation, label, clear: spec.clear, colliders }
  })
  landmarkCache.set(trail, list)
  return list
}

/**
 * 길 위에 걸쳐 세운다. 기준 좌표 +z 가 진행 방향이고, 등산로가 꺾이는 곳이면 길이 벽에 덜 걸리는 방향으로 돌린다.
 * 갈지자 길의 꺾이는 곳이면 어느 쪽으로 돌려도 벽이 길에 걸리므로(북한산 위문),
 * 앞뒤 SHIFT_RANGE 안에서 길이 문 사이로 곧게 지나는 가장 가까운 자리로 옮긴다.
 * 출발점 입구는 처음 화면에 보이게, 충돌 원이 없는 것(지형 위에 까는 마당바위·기차바위)은 이정표 자리 그대로 둔다
 */
function placeAcrossTrail(trail: Trail, distance: number, kind: LandmarkKind, spec: Spec) {
  const range = kind === 'trailhead' || spec.colliders.length === 0 ? 0 : SHIFT_RANGE
  let best = { hits: Infinity, at: distance, rotation: trail.headingAt(distance) }
  for (let k = 0; k <= range / SHIFT_STEP && best.hits > 0; k++) {
    for (const sign of k === 0 ? [1] : [1, -1]) {
      const at = THREE.MathUtils.clamp(distance + sign * k * SHIFT_STEP, 0, trail.length)
      if (range > 0 && turnAt(trail, at) > MAX_THROUGH_TURN) continue
      const q = trail.positionAt(at)
      const rotation = bestRotation(trail, at, q, trail.headingAt(at), spec.colliders)
      const hits = trailHits(trail, at, place(spec.colliders, q, rotation))
      if (hits < best.hits) best = { hits, at, rotation }
    }
  }
  return { position: trail.positionAt(best.at), rotation: best.rotation }
}

/**
 * 등산로 옆에 비켜 세운다. 양옆 가운데 땅이 등산로 높이와 덜 차이 나는(덜 가파른) 쪽을 고르고, 정면(+z)이 등산로를 보게 돌린다.
 * 높이는 비탈에서 묻히지 않게 바닥 가운데와 네 모서리 중 가장 높은 곳에 맞춘다
 */
function placeBesideTrail(terrain: Terrain, trail: Trail, distance: number, spec: Spec) {
  const p = trail.positionAt(distance)
  const heading = trail.headingAt(distance)
  const right = new THREE.Vector3(-Math.cos(heading), 0, Math.sin(heading))
  const heightGap = (side: number) => {
    const q = p.clone().addScaledVector(right, side * spec.side)
    return Math.abs(meshHeight(terrain, q.x, q.z) - p.y)
  }
  const side = heightGap(1) <= heightGap(-1) ? 1 : -1
  const position = p.clone().addScaledVector(right, side * spec.side)
  const rotation = Math.atan2(p.x - position.x, p.z - position.z)
  position.y = highestCorner(terrain, position, rotation, spec.footprint)
  return { position, rotation }
}

/** 바닥(가로 w, 세로 d)의 가운데와 네 모서리 중 가장 높은 지형 높이 */
function highestCorner(terrain: Terrain, position: THREE.Vector3, rotation: number, [w, d]: [number, number]) {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  let high = -Infinity
  for (const [fx, fz] of [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const lx = (fx * w) / 2
    const lz = (fz * d) / 2
    high = Math.max(high, meshHeight(terrain, position.x + lx * cos + lz * sin, position.z - lx * sin + lz * cos))
  }
  return high
}

/** at 앞 3m 와 뒤 3m 의 진행 방향 차이(라디안) */
function turnAt(trail: Trail, at: number) {
  const [a, b, c] = [at - 3, at, at + 3].map((d) => trail.positionAt(d))
  const d = Math.atan2(c.x - b.x, c.z - b.z) - Math.atan2(b.x - a.x, b.z - a.z)
  return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)))
}

/** 랜드마크 기준 좌표의 원을 세계 좌표로 옮긴다 (+z 가 rotation 방향) */
function place(local: Obstacle[], position: THREE.Vector3, rotation: number) {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return local.map((c) => ({ ...c, x: position.x + c.x * cos + c.z * sin, z: position.z - c.x * sin + c.z * cos }))
}

/** 랜드마크 앞뒤 등산로 가운데 줄이 원에 걸리는 횟수 (0.25m 간격으로 잰다) */
function trailHits(trail: Trail, at: number, circles: Obstacle[]) {
  let hits = 0
  for (let d = Math.max(0, at - CHECK_RANGE); d <= Math.min(trail.length, at + CHECK_RANGE); d += 0.25) {
    const p = trail.positionAt(d)
    if (circles.some((c) => (p.x - c.x) ** 2 + (p.z - c.z) ** 2 < (c.r + BODY) ** 2)) hits++
  }
  return hits
}

/** 진행 방향 둘레 ±90° 를 5° 씩 돌려 보며 등산로가 가장 적게 걸리는 방향. 같으면 진행 방향에 가까운 쪽 */
function bestRotation(trail: Trail, at: number, position: THREE.Vector3, heading: number, local: Obstacle[]) {
  let best = heading
  let bestHits = Infinity
  for (let k = 0; k <= 18; k++) {
    for (const sign of k === 0 ? [1] : [1, -1]) {
      const rotation = heading + sign * THREE.MathUtils.degToRad(k * 5)
      const hits = trailHits(trail, at, place(local, position, rotation))
      if (hits < bestHits) {
        best = rotation
        bestHits = hits
      }
    }
    if (bestHits === 0) break
  }
  return best
}

/** 랜드마크 둘레인지 빠르게 판정하는 함수 (나무·바위를 심지 않을 곳) */
export function makeLandmarkClear(terrain: Terrain, trail: Trail) {
  const list = landmarks(terrain, trail)
  return (x: number, z: number) => list.some((l) => (l.position.x - x) ** 2 + (l.position.z - z) ** 2 < l.clear ** 2)
}
