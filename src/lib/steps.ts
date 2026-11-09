import * as THREE from 'three'
import { meshHeight, standHeight, type Terrain, type Trail } from './data'

const STEP_EVERY = 1.3 // 계단 간격(m)
export const STEP_SLOPE = 0.3 // 이보다 가파르면(30%) 돌계단을 놓는다
export const STEP_WIDTH = 1.5 // 돌계단 폭(m). 길 폭보다 조금 좁다
export const STEP_DEPTH = 0.42 // 디딤판 깊이(m)
const STEP_RISE = 0.1 // 디딤판 윗면이 주변 지면보다 올라오는 높이(m)
const LIFT = 0.06 // 길 띠를 지면에서 띄운 높이와 같게(m)
/** 디딤판 오르막 쪽 모서리가 땅에 묻혀도 되는 깊이(m) */
const STEP_BURY = 0.5

/** 돌계단 한 칸. distance 는 등산로를 따라 잰 자리, top 은 디딤판 윗면 높이, bottom 은 땅에 묻힌 아랫면 */
export type Step = { distance: number; top: number; bottom: number; x: number; z: number; heading: number }

const cache = new WeakMap<Trail, Step[]>()

/** 경사가 급한 곳에 일정 간격으로 놓는 돌계단 목록 (거리 순). 그리기와 캐릭터 높이가 같은 값을 쓴다 */
export function stoneSteps(terrain: Terrain, trail: Trail): Step[] {
  const hit = cache.get(trail)
  if (hit) return hit
  const out: Step[] = []
  for (let d = 2; d < trail.length - 2; d += STEP_EVERY) {
    const slope = Math.abs(trail.positionAt(d + 2).y - trail.positionAt(d - 2).y) / 4
    if (slope < STEP_SLOPE) continue
    const p = trail.positionAt(d)
    const heading = trail.headingAt(d)
    const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading))
    const right = new THREE.Vector3(-Math.cos(heading), 0, Math.sin(heading))
    // 판 네 모서리와 가운데 아래 땅 높이를 잰다. 길이 옆으로 기울어도 판이 땅에 묻히지 않게
    let low = Infinity
    let high = -Infinity
    for (const [s, f] of [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const x = p.x + right.x * s * (STEP_WIDTH / 2) + forward.x * f * (STEP_DEPTH / 2)
      const z = p.z + right.z * s * (STEP_WIDTH / 2) + forward.z * f * (STEP_DEPTH / 2)
      const h = meshHeight(terrain, x, z) + LIFT
      low = Math.min(low, h)
      high = Math.max(high, h)
    }
    // 윗면은 등산로 가운데 땅보다 살짝 위에 수평으로 놓는다. 실제 산길 돌계단처럼 비탈에 박혀, 오르막 쪽 모서리는 조금 묻힌다.
    // (가장 높은 모서리에 맞추면 옆으로 기운 비탈에서 디딤판이 땅보다 1m 넘게 떠서 옆에서 오를 수 없는 벽이 된다)
    // 아래는 가장 낮은 곳보다 조금 더 내려 경사면을 깎은 계단처럼
    const center = meshHeight(terrain, p.x, p.z) + LIFT
    const top = Math.max(center + STEP_RISE, high - STEP_BURY)
    out.push({ distance: d, top, bottom: low - 0.05, x: p.x, z: p.z, heading })
  }
  cache.set(trail, out)
  return out
}

/** 디딤판 위를 평평하게 딛는 몫. 나머지 구간에서 다음 칸 높이로 올라선다 */
const TREAD = 0.35
/** 다음 칸으로 올라서는 구간의 몫 */
const RISE = 0.3

/** 두 칸이 이 거리 안이면 이어진 계단으로 본다(m) */
const LINKED = STEP_EVERY * 1.5
/** 계단 구간 첫 칸 앞·마지막 칸 뒤에서 땅과 디딤판 높이를 잇는 길이(m). 짧으면 들어서는 오르막이 가팔라 막힌다 */
const LEAD = STEP_EVERY * 2

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
  return { y: step ? step.y : standHeight(terrain, x, z), step }
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
      vertices.push(x, edge ? g - RAMP_SINK : y === null ? g - RAMP_END_SINK : Math.max(y, g), z)
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
