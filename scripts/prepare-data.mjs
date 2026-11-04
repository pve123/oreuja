// 북한산 지형·등산로 데이터를 받아 public/data 에 정적 파일로 만든다.
// 실행: node scripts/prepare-data.mjs
//  - 지형: AWS Terrain Tiles (Terrarium PNG, 키 불필요)
//  - 등산로: OpenStreetMap Overpass API (scripts/raw/osm.json 이 있으면 재사용)
import fs from 'node:fs/promises'
import path from 'node:path'
import { PNG } from 'pngjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const RAW = path.join(ROOT, 'scripts/raw')
const OUT = path.join(ROOT, 'public/data')
const UA = 'hiking-metaverse-dev'

// 지형으로 만들 영역 (남, 서, 북, 동)
const BBOX = { south: 37.638, west: 126.958, north: 37.678, east: 127.004 }
const ZOOM = 13

// 코스: 백운대탐방지원센터 → 백운대
const COURSE = {
  id: 'bukhansan-baegundae',
  mountain: '북한산',
  name: '백운대 코스',
  start: { name: '백운대탐방지원센터', lat: 37.6598, lon: 126.9894 },
  summit: { name: '백운대', osmId: 5515194671, elevation: 835.6 },
}

// ── 좌표 유틸 ───────────────────────────────────────
const R = 6378137
const origin = { lat: (BBOX.south + BBOX.north) / 2, lon: (BBOX.west + BBOX.east) / 2 }
const cosLat = Math.cos((origin.lat * Math.PI) / 180)
// three.js 좌표: x = 동쪽(m), z = 남쪽(m) (북쪽이 -z)
const toLocal = (lat, lon) => ({
  x: ((lon - origin.lon) * Math.PI / 180) * R * cosLat,
  z: -((lat - origin.lat) * Math.PI / 180) * R,
})
const haversine = (a, b) => {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
const lon2px = (lon) => ((lon + 180) / 360) * 2 ** ZOOM * 256
const lat2px = (lat) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** ZOOM * 256
}

// ── 1. 지형 ────────────────────────────────────────
async function buildTerrain() {
  const px0 = Math.floor(lon2px(BBOX.west)), px1 = Math.ceil(lon2px(BBOX.east))
  const py0 = Math.floor(lat2px(BBOX.north)), py1 = Math.ceil(lat2px(BBOX.south))
  const tx0 = Math.floor(px0 / 256), tx1 = Math.floor(px1 / 256)
  const ty0 = Math.floor(py0 / 256), ty1 = Math.floor(py1 / 256)

  const tiles = new Map()
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      const file = path.join(RAW, `terrarium-${ZOOM}-${tx}-${ty}.png`)
      let buf
      try {
        buf = await fs.readFile(file)
      } catch {
        const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${tx}/${ty}.png`
        const res = await fetch(url, { headers: { 'User-Agent': UA } })
        if (!res.ok) throw new Error(`타일 다운로드 실패 ${url}: ${res.status}`)
        buf = Buffer.from(await res.arrayBuffer())
        await fs.writeFile(file, buf)
      }
      tiles.set(`${tx}/${ty}`, PNG.sync.read(buf))
    }
  }

  const width = px1 - px0 + 1
  const height = py1 - py0 + 1
  const heights = new Float32Array(width * height)
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const gx = px0 + i, gy = py0 + j
      const png = tiles.get(`${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`)
      const k = ((gy % 256) * 256 + (gx % 256)) * 4
      // Terrarium 인코딩: (R*256 + G + B/256) - 32768
      heights[j * width + i] = png.data[k] * 256 + png.data[k + 1] + png.data[k + 2] / 256 - 32768
    }
  }

  // 실제 범위(픽셀 경계)를 위경도로 되돌려서 로컬 크기 계산
  const px2lon = (px) => (px / (2 ** ZOOM * 256)) * 360 - 180
  const py2lat = (py) => {
    const n = Math.PI - (2 * Math.PI * py) / (2 ** ZOOM * 256)
    return (180 / Math.PI) * Math.atan(Math.sinh(n))
  }
  const nw = toLocal(py2lat(py0), px2lon(px0))
  const se = toLocal(py2lat(py1), px2lon(px1))

  let min = Infinity, max = -Infinity
  for (const h of heights) { min = Math.min(min, h); max = Math.max(max, h) }

  const meta = { width, height, minX: nw.x, maxX: se.x, minZ: nw.z, maxZ: se.z, minHeight: min, maxHeight: max, origin }
  await fs.writeFile(path.join(OUT, 'terrain.bin'), Buffer.from(heights.buffer))
  await fs.writeFile(path.join(OUT, 'terrain.json'), JSON.stringify(meta, null, 2))
  console.log(`지형 ${width}x${height}, 높이 ${min.toFixed(0)}~${max.toFixed(0)}m, 크기 ${(se.x - nw.x).toFixed(0)}x${(se.z - nw.z).toFixed(0)}m`)

  // 등산로 높이 샘플링용 (쌍선형 보간)
  return (x, z) => {
    const fx = ((x - meta.minX) / (meta.maxX - meta.minX)) * (width - 1)
    const fz = ((z - meta.minZ) / (meta.maxZ - meta.minZ)) * (height - 1)
    const i = Math.max(0, Math.min(width - 2, Math.floor(fx)))
    const j = Math.max(0, Math.min(height - 2, Math.floor(fz)))
    const u = fx - i, v = fz - j
    const h = (a, b) => heights[b * width + a]
    return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v
  }
}

// ── 2. 등산로 ──────────────────────────────────────
async function loadOsm() {
  const file = path.join(RAW, 'osm.json')
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    const q = `[out:json][timeout:90];(way["highway"~"path|footway|track|steps"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});node["natural"="peak"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out body;>;out skel qt;`
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(q),
    })
    const text = await res.text()
    if (!text.startsWith('{')) throw new Error('Overpass 응답 오류 (잠시 뒤 다시 실행): ' + text.slice(0, 120))
    await fs.writeFile(file, text)
    return JSON.parse(text)
  }
}

function shortestPath(osm, startCoord, goalId) {
  const nodes = new Map()
  const adj = new Map()
  for (const e of osm.elements) if (e.type === 'node') nodes.set(e.id, e)
  const link = (a, b, w) => {
    if (!adj.has(a)) adj.set(a, [])
    adj.get(a).push([b, w])
  }
  for (const e of osm.elements) {
    if (e.type !== 'way') continue
    const t = e.tags ?? {}
    // 출입금지·비법정 탐방로는 제외
    if (t.access === 'no' || t.foot === 'no' || t.access === 'private' || /비법정/.test(t.name ?? '')) continue
    if (t.sac_scale && /alpine/.test(t.sac_scale)) continue // 암벽·릿지 구간 제외
    // 정식 등산로(sac_scale 표시)를 우선: 표시 없는 길은 비용 1.5배
    const penalty = t.sac_scale ? 1 : 1.5
    for (let k = 1; k < e.nodes.length; k++) {
      const a = nodes.get(e.nodes[k - 1]), b = nodes.get(e.nodes[k])
      if (!a || !b) continue
      const w = haversine(a, b) * penalty
      link(a.id, b.id, w)
      link(b.id, a.id, w)
    }
  }
  // 출발 좌표에서 가장 가까운 등산로 노드
  let startId = null, best = Infinity
  for (const id of adj.keys()) {
    const d = haversine(nodes.get(id), startCoord)
    if (d < best) { best = d; startId = id }
  }
  // 정상 봉우리 노드가 길과 이어져 있지 않으면 가장 가까운 길 노드로
  const goalNode = nodes.get(goalId)
  let goal = goalId
  if (!adj.has(goalId)) {
    let gb = Infinity
    for (const id of adj.keys()) {
      const d = haversine(nodes.get(id), goalNode)
      if (d < gb) { gb = d; goal = id }
    }
  }

  // 다익스트라 (노드 수가 적어 단순 구현)
  const dist = new Map([[startId, 0]])
  const prev = new Map()
  const open = new Set([startId])
  while (open.size) {
    let cur = null, cd = Infinity
    for (const id of open) if (dist.get(id) < cd) { cd = dist.get(id); cur = id }
    open.delete(cur)
    if (cur === goal) break
    for (const [nb, w] of adj.get(cur) ?? []) {
      const nd = cd + w
      if (nd < (dist.get(nb) ?? Infinity)) { dist.set(nb, nd); prev.set(nb, cur); open.add(nb) }
    }
  }
  if (!dist.has(goal)) throw new Error('출발점에서 정상까지 이어진 길을 찾지 못했습니다')
  const route = []
  for (let id = goal; id !== undefined; id = prev.get(id)) route.unshift(nodes.get(id))
  if (goal !== goalId) route.push(goalNode)
  return route
}

async function buildTrail(sampleHeight) {
  const osm = await loadOsm()
  const route = shortestPath(osm, COURSE.start, COURSE.summit.osmId)

  // 로컬 좌표로 바꾸고 2m 간격으로 다시 나눠 부드럽게 만든다
  const raw = route.map((n) => toLocal(n.lat, n.lon))
  const STEP = 2
  const pts = [raw[0]]
  for (let k = 1; k < raw.length; k++) {
    const a = raw[k - 1], b = raw[k]
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    const n = Math.max(1, Math.round(len / STEP))
    for (let s = 1; s <= n; s++) pts.push({ x: a.x + ((b.x - a.x) * s) / n, z: a.z + ((b.z - a.z) * s) / n })
  }
  const points = pts.map((p) => [+p.x.toFixed(2), +sampleHeight(p.x, p.z).toFixed(2), +p.z.toFixed(2)])

  let length = 0, gain = 0
  for (let k = 1; k < points.length; k++) {
    const [x0, y0, z0] = points[k - 1], [x1, y1, z1] = points[k]
    length += Math.hypot(x1 - x0, y1 - y0, z1 - z0)
    if (y1 > y0) gain += y1 - y0
  }
  const trail = {
    id: COURSE.id,
    mountain: COURSE.mountain,
    name: COURSE.name,
    start: COURSE.start.name,
    summit: COURSE.summit.name,
    summitElevation: COURSE.summit.elevation,
    length: Math.round(length),
    elevationGain: Math.round(gain),
    points,
  }
  await fs.writeFile(path.join(OUT, 'trail.json'), JSON.stringify(trail))
  console.log(`등산로 ${route.length}개 노드 → ${points.length}개 점, 길이 ${(length / 1000).toFixed(2)}km, 누적 오르막 ${gain.toFixed(0)}m`)
}

await fs.mkdir(RAW, { recursive: true })
await fs.mkdir(OUT, { recursive: true })
const sampleHeight = await buildTerrain()
await buildTrail(sampleHeight)
