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
  /** 로컬 좌표 (0, 0) 의 위경도 */
  origin: { lat: number; lon: number }
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
  checkpoints: Checkpoint[]
  points: [number, number, number][]
}

/** 가는 길의 이정표. distance 는 출발점에서 등산로를 따라 잰 거리(m) */
export type Checkpoint = { name: string; note: string; distance: number }

/** 출발점부터 정상까지 이정표로 나눈 한 구간 */
export type Section = {
  from: string
  to: string
  start: number
  end: number
  length: number
  gain: number
  /** 도착 지점 해발(m) */
  elevation: number
  minutes: number
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

  /** from~to 구간의 길이와 누적 오르막(m) */
  statsBetween(from: number, to: number) {
    const a = THREE.MathUtils.clamp(from, 0, this.length)
    const b = THREE.MathUtils.clamp(to, a, this.length)
    let gain = 0
    let prev = this.positionAt(a).y
    for (let i = 0; i < this.points.length; i++) {
      const d = this.cumulative[i]
      if (d <= a) continue
      if (d >= b) break
      if (this.points[i].y > prev) gain += this.points[i].y - prev
      prev = this.points[i].y
    }
    const last = this.positionAt(b).y
    if (last > prev) gain += last - prev
    return { length: b - a, gain }
  }

  /** 출발 → 이정표들 → 정상 순서의 구간 목록 */
  sections(): Section[] {
    const stops = [
      { name: this.data.start, distance: 0 },
      ...this.data.checkpoints,
      { name: this.data.summit, distance: this.length },
    ]
    return stops.slice(1).map((stop, i) => {
      const prev = stops[i]
      const { length, gain } = this.statsBetween(prev.distance, stop.distance)
      return {
        from: prev.name,
        to: stop.name,
        start: prev.distance,
        end: stop.distance,
        length,
        gain,
        elevation: this.positionAt(stop.distance).y,
        minutes: estimateMinutes(length, gain),
      }
    })
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
