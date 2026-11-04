import * as THREE from 'three'

export type TerrainMeta = {
  width: number
  height: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  minHeight: number
  maxHeight: number
}

export type Terrain = TerrainMeta & { heights: Float32Array }

export type TrailData = {
  id: string
  mountain: string
  name: string
  start: string
  summit: string
  summitElevation: number
  length: number
  elevationGain: number
  points: [number, number, number][]
}

/** 등산로 위의 거리(m)로 위치·방향을 구하는 도우미 */
export class Trail {
  readonly data: TrailData
  readonly points: THREE.Vector3[]
  /** 각 점까지의 누적 거리(m) */
  readonly cumulative: number[]
  readonly length: number

  constructor(data: TrailData) {
    this.data = data
    this.points = data.points.map(([x, y, z]) => new THREE.Vector3(x, y, z))
    this.cumulative = [0]
    for (let i = 1; i < this.points.length; i++) {
      this.cumulative.push(this.cumulative[i - 1] + this.points[i].distanceTo(this.points[i - 1]))
    }
    this.length = this.cumulative[this.cumulative.length - 1]
  }

  private segmentAt(distance: number) {
    const d = THREE.MathUtils.clamp(distance, 0, this.length)
    let lo = 0
    let hi = this.cumulative.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (this.cumulative[mid] <= d) lo = mid
      else hi = mid
    }
    const span = this.cumulative[hi] - this.cumulative[lo] || 1
    return { i: lo, t: (d - this.cumulative[lo]) / span }
  }

  positionAt(distance: number, target = new THREE.Vector3()) {
    const { i, t } = this.segmentAt(distance)
    return target.lerpVectors(this.points[i], this.points[i + 1] ?? this.points[i], t)
  }

  /** 진행 방향 (수평). 앞뒤 몇 m 를 보고 계산해 흔들림을 줄인다 */
  headingAt(distance: number) {
    const a = this.positionAt(distance - 4)
    const b = this.positionAt(distance + 4)
    return Math.atan2(b.x - a.x, b.z - a.z)
  }
}

/** 지형 높이(m) 쌍선형 보간 */
export function sampleHeight(t: Terrain, x: number, z: number) {
  const fx = ((x - t.minX) / (t.maxX - t.minX)) * (t.width - 1)
  const fz = ((z - t.minZ) / (t.maxZ - t.minZ)) * (t.height - 1)
  const i = THREE.MathUtils.clamp(Math.floor(fx), 0, t.width - 2)
  const j = THREE.MathUtils.clamp(Math.floor(fz), 0, t.height - 2)
  const u = fx - i
  const v = fz - j
  const h = (a: number, b: number) => t.heights[b * t.width + a]
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v
}

export async function loadData(): Promise<{ terrain: Terrain; trail: Trail }> {
  const [meta, buf, trail] = await Promise.all([
    fetch('/data/terrain.json').then((r) => r.json() as Promise<TerrainMeta>),
    fetch('/data/terrain.bin').then((r) => r.arrayBuffer()),
    fetch('/data/trail.json').then((r) => r.json() as Promise<TrailData>),
  ])
  return { terrain: { ...meta, heights: new Float32Array(buf) }, trail: new Trail(trail) }
}

/** 실제 등산 예상 시간(분): 평지 시속 4km + 오르막 600m 당 1시간 (Naismith 규칙) */
export function estimateMinutes(lengthM: number, gainM: number) {
  return Math.round((lengthM / 4000) * 60 + (gainM / 600) * 60)
}
