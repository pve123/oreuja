import * as THREE from 'three'
import { meshHeight, standHeight, type Terrain, type Trail } from './data'

export const STEP_EVERY = 1.3 // 계단 간격(m)
export const STEP_SLOPE = 0.3 // 이보다 가파르면(30%) 돌계단을 놓는다
export const STEP_WIDTH = 1.5 // 돌계단 폭(m). 길 폭보다 조금 좁다
export const STEP_DEPTH = 0.42 // 디딤판 깊이(m)
const STEP_RISE = 0.1 // 디딤판 윗면이 주변 지면보다 올라오는 높이(m)
const LIFT = 0.06 // 길 띠를 지면에서 띄운 높이와 같게(m)

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
    // 윗면은 가장 높은 곳보다 살짝 위에 수평으로, 아래는 가장 낮은 곳보다 조금 더 내려 경사면을 깎은 계단처럼
    out.push({ distance: d, top: high + STEP_RISE, bottom: low - 0.05, x: p.x, z: p.z, heading })
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

/**
 * 등산로 distance 지점에서 발이 딛는 계단 높이. 계단 구간이 아니면 null.
 * 잘 만든 3D 게임의 계단처럼 걸은 거리에 맞춰 오른다: 칸마다 앞쪽은 평평하게 딛고, 칸 가장자리 짧은 구간에서 다음 칸 높이로 올라선다.
 * 그래서 천천히 걸으면 천천히, 뛰면 빨리 오르고, 시간에 기대는 보간처럼 밀리거나 튀지 않는다.
 * 계단 구간 첫 칸 앞과 마지막 칸 뒤 한 칸 길이에서는 땅(groundAt) 높이와 디딤판 높이를 같은 방식으로 이어, 들어서고 나올 때도 끊기지 않는다.
 * index 는 지금 딛고 있는 칸 번호 (땅을 딛고 있으면 -1). 발소리를 칸마다 한 번 낼 때 쓴다.
 */
export function stairAt(steps: Step[], distance: number, groundAt: (d: number) => number): { index: number; y: number } | null {
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
  const ease = (from: number, to: number, t: number) => from + (to - from) * THREE.MathUtils.smoothstep(t, TREAD, TREAD + RISE)

  // 이어진 두 칸 사이: 앞쪽은 a 를 딛고, 가장자리에서 b 높이로 올라선다
  if (a && b && b.distance - a.distance <= LINKED) {
    const t = (distance - a.distance) / (b.distance - a.distance)
    const e = THREE.MathUtils.smoothstep(t, TREAD, TREAD + RISE)
    return { index: e < 0.5 ? lo : lo + 1, y: a.top + (b.top - a.top) * e }
  }
  // 계단 구간 마지막 칸 뒤: 디딤판에서 땅으로 내려선다
  if (a && distance - a.distance <= STEP_EVERY) {
    const t = (distance - a.distance) / STEP_EVERY
    const y = ease(a.top, groundAt(distance), t)
    return { index: t < TREAD + RISE / 2 ? lo : -1, y }
  }
  // 계단 구간 첫 칸 앞: 땅에서 첫 디딤판으로 올라선다
  if (b && b.distance - distance <= STEP_EVERY) {
    const t = 1 - (b.distance - distance) / STEP_EVERY
    const y = ease(groundAt(distance), b.top, t)
    return { index: t < TREAD + RISE / 2 ? -1 : lo + 1, y }
  }
  return null
}

/** 등산로 가운데에서 이만큼 안쪽은 등산로 높이(돌계단 포함)를, 바깥쪽으로 이 세 배까지 지형 높이로 넘어간다(m) */
const TRAIL_SURFACE = 1

/**
 * 등산로 distance 지점에서 옆으로 offset 만큼 비킨 (x, z) 에 섰을 때 발바닥 높이.
 * 등산로 위는 등산로 높이를, 돌계단 위는 밟은 디딤판 높이를 따르고, 벗어날수록 그린 지형 높이로 넘어간다.
 * 내 캐릭터와 같이하기 친구 캐릭터가 같은 높이에 서도록 둘 다 이 함수를 쓴다.
 */
export function groundAt(terrain: Terrain, trail: Trail, steps: Step[], distance: number, offset: number, x: number, z: number) {
  const onTrail = trail.positionAt(distance)
  const step = Math.abs(offset) < 1 ? stairAt(steps, distance, (d) => trail.positionAt(d).y) : null
  const away = Math.hypot(x - onTrail.x, z - onTrail.z)
  const k = THREE.MathUtils.smoothstep(away, TRAIL_SURFACE, TRAIL_SURFACE * 3)
  return { y: THREE.MathUtils.lerp(step ? step.y : onTrail.y, standHeight(terrain, x, z), k), step }
}
