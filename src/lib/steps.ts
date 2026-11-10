import * as THREE from 'three'
import { meshHeight, standHeight, type Terrain, type Trail } from './data'

export const STEP_SLOPE = 0.3 // 이보다 가파르면(30%) 돌계단을 놓는다
export const STEP_WIDTH = 1.5 // 돌계단 폭(m). 길 폭보다 조금 좁다
/**
 * 한 칸 높이(m). 칸 깊이를 비탈에 맞춰 이 높이가 되게 정한다. 실제 산길 돌계단 턱 높이쯤
 * (가파르면 칸이 얕고 촘촘하게, 완만하면 깊고 성기게 놓인다)
 */
const TARGET_RISE = 0.22
/** 칸 깊이 범위(m). 아주 가파른 곳에서 발 디딜 곳이 없거나, 완만한 곳에서 한 칸이 너무 길어지지 않게 */
const MIN_SPAN = 0.32
const MAX_SPAN = 0.9
/** 이보다 짧게 끊긴 완만한 틈은 이어진 계단으로 메운다(m) */
const MERGE_GAP = 2
/** 이보다 짧은 가파른 구간에는 계단을 놓지 않는다(m) */
const MIN_RUN = 1.5
/** 가파른 곳을 찾을 때 등산로를 따라 재는 간격(m) */
const SAMPLE = 0.25
const LIFT = 0.06 // 길 띠를 지면에서 띄운 높이와 같게(m)
/** 옆 경사를 다 따르지 못하는 곳에서 디딤판 오르막 쪽 모서리가 땅에 묻혀도 되는 깊이(m) */
const STEP_BURY = 0.5
/** 받침 아랫면을 가장 낮은 땅보다 이만큼 더 묻는다(m). 비탈 쪽 아래로 틈이 보이지 않게 */
const BODY_SINK = 0.3
/**
 * 디딤판을 옆 경사에 맞춰 기울이는 최대 기울기(1m 옆으로 갈 때 오르는 높이, 약 17°).
 * 수평으로만 놓으면 비탈을 옆으로 가로지르는 길에서 내리막 쪽 받침 옆면이 큰 회색 삼각형으로 드러난다
 */
const MAX_TILT = 0.3

/**
 * 돌계단 한 칸. 칸들은 빈틈없이 이어져, 디딤판이 다음 칸 앞까지 꽉 찬다.
 * distance 는 칸 가운데 자리, depth 는 등산로를 따라 잰 칸 깊이, top 은 디딤판 가운데 윗면 높이, bottom 은 땅에 묻힌 아랫면(가운데 기준).
 * tilt 는 진행 방향 오른쪽으로 1m 갈 때 디딤판이 오르는 높이 (옆 경사를 따른다)
 */
type Step = { distance: number; depth: number; top: number; bottom: number; x: number; z: number; heading: number; tilt: number }

const cache = new WeakMap<Trail, Step[]>()

/** 등산로 d 지점 앞뒤 2m 로 잰 경사 */
const slopeAt = (trail: Trail, d: number) => Math.abs(trail.positionAt(d + 2).y - trail.positionAt(d - 2).y) / 4

/** 가파른 구간 [시작, 끝] 목록. 짧은 틈은 메우고 너무 짧은 구간은 버린다 */
function steepRuns(trail: Trail): [number, number][] {
  const runs: [number, number][] = []
  let open: number | null = null
  for (let d = 2; d <= trail.length - 2; d += SAMPLE) {
    const steep = slopeAt(trail, d) >= STEP_SLOPE
    if (steep && open === null) open = d
    if (!steep && open !== null) {
      runs.push([open, d])
      open = null
    }
  }
  if (open !== null) runs.push([open, trail.length - 2])
  const merged: [number, number][] = []
  for (const r of runs) {
    const last = merged[merged.length - 1]
    if (last && r[0] - last[1] < MERGE_GAP) last[1] = r[1]
    else merged.push([r[0], r[1]])
  }
  return merged.filter(([a, b]) => b - a >= MIN_RUN)
}

/**
 * 경사가 급한 곳에 놓는 돌계단 목록 (거리 순). 그리기와 캐릭터 높이가 같은 값을 쓴다.
 * 실제 산길 돌계단처럼 칸 높이가 고르고(TARGET_RISE) 디딤판이 다음 칸까지 이어져, 칸 사이로 비탈이 드러나지 않는다.
 * 디딤판은 그 칸이 덮는 땅보다 위에 놓여 오르막 쪽이 땅에 묻히지 않고, 앞쪽에는 칸 높이만큼 돌 턱이 선다
 */
export function stoneSteps(terrain: Terrain, trail: Trail): Step[] {
  const hit = cache.get(trail)
  if (hit) return hit
  const out: Step[] = []
  for (const [a, b] of steepRuns(trail)) {
    let s = a
    while (s < b - MIN_SPAN / 2) {
      const span = THREE.MathUtils.clamp(TARGET_RISE / Math.max(slopeAt(trail, s), 0.05), MIN_SPAN, MAX_SPAN)
      const e = Math.min(s + span, b)
      out.push(makeStep(terrain, trail, s, e))
      s = e
    }
  }
  cache.set(trail, out)
  return out
}

/** 등산로 [s, e] 를 덮는 한 칸 */
function makeStep(terrain: Terrain, trail: Trail, s: number, e: number): Step {
  const d = (s + e) / 2
  const p = trail.positionAt(d)
  const heading = trail.headingAt(d)
  const right = new THREE.Vector3(-Math.cos(heading), 0, Math.sin(heading))
  // 칸이 덮는 땅을 앞뒤·좌우로 재어 본다 (등산로를 따라 앞·가운데·뒤, 옆으로 왼쪽·가운데·오른쪽)
  const samples: { side: number; h: number }[] = []
  for (const along of [s, d, e]) {
    const q = trail.positionAt(along)
    for (const side of [-STEP_WIDTH / 2, 0, STEP_WIDTH / 2]) {
      samples.push({ side, h: meshHeight(terrain, q.x + right.x * side, q.z + right.z * side) + LIFT })
    }
  }
  // 옆 경사: 오른쪽과 왼쪽 땅 높이 차. 판을 이만큼 옆으로 기울여 땅을 따르게 한다
  const avg = (side: number) => {
    const hs = samples.filter((m) => m.side === side).map((m) => m.h)
    return hs.reduce((x, y) => x + y, 0) / hs.length
  }
  const tilt = THREE.MathUtils.clamp((avg(STEP_WIDTH / 2) - avg(-STEP_WIDTH / 2)) / STEP_WIDTH, -MAX_TILT, MAX_TILT)
  // 기울인 판을 기준으로 잰 높이 (옆 경사를 뺀 나머지만 남는다)
  let low = Infinity
  let high = -Infinity
  let centerHigh = -Infinity
  for (const m of samples) {
    const h = m.h - tilt * m.side
    low = Math.min(low, h)
    high = Math.max(high, h)
    if (m.side === 0) centerHigh = Math.max(centerHigh, h)
  }
  // 디딤판은 칸이 덮는 등산로 가운데 땅보다 늘 위에 둔다. 옆 경사를 다 따르지 못한 모서리는 STEP_BURY 까지 묻힌다
  // (가장 높은 모서리에 맞추면 옆으로 기운 비탈에서 디딤판이 땅보다 1m 넘게 떠서 옆에서 오를 수 없는 벽이 된다)
  const top = Math.max(centerHigh, high - STEP_BURY)
  return { distance: d, depth: e - s, top, bottom: low - BODY_SINK, x: p.x, z: p.z, heading, tilt }
}

/** 디딤판 위를 평평하게 딛는 몫. 나머지 구간에서 다음 칸 높이로 올라선다 */
const TREAD = 0.35
/** 다음 칸으로 올라서는 구간의 몫 */
const RISE = 0.3

/** 두 칸 가운데가 이 거리 안이면 이어진 계단으로 본다(m). 이어진 칸은 가운데끼리 MAX_SPAN 넘게 떨어지지 않고, 다른 구간과는 MERGE_GAP 넘게 떨어진다 */
const LINKED = MAX_SPAN * 2
/** 계단 구간 첫 칸 앞·마지막 칸 뒤에서 땅과 디딤판 높이를 잇는 길이(m). 짧으면 들어서는 오르막이 가팔라 막힌다 */
const LEAD = 2.6

/**
 * 등산로 distance 지점에서 발이 딛는 계단 높이. 계단 구간이 아니면 null.
 * 잘 만든 3D 게임의 계단처럼 걸은 거리에 맞춰 오른다: 칸마다 앞쪽은 평평하게 딛고, 칸 가장자리 짧은 구간에서 다음 칸 높이로 올라선다.
 * 그래서 천천히 걸으면 천천히, 뛰면 빨리 오르고, 시간에 기대는 보간처럼 밀리거나 튀지 않는다.
 * 계단 구간 첫 칸 앞과 마지막 칸 뒤 LEAD 길이에서는 땅(groundAt) 높이와 디딤판 높이를 같은 방식으로 이어, 들어서고 나올 때도 끊기지 않는다.
 * index 는 지금 딛고 있는 칸 번호 (땅을 딛고 있으면 -1). 발소리를 칸마다 한 번 낼 때 쓴다.
 */
export function stairAt(
  steps: Step[],
  distance: number,
  groundAt: (d: number) => number,
  /** tread: 칸마다 평평하게 딛는 모습(그림용), ramp: 칸 사이를 곧게 이은 경사로(물리 충돌용) */
  shape: 'tread' | 'ramp' = 'tread',
): { index: number; y: number } | null {
  if (!steps.length) return null
  // 거리 순이므로 이분 탐색으로 distance 바로 앞 칸(lo)을 찾는다. 첫 칸보다 앞이면 lo = -1
  let lo = -1
  let hi = steps.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (steps[mid].distance <= distance) lo = mid
    else hi = mid - 1
  }
  const a = lo >= 0 ? steps[lo] : null
  const b = steps[lo + 1] ?? null
  const curve = (t: number) => (shape === 'ramp' ? THREE.MathUtils.clamp(t, 0, 1) : THREE.MathUtils.smoothstep(t, TREAD, TREAD + RISE))
  const ease = (from: number, to: number, t: number) => from + (to - from) * curve(t)

  // 이어진 두 칸 사이: 앞쪽은 a 를 딛고, 가장자리에서 b 높이로 올라선다
  if (a && b && b.distance - a.distance <= LINKED) {
    const t = (distance - a.distance) / (b.distance - a.distance)
    const e = curve(t)
    return { index: e < 0.5 ? lo : lo + 1, y: a.top + (b.top - a.top) * e }
  }
  // 계단 구간 마지막 칸 뒤(디딤판에서 땅으로 내려섬)와 다음 구간 첫 칸 앞(땅에서 디딤판으로 올라섬).
  // 두 구간이 가까우면 둘이 겹치므로 높은 쪽을 딛는다 (한쪽만 쓰면 다음 구간 첫 칸에서 높이가 뛴다)
  const exitT = a ? (distance - a.distance) / LEAD : Infinity
  const entryT = b ? 1 - (b.distance - distance) / LEAD : -Infinity
  const exiting = a !== null && exitT <= 1
  const entering = b !== null && entryT >= 0
  if (!exiting && !entering) return null
  const g = groundAt(distance)
  const exitY = exiting ? ease(a.top, g, exitT) : -Infinity
  const entryY = entering ? ease(g, b.top, entryT) : -Infinity
  if (exitY >= entryY) return { index: exitT < TREAD + RISE / 2 ? lo : -1, y: exitY }
  return { index: entryT < TREAD + RISE / 2 ? -1 : lo + 1, y: entryY }
}

/**
 * 등산로 distance 지점 디딤판의 옆 기울기 (stairAt 과 같은 구간에서 칸 사이를 곧게 잇고, 땅으로 내려서는 구간에서는 0 으로 줄인다).
 * 계단 구간이 아니면 0
 */
export function tiltAt(steps: Step[], distance: number): number {
  if (!steps.length) return 0
  let lo = -1
  let hi = steps.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (steps[mid].distance <= distance) lo = mid
    else hi = mid - 1
  }
  const a = lo >= 0 ? steps[lo] : null
  const b = steps[lo + 1] ?? null
  if (a && b && b.distance - a.distance <= LINKED) return a.tilt + ((b.tilt - a.tilt) * (distance - a.distance)) / (b.distance - a.distance)
  const exit = a ? 1 - (distance - a.distance) / LEAD : 0
  const entry = b ? 1 - (b.distance - distance) / LEAD : 0
  if (exit <= 0 && entry <= 0) return 0
  return exit >= entry ? a!.tilt * exit : b!.tilt * entry
}

/** 계단 판정 폭: 디딤판 반폭에 조금 더 (m) */
export const STAIR_HALF_WIDTH = STEP_WIDTH / 2 + 0.25

/** 등산로 distance 지점 가운데의 그린 지형 높이 (흙길 띠도 이 면을 따라 그린다) */
export const trailGround = (terrain: Terrain, trail: Trail) => (d: number) => {
  const p = trail.positionAt(d)
  return meshHeight(terrain, p.x, p.z)
}

/**
 * 등산로 distance 지점에서 옆으로 offset 만큼 비킨 (x, z) 에 섰을 때 발바닥 높이 (그림 기준).
 * 돌계단 위는 칸마다 평평하게 딛는 디딤판 높이를, 그 밖은 그린 지형 높이를 따른다.
 * 물리가 없는 같이하기 친구 캐릭터가 쓰고, 내 캐릭터는 물리 높이에 계단 모양만 더한다.
 */
export function groundAt(terrain: Terrain, trail: Trail, steps: Step[], distance: number, offset: number, x: number, z: number) {
  const step = Math.abs(offset) < STAIR_HALF_WIDTH ? stairAt(steps, distance, trailGround(terrain, trail)) : null
  // 디딤판은 옆으로 기울어 있으니 가운데에서 비킨 만큼 높이를 더한다
  return { y: step ? step.y + tiltAt(steps, distance) * offset : standHeight(terrain, x, z), step }
}

/** 경사로 메시를 만들 때 등산로를 따라 자르는 간격(m) */
const RAMP_SAMPLE = 0.2
/**
 * 경사로 가장자리와 앞뒤 끝을 지형 아래로 묻는 깊이(m).
 * 두 충돌 메시(지형·경사로)가 만나는 곳에 경사로 모서리가 몇 cm 라도 솟아 있으면 캡슐이 그 모서리에 걸려 멈춘다.
 * 모서리를 땅속에 두면 지형에서 경사로로 넘어가는 곳이 오목한 접힘이 되어 걸리지 않는다.
 */
const RAMP_SINK = 0.4
/** 띠 앞뒤 끝 줄을 묻는 깊이(m). 깊으면 들어서는 곳이 가팔라진다 */
const RAMP_END_SINK = 0.15
/** 경사로 바깥 가장자리가 등산로 가운데에서 떨어진 거리(m). 멀수록 옆면이 완만하다 */
const RAMP_EDGE = STEP_WIDTH * 2

/**
 * 돌계단 구간을 덮는 보이지 않는 경사로 (물리 충돌용). 잘 만든 게임처럼 계단 충돌은 매끈한 경사로로 두고,
 * 칸마다 딛는 모습은 그림에만 얹는다. 가운데는 칸 사이를 곧게 이은 높이이고, 바깥 가장자리와 앞뒤 끝은 땅속으로 묻는다.
 */
export function stairRampMesh(terrain: Terrain, trail: Trail): { vertices: Float32Array; indices: Uint32Array } | null {
  const steps = stoneSteps(terrain, trail)
  if (!steps.length) return null
  const ground = trailGround(terrain, trail)
  const inner = STEP_WIDTH / 2
  const vertices: number[] = []
  const indices: number[] = []
  let prevRow = -1 // 이어지는 띠의 앞 줄 첫 꼭짓점 번호 (-1 은 띠가 끊김)
  let tilt = 0 // 지금 줄의 옆 기울기 (디딤판과 같게 기울여 옆으로 비켜 걸어도 그림과 발이 맞는다)

  /** d 지점에 한 줄을 놓는다. y 가 null 이면 줄 전체를 땅속에 묻는다 (띠의 시작·끝) */
  const row = (d: number, y: number | null) => {
    const p = trail.positionAt(d)
    const h = trail.headingAt(d)
    const rx = -Math.cos(h)
    const rz = Math.sin(h)
    // 바깥 가장자리는 멀리 둬서 옆에서 올라설 때도 완만하게 한다. 다만 급하게 꺾이는 곳에서는 줄끼리 겹쳐
    // 삼각형이 접히고 가파른 면이 생기므로, 굽은 반지름 안쪽으로 줄인다
    const dh = trail.headingAt(d + 1) - trail.headingAt(d - 1)
    const turn = Math.abs(Math.atan2(Math.sin(dh), Math.cos(dh))) / 2
    const radius = turn > 1e-4 ? 1 / turn : Infinity
    const outer = THREE.MathUtils.clamp(radius * 0.7, inner + 0.3, RAMP_EDGE)
    const across = [-outer, -inner, 0, inner, outer]
    const start = vertices.length / 3
    for (const o of across) {
      const x = p.x + rx * o
      const z = p.z + rz * o
      const g = meshHeight(terrain, x, z)
      const edge = Math.abs(o) > inner
      vertices.push(x, edge ? g - RAMP_SINK : y === null ? g - RAMP_END_SINK : Math.max(y + tilt * o, g), z)
    }
    if (prevRow >= 0) {
      for (let k = 0; k < 4; k++) {
        const a = prevRow + k
        const b = start + k
        pushUp(vertices, indices, a, b, a + 1)
        pushUp(vertices, indices, a + 1, b, b + 1)
      }
    }
    prevRow = start
  }

  let last = -Infinity
  for (let d = Math.max(0, steps[0].distance - LEAD); d <= Math.min(trail.length, steps[steps.length - 1].distance + LEAD); d += RAMP_SAMPLE) {
    const ramp = stairAt(steps, d, ground, 'ramp')
    tilt = tiltAt(steps, d)
    if (!ramp) {
      // 띠가 끝나면 한 칸 더 나가 땅속으로 묻고 끊는다
      if (prevRow >= 0) row(Math.min(trail.length, last + RAMP_SAMPLE * 3), null)
      prevRow = -1
      continue
    }
    // 띠를 시작할 때는 한 칸 앞에서 땅속부터 올라온다
    if (prevRow < 0) row(Math.max(0, d - RAMP_SAMPLE * 3), null)
    row(d, ramp.y)
    last = d
  }
  if (prevRow >= 0) row(Math.min(trail.length, last + RAMP_SAMPLE * 3), null)
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) }
}

/** 삼각형을 위에서 볼 때 앞면(법선이 +y)이 되게 순서를 맞춰 넣는다 */
export function pushUp(v: ArrayLike<number>, out: number[], a: number, b: number, c: number) {
  // 법선의 y 성분 = (b-a)×(c-a) 의 y = uz·wx − ux·wz
  const ux = v[b * 3] - v[a * 3]
  const uz = v[b * 3 + 2] - v[a * 3 + 2]
  const wx = v[c * 3] - v[a * 3]
  const wz = v[c * 3 + 2] - v[a * 3 + 2]
  const ny = uz * wx - ux * wz
  if (ny >= 0) out.push(a, b, c)
  else out.push(a, c, b)
}
