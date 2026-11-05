import * as THREE from 'three'
import { meshHeight, type Checkpoint, type Terrain, type Trail } from './data'
import type { Obstacle } from './obstacles'

/**
 * 이정표 이름에 맞춰 세우는 랜드마크 종류.
 * - cairn: 고개·재(하루재)에 쌓은 돌탑
 * - pass: 깔딱고개. 돌탑 옆에 숨 고르는 나무 벤치
 * - temple: 절·암자(인수암, 보리사, 대동사). 붉은 기둥, 기와지붕, 연등
 * - hut: 산장(백운산장). 굴뚝 있는 나무 산장
 * - gate: 성문(백운봉암문 위문). 등산로가 아치 사이로 지나간다
 * - ruins: 문터(수문터). 무너진 성벽 터
 * - waterfall: 폭포(개연폭포). 바위 절벽, 물줄기, 물웅덩이
 * - sign: 그 밖의 이름. 나무 표지판
 */
export type LandmarkKind = 'cairn' | 'pass' | 'temple' | 'hut' | 'gate' | 'ruins' | 'waterfall' | 'sign'

export function landmarkKind(name: string): LandmarkKind {
  if (name.includes('폭포')) return 'waterfall'
  if (name.includes('산장')) return 'hut'
  if (name.includes('문터')) return 'ruins'
  if (name.includes('문')) return 'gate'
  if (name.includes('깔딱')) return 'pass'
  if (name.endsWith('재') || name.includes('고개')) return 'cairn'
  if (name.endsWith('암') || name.endsWith('사')) return 'temple'
  return 'sign'
}

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

const grid = (xs: number[], zs: number[], r: number, height: number) => xs.flatMap((x) => zs.map((z) => ({ x, z, r, height })))

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
  temple: { side: 7, clear: 6.5, label: 5.6, footprint: [4.6, 3.6], colliders: grid([-1.4, 0, 1.4], [-0.6, 0.6], 1.2, 5) },
  hut: { side: 7.5, clear: 7, label: 5.4, footprint: [5.4, 4.4], colliders: grid([-1.7, 0, 1.7], [-0.8, 0.8], 1.4, 5) },
  gate: { side: 0, clear: 6, label: 6.2, footprint: [7, 2.6], colliders: grid([-2.95, -1.9, 1.9, 2.95], [-0.6, 0.6], 0.7, 5.5) },
  ruins: { side: 0, clear: 5, label: 2.4, footprint: [8, 1.4], colliders: grid([-3.7, -2.8, -1.9, 1.9, 2.8, 3.7], [0], 0.5, 1.1) },
  waterfall: {
    side: 11,
    clear: 9,
    label: 8.4,
    footprint: [3.6, 3.6],
    colliders: [...grid([-2.2, 0, 2.2], [-3.4], 1.8, 8), { x: 0, z: 0, r: 1.9, height: 2 }],
  },
  sign: { side: 2.5, clear: 1.5, label: 2.7, footprint: [0.3, 0.3], colliders: [{ x: 0, z: 0, r: 0.2, height: 2.2 }] },
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

const cache = new WeakMap<Trail, Landmark[]>()

/** 코스의 이정표마다 세울 랜드마크 */
export function landmarks(terrain: Terrain, trail: Trail): Landmark[] {
  const hit = cache.get(trail)
  if (hit) return hit
  const out = trail.data.checkpoints.map((cp): Landmark => {
    const kind = landmarkKind(cp.name)
    const spec = SPECS[kind]
    const p = trail.positionAt(cp.distance)
    const heading = trail.headingAt(cp.distance)
    const right = new THREE.Vector3(-Math.cos(heading), 0, Math.sin(heading))

    let position: THREE.Vector3
    let rotation: number
    if (spec.side === 0) {
      // 길 위에 걸쳐 선다. 기준 좌표 +z 가 진행 방향. 등산로가 꺾이는 곳이면 길이 벽에 덜 걸리는 방향으로 돌린다
      position = p.clone()
      rotation = bestRotation(trail, cp.distance, position, heading, spec.colliders)
    } else {
      // 등산로 양옆 가운데 땅이 등산로 높이와 덜 차이 나는(덜 가파른) 쪽에 세운다
      const flatness = (s: number) => {
        const q = p.clone().addScaledVector(right, s * spec.side)
        return Math.abs(meshHeight(terrain, q.x, q.z) - p.y)
      }
      const s = flatness(1) <= flatness(-1) ? 1 : -1
      position = p.clone().addScaledVector(right, s * spec.side)
      // 정면(+z)이 등산로를 보게
      rotation = Math.atan2(p.x - position.x, p.z - position.z)
      const [w, d] = spec.footprint
      const cos = Math.cos(rotation)
      const sin = Math.sin(rotation)
      let high = -Infinity
      for (const [fx, fz] of [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const lx = (fx * w) / 2
        const lz = (fz * d) / 2
        high = Math.max(high, meshHeight(terrain, position.x + lx * cos + lz * sin, position.z - lx * sin + lz * cos))
      }
      position.y = high
    }

    // 그래도 등산로 가운데 줄에 걸리는 원은 뺀다. 랜드마크 때문에 길이 막히는 일은 없게
    const colliders = place(spec.colliders, position, rotation).filter((c) => trailHits(trail, cp.distance, [c]) === 0)
    return { ...cp, kind, position, rotation, label: spec.label, clear: spec.clear, colliders }
  })
  cache.set(trail, out)
  return out
}

/** 몸 반지름(m). World 의 BODY_RADIUS 와 같게 */
const BODY = 0.35
/** 랜드마크 앞뒤로 등산로가 걸리는지 살피는 거리(m) */
const CHECK_RANGE = 30

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
      const r = heading + sign * THREE.MathUtils.degToRad(k * 5)
      const hits = trailHits(trail, at, place(local, position, r))
      if (hits < bestHits) {
        best = r
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
