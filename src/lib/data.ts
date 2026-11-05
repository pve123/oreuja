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
  /** 난이도: 쉬움·보통·어려움 */
  level: string
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

  /**
   * (x, z) 에서 가장 가까운 등산로 위 지점의 거리(m).
   * near 앞뒤 range 안의 구간만 본다. 구불구불한 길에서 멀리 떨어진 다른 굽이로 진행이 건너뛰지 않게 하려는 것이다.
   */
  nearestDistance(x: number, z: number, near: number, range = 80) {
    const lo = this.segmentAt(near - range).i
    const hi = this.segmentAt(near + range).i
    let best = near
    let bestSq = Infinity
    for (let i = lo; i <= hi && i + 1 < this.points.length; i++) {
      const a = this.points[i]
      const b = this.points[i + 1]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const len2 = dx * dx + dz * dz || 1
      const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1)
      const px = a.x + dx * t - x
      const pz = a.z + dz * t - z
      const d2 = px * px + pz * pz
      if (d2 < bestSq) {
        bestSq = d2
        best = this.cumulative[i] + t * (this.cumulative[i + 1] - this.cumulative[i])
      }
    }
    return best
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

/**
 * 화면에 그려진 지형 메시의 높이(m). PlaneGeometry 와 같은 삼각형 분할을 따라 계산해서
 * 흙길·계단처럼 지면에 딱 붙어야 하는 것이 땅속에 묻히지 않게 한다.
 */
export function meshHeight(t: Terrain, x: number, z: number) {
  const fx = ((x - t.minX) / (t.maxX - t.minX)) * (t.width - 1)
  const fz = ((z - t.minZ) / (t.maxZ - t.minZ)) * (t.height - 1)
  const i = THREE.MathUtils.clamp(Math.floor(fx), 0, t.width - 2)
  const j = THREE.MathUtils.clamp(Math.floor(fz), 0, t.height - 2)
  const u = fx - i
  const v = fz - j
  const h = (a: number, b: number) => t.heights[b * t.width + a]
  // 칸마다 (i,j+1)-(i+1,j) 대각선으로 나눈 두 삼각형
  if (u + v <= 1) return h(i, j) + u * (h(i + 1, j) - h(i, j)) + v * (h(i, j + 1) - h(i, j))
  return h(i + 1, j + 1) + (1 - u) * (h(i, j + 1) - h(i + 1, j + 1)) + (1 - v) * (h(i + 1, j) - h(i + 1, j + 1))
}

/** 발 둘레 반지름(m). 비탈에서 오르막 쪽 발이 땅에 묻히지 않게 이 둘레까지 높이를 잰다 */
const FOOT_RADIUS = 0.3

/**
 * 캐릭터가 (x, z) 에 섰을 때 발바닥 높이(m). 화면에 그린 지형 면(meshHeight)을 따른다.
 * 격자 보간(sampleHeight)은 그린 면과 최대 2m 가까이 달라서, 그걸 쓰면 굴곡진 비탈에서 몸이 땅에 묻힌다.
 * 가운데와 발 둘레 네 점 가운데 가장 높은 곳에 서서, 가파른 비탈에서도 오르막 쪽 발이 묻히지 않는다.
 */
export function standHeight(t: Terrain, x: number, z: number) {
  let y = meshHeight(t, x, z)
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) y = Math.max(y, meshHeight(t, x + dx * FOOT_RADIUS, z + dz * FOOT_RADIUS))
  return y
}

/** 받은 만큼 onProgress(0~1)로 알려 주며 파일을 받는다. 크기를 모르면 다 받았을 때만 알린다 */
async function fetchWithProgress(url: string, onProgress?: (p: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} 을 받지 못했다 (${res.status})`)
  const total = Number(res.headers.get('content-length')) || 0
  if (!res.body || !total || !onProgress) {
    const buf = await res.arrayBuffer()
    onProgress?.(1)
    return buf
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
    // 압축돼서 오면 풀린 크기가 content-length 보다 클 수 있어 1 을 넘지 않게 한다
    onProgress(Math.min(0.99, got / total))
  }
  const out = new Uint8Array(got)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  onProgress(1)
  return out.buffer
}

/** 지형 한 장과 그 위의 코스 목록을 불러온다. onProgress 로 가장 큰 지형 파일을 받은 정도(0~1)를 알린다 */
export async function loadData(onProgress?: (p: number) => void): Promise<{ terrain: Terrain; trails: Trail[] }> {
  const json = async <T,>(url: string) => {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`${url} 을 받지 못했다 (${r.status})`)
    return (await r.json()) as T
  }
  const [meta, buf, courses] = await Promise.all([
    json<TerrainMeta>('/data/terrain.json'),
    fetchWithProgress('/data/terrain.bin', onProgress),
    json<TrailData[]>('/data/courses.json'),
  ])
  return { terrain: { ...meta, heights: new Float32Array(buf) }, trails: courses.map((c) => new Trail(c)) }
}

/** 실제 등산 예상 시간(분): 평지 시속 4km + 오르막 600m 당 1시간 (Naismith 규칙) */
export function estimateMinutes(lengthM: number, gainM: number) {
  return Math.round((lengthM / 4000) * 60 + (gainM / 600) * 60)
}
