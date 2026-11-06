// 산마다 지형과 코스별 등산로 데이터를 받아 public/data/<산 id>/ 에 정적 파일로 만든다.
// 실행: node scripts/prepare-data.mjs            (모든 산)
//       node scripts/prepare-data.mjs dobongsan  (고른 산만. 산 목록 mountains.json 은 늘 새로 쓴다)
//  - 지형: AWS Terrain Tiles (Terrarium PNG, 키 불필요)
//  - 등산로: OpenStreetMap Overpass API (scripts/raw/osm-<범위>.json 이 있으면 재사용)
import fs from 'node:fs/promises'
import path from 'node:path'
import { PNG } from 'pngjs'
import { buildContourDem, parseDxf } from './contour-dem.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const RAW = path.join(ROOT, 'scripts/raw')
// 국토지리정보원 1:5,000 수치지형도 DXF 를 두는 곳 (git 제외). 산마다 sheets 에 적은 도엽이 있으면 등고선으로 정밀 지형을 만든다
const NGII = path.join(RAW, 'ngii')
const CONTOUR_SPACING = 7.5 // 정밀 지형 격자 간격(m)
const DATA = path.join(ROOT, 'public/data')
const UA = 'hiking-metaverse-dev'
const ZOOM = 13

// 산 목록. 산마다 지형 한 장과 그 위의 코스들을 만든다
//  - bbox: 지형으로 만들 영역 (남, 서, 북, 동). 모든 코스가 들어가게 잡는다
//  - park: 산이 속한 국립공원. 출발점 입구 현판에 산 이름과 같이 쓴다
//  - elevation: 산의 가장 높은 봉우리 해발(m). 첫 화면에서 진행만큼 고도가 올라가는 데 쓴다
//  - sheets: 정밀 지형에 쓸 1:5,000 수치지형도 도엽 번호. 파일 이름에 이 번호가 든 DXF 를 scripts/raw/ngii/ 에서 찾는다
// 코스 좌표는 OpenStreetMap 의 같은 이름 지점에서 가져왔다
// summit 은 봉우리 노드(osmId)나 좌표(lat, lon) 중 하나로 준다. elevation 이 없으면 지형 높이를 쓴다
// via 는 가장 짧은 길이 대표 코스가 아닐 때 반드시 거쳐 갈 지점들이다
// checkpoints 는 가는 길에 지나는 이정표. 등산로에서 MAX_CHECKPOINT_OFFSET 보다 멀면 빼고 경고한다
const BUKHANSAN_COURSES = [
  {
    id: 'bukhansan-baegundae',
    mountain: '북한산',
    name: '백운대 코스',
    level: '보통',
    start: { name: '백운대탐방지원센터', lat: 37.65815, lon: 126.99129 },
    summit: { name: '백운대', osmId: 5515194671, elevation: 835.6 },
    checkpoints: [
      { name: '하루재', lat: 37.66227, lon: 126.98696, note: '코스의 첫 고개' },
      { name: '인수암', lat: 37.66106, lon: 126.98483, note: '작은 암자. 근처에 화장실과 산악구조대가 있다' },
      { name: '깔딱고개', lat: 37.65992, lon: 126.98475, note: '이름처럼 숨이 깔딱 넘어가는 오르막' },
      { name: '백운산장', lat: 37.65848, lon: 126.98115, note: '정상 전 마지막 쉼터. 바로 옆에 샘터가 있다' },
      { name: '백운봉암문(위문)', lat: 37.65765, lon: 126.97955, note: '북한산성의 암문. 여기서부터 정상까지 바위 구간이다' },
    ],
  },
  {
    id: 'bukhansan-sanseong',
    mountain: '북한산',
    name: '북한산성 코스',
    level: '어려움',
    start: { name: '북한산성탐방지원센터', lat: 37.65508, lon: 126.94956 },
    summit: { name: '백운대', osmId: 5515194671, elevation: 835.6 },
    checkpoints: [
      { name: '수문터', lat: 37.65527, lon: 126.95438, note: '북한산성 계곡 물길에 있던 수문 자리' },
      { name: '보리사', lat: 37.65304, lon: 126.96263, note: '계곡 옆 작은 절. 여기서부터 본격적인 산길이다' },
      { name: '개연폭포', lat: 37.65386, lon: 126.96516, note: '옥류동 계곡을 따라 오르다 만나는 폭포' },
      { name: '대동사', lat: 37.65584, lon: 126.9702, note: '위문으로 오르기 전 마지막 절. 근처에 샘터가 있다' },
      { name: '백운봉암문(위문)', lat: 37.65765, lon: 126.97955, note: '우이동에서 오는 백운대 코스와 여기서 만난다. 정상까지 바위 구간이다' },
    ],
  },
  {
    id: 'bukhansan-jindallae',
    mountain: '북한산',
    name: '진달래능선 코스',
    level: '보통',
    start: { name: '아카데미탐방지원센터', lat: 37.64158, lon: 127.00149 },
    summit: { name: '대동문', lat: 37.64031, lon: 126.98607 },
    checkpoints: [],
  },
  {
    id: 'bukhansan-yeongbong',
    mountain: '북한산',
    name: '영봉 코스',
    level: '쉬움',
    start: { name: '백운대탐방지원센터', lat: 37.65815, lon: 126.99129 },
    summit: { name: '영봉', osmId: 5515194647, elevation: 597.1 },
    checkpoints: [
      { name: '하루재', lat: 37.66227, lon: 126.98696, note: '백운대와 영봉으로 길이 갈리는 고개' },
    ],
  },
]

// 도봉산 정상 자운봉(740m)은 암벽 장비가 있어야 올라서, 등산객이 오르는 바로 옆 신선대(726m)를 정상으로 삼는다
const DOBONGSAN_COURSES = [
  {
    id: 'dobongsan-sinseondae',
    mountain: '도봉산',
    name: '신선대 코스',
    level: '보통',
    start: { name: '도봉산탐방지원센터', lat: 37.68611, lon: 127.03613 },
    summit: { name: '신선대', osmId: 11377228354, elevation: 726 },
    via: [{ lat: 37.6941, lon: 127.01713 }], // 마당바위
    checkpoints: [
      { name: '광륜사', lat: 37.68777, lon: 127.03551, note: '도봉산 들머리에 있는 절' },
      { name: '도봉산대피소', lat: 37.6937, lon: 127.0225, note: '계곡길이 끝나고 본격적인 오르막이 시작되는 쉼터' },
      { name: '마당바위', lat: 37.6941, lon: 127.01713, note: '마당처럼 넓은 바위. 선인봉과 만장봉이 올려다보인다' },
    ],
  },
  {
    id: 'dobongsan-mangwolsa',
    mountain: '도봉산',
    name: '망월사 코스',
    level: '어려움',
    start: { name: '원도봉탐방지원센터', lat: 37.7062, lon: 127.03461 },
    summit: { name: '신선대', osmId: 11377228354, elevation: 726 },
    via: [
      { lat: 37.70459, lon: 127.02147 }, // 망월사
      { lat: 37.70117, lon: 127.01603 }, // 포대능선
    ],
    checkpoints: [
      { name: '망월사', lat: 37.70459, lon: 127.02147, note: '원도봉계곡 위 바위 아래 자리한 절. 샘터가 있다' },
      { name: '포대능선', lat: 37.70117, lon: 127.01603, note: '자운봉으로 이어지는 바위 능선' },
    ],
  },
  {
    id: 'dobongsan-uiam',
    mountain: '도봉산',
    name: '우이암 코스',
    level: '쉬움',
    start: { name: '우이탐방지원센터', lat: 37.67773, lon: 127.00331 },
    summit: { name: '우이암', lat: 37.68372, lon: 127.00908 },
    checkpoints: [],
  },
]

const MOUNTAINS = [
  {
    id: 'bukhansan',
    name: '북한산',
    park: '북한산국립공원',
    elevation: 836,
    bbox: { south: 37.634, west: 126.943, north: 37.678, east: 127.006 },
    sheets: ['37608039', '37608040', '37608049', '37608050'],
    courses: BUKHANSAN_COURSES,
  },
  {
    id: 'dobongsan',
    name: '도봉산',
    park: '북한산국립공원',
    elevation: 740,
    bbox: { south: 37.668, west: 126.995, north: 37.716, east: 127.045 },
    sheets: ['37705011', '37705012', '37705021', '37705022', '37705031', '37705032', '37608020', '37608030', '37608040'],
    courses: DOBONGSAN_COURSES,
  },
]
const MAX_CHECKPOINT_OFFSET = 40 // m

// ── 좌표 유틸 ───────────────────────────────────────
// 지금 만드는 산의 범위와 원점. selectMountain 이 산마다 바꾼다
let BBOX, OUT, origin, cosLat
function selectMountain(m) {
  BBOX = m.bbox
  OUT = path.join(DATA, m.id)
  origin = { lat: (BBOX.south + BBOX.north) / 2, lon: (BBOX.west + BBOX.east) / 2 }
  cosLat = Math.cos((origin.lat * Math.PI) / 180)
}
const R = 6378137
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
async function buildTerrain(sheetIds) {
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

  // 30m 원본(Terrarium) 높이 쌍선형 보간. 정밀 지형이 없는 곳에 쓴다
  const ext = { minX: nw.x, maxX: se.x, minZ: nw.z, maxZ: se.z }
  const baseSample = makeSampler(heights, width, height, ext)

  // 국토지리정보원 수치지형도(DXF)가 있으면 등고선으로 정밀 지형을 만든다
  let grid = { width, height, heights }
  const dxfFiles = (await fs.readdir(NGII).catch(() => [])).filter(
    (f) => f.toLowerCase().endsWith('.dxf') && sheetIds.some((id) => f.includes(id)),
  )
  const missing = sheetIds.filter((id) => !dxfFiles.some((f) => f.includes(id)))
  if (dxfFiles.length && missing.length) console.warn(`  ! 도엽 ${missing.join(', ')} 이 없어 그 자리는 30m 지형을 쓴다`)
  if (dxfFiles.length) {
    const sheets = []
    for (const f of dxfFiles) sheets.push(parseDxf((await fs.readFile(path.join(NGII, f))).toString('latin1')))
    const dem = buildContourDem({ sheets, toLocal, extent: ext, spacing: CONTOUR_SPACING, baseSample })
    grid = dem
    console.log(
      `정밀 지형: 도엽 ${dxfFiles.length}개, 등고선 ${dem.contourCount}개, 표고점 ${dem.spotCount}개, ` +
        `${CONTOUR_SPACING}m 격자 ${dem.width}x${dem.height}, 기준 차이 보정 ${dem.offset.toFixed(1)}m, ` +
        `보간 ${dem.iterations}회(마지막 변화 ${dem.change.toFixed(3)}m)`,
    )
  }

  let min = Infinity, max = -Infinity
  for (const h of grid.heights) { min = Math.min(min, h); max = Math.max(max, h) }

  // 높이는 min~max 를 0~65535 로 나눈 uint16 으로 담는다. float32 의 절반 크기이고 한 칸은 1~2cm 다 (src/lib/data.ts decodeHeights)
  const meta = { width: grid.width, height: grid.height, ...ext, minHeight: min, maxHeight: max, origin, encoding: 'uint16' }
  const quantized = Uint16Array.from(grid.heights, (h) => Math.round(((h - min) / (max - min)) * 65535))
  await fs.writeFile(path.join(OUT, 'terrain.bin'), Buffer.from(quantized.buffer))
  await fs.writeFile(path.join(OUT, 'terrain.json'), JSON.stringify(meta, null, 2))
  console.log(`지형 ${grid.width}x${grid.height}, 높이 ${min.toFixed(0)}~${max.toFixed(0)}m, 크기 ${(se.x - nw.x).toFixed(0)}x${(se.z - nw.z).toFixed(0)}m`)

  // 등산로 높이 샘플링용
  return makeSampler(grid.heights, grid.width, grid.height, ext)
}

/** 격자 높이를 쌍선형 보간하는 함수를 만든다 */
function makeSampler(heights, width, height, ext) {
  return (x, z) => {
    const fx = ((x - ext.minX) / (ext.maxX - ext.minX)) * (width - 1)
    const fz = ((z - ext.minZ) / (ext.maxZ - ext.minZ)) * (height - 1)
    const i = Math.max(0, Math.min(width - 2, Math.floor(fx)))
    const j = Math.max(0, Math.min(height - 2, Math.floor(fz)))
    const u = fx - i, v = fz - j
    const h = (a, b) => heights[b * width + a]
    return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v
  }
}

// ── 2. 등산로 ──────────────────────────────────────
async function loadOsm() {
  // 받는 범위나 길 종류가 바뀌면 새로 받도록 파일 이름에 버전과 범위를 넣는다
  const file = path.join(RAW, `osm-v3-${BBOX.south}-${BBOX.west}-${BBOX.north}-${BBOX.east}.json`)
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    const box = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`
    // 북한산성 계곡길처럼 차도(대서문길 residential 등)로 표시된 탐방로도 있어 작은 길은 함께 받는다
    const q = `[out:json][timeout:120];(way["highway"~"^(path|footway|track|steps|pedestrian|service|unclassified|residential|living_street)$"](${box});node["natural"="peak"](${box}););out body;>;out skel qt;`
    // Overpass 는 붐비면 502·504 를 자주 내서 몇 번 다시 시도한다
    for (let attempt = 1; ; attempt++) {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
      })
      const text = await res.text()
      if (text.startsWith('{')) {
        await fs.writeFile(file, text)
        return JSON.parse(text)
      }
      if (attempt >= 5) throw new Error('Overpass 응답 오류 (잠시 뒤 다시 실행): ' + text.slice(0, 120))
      console.warn(`  Overpass 응답 오류, ${attempt * 10}초 뒤 다시 시도`)
      await new Promise((r) => setTimeout(r, attempt * 10000))
    }
  }
}

/** 등산로 그래프 (노드와 이웃 목록). 출입금지·비법정·암벽 구간은 뺀다 */
function buildGraph(osm) {
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
  return { nodes, adj }
}

/** 좌표에서 가장 가까운 등산로 노드. among 을 주면 그 노드들 가운데서만 고른다 */
function nearestNode({ nodes, adj }, coord, among = adj.keys()) {
  let id = null, best = Infinity
  for (const k of among) {
    const d = haversine(nodes.get(k), coord)
    if (d < best) { best = d; id = k }
  }
  return id
}

/**
 * 출발 좌표에서 목적지까지 가장 짧은 등산로 (다익스트라).
 * 목적지 봉우리 노드가 길과 이어져 있지 않으면 가장 가까운 길 노드까지 간 뒤 봉우리를 덧붙인다.
 */
function shortestPath(graph, startCoord, goalCoord) {
  const { nodes, adj } = graph
  const goal = goalCoord.id !== undefined && adj.has(goalCoord.id) ? goalCoord.id : nearestNode(graph, goalCoord)
  // 주차장 길처럼 등산로와 끊긴 조각에서 출발하지 않게, 목적지와 이어진 노드 가운데서 출발점을 고른다
  const linked = new Set([goal])
  const queue = [goal]
  while (queue.length) for (const [nb] of adj.get(queue.pop()) ?? []) if (!linked.has(nb)) { linked.add(nb); queue.push(nb) }
  const startId = nearestNode(graph, startCoord, linked)
  const startGap = haversine(nodes.get(startId), startCoord)
  if (startGap > 80) console.warn(`  ! 출발점이 이어진 길에서 ${startGap.toFixed(0)}m 떨어져 있다`)

  // 노드 수가 적어 단순 구현
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
  if (goal !== goalCoord.id && haversine(nodes.get(goal), goalCoord) > 1) route.push(goalCoord)
  return route
}

/** 코스 하나의 등산로 데이터를 만든다 */
function buildTrail(course, graph, sampleHeight) {
  console.log(`[${course.name}]`)
  const goal = course.summit.osmId !== undefined
    ? { id: course.summit.osmId, ...graph.nodes.get(course.summit.osmId) }
    : { lat: course.summit.lat, lon: course.summit.lon }
  if (goal.lat === undefined) throw new Error(`${course.summit.name} 노드(${course.summit.osmId})가 OSM 데이터에 없습니다`)
  // via 가 있으면 그 지점에서 가장 가까운 길 노드를 차례로 거쳐 간다 (가장 짧은 길이 대표 코스가 아닐 때)
  const legs = [...(course.via ?? []).map((v) => {
    const id = nearestNode(graph, v)
    const gap = haversine(graph.nodes.get(id), v)
    if (gap > MAX_CHECKPOINT_OFFSET) console.warn(`  ! 거쳐 갈 지점이 길에서 ${gap.toFixed(0)}m 떨어져 있다`)
    return { id, ...graph.nodes.get(id) }
  }), goal]
  const route = []
  let from = course.start
  for (const leg of legs) {
    const part = shortestPath(graph, from, leg)
    route.push(...(route.length ? part.slice(1) : part))
    from = leg
  }

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
  const cumulative = [0]
  for (let k = 1; k < points.length; k++) {
    const [x0, y0, z0] = points[k - 1], [x1, y1, z1] = points[k]
    length += Math.hypot(x1 - x0, y1 - y0, z1 - z0)
    cumulative.push(length)
    if (y1 > y0) gain += y1 - y0
  }

  // 이정표를 등산로 위 가장 가까운 점에 붙이고 출발점에서의 거리를 구한다
  const checkpoints = []
  for (const cp of course.checkpoints) {
    const p = toLocal(cp.lat, cp.lon)
    let best = 0, bestD = Infinity
    points.forEach(([x, , z], k) => {
      const d = Math.hypot(x - p.x, z - p.z)
      if (d < bestD) { bestD = d; best = k }
    })
    if (bestD > MAX_CHECKPOINT_OFFSET) {
      console.warn(`  ! ${cp.name} 은 등산로에서 ${bestD.toFixed(0)}m 떨어져 있어 뺐다`)
      continue
    }
    checkpoints.push({ name: cp.name, note: cp.note, distance: Math.round(cumulative[best]) })
    console.log(`  이정표 ${cp.name}: 출발 ${Math.round(cumulative[best])}m, 해발 ${points[best][1].toFixed(0)}m, 길에서 ${bestD.toFixed(0)}m`)
  }
  checkpoints.sort((a, b) => a.distance - b.distance)
  const top = points[points.length - 1]
  console.log(`  ${route.length}개 노드 → ${points.length}개 점, 길이 ${(length / 1000).toFixed(2)}km, 누적 오르막 ${gain.toFixed(0)}m, 도착 해발 ${top[1].toFixed(0)}m`)
  return {
    id: course.id,
    mountain: course.mountain,
    name: course.name,
    level: course.level,
    start: course.start.name,
    summit: course.summit.name,
    summitElevation: course.summit.elevation ?? Math.round(top[1]),
    length: Math.round(length),
    elevationGain: Math.round(gain),
    checkpoints,
    points,
  }
}

const only = process.argv.slice(2)
const unknown = only.filter((id) => !MOUNTAINS.some((m) => m.id === id))
if (unknown.length) throw new Error(`모르는 산: ${unknown.join(', ')} (있는 산: ${MOUNTAINS.map((m) => m.id).join(', ')})`)

await fs.mkdir(RAW, { recursive: true })
for (const m of MOUNTAINS) {
  if (only.length && !only.includes(m.id)) continue
  console.log(`\n=== ${m.name} (${m.id}) ===`)
  selectMountain(m)
  await fs.mkdir(OUT, { recursive: true })
  const sampleHeight = await buildTerrain(m.sheets)
  const graph = buildGraph(await loadOsm())
  const trails = m.courses.map((c) => ({ ...buildTrail(c, graph, sampleHeight), park: m.park }))
  await fs.writeFile(path.join(OUT, 'courses.json'), JSON.stringify(trails))
  console.log(`코스 ${trails.length}개를 ${m.id}/courses.json 에 썼다`)
}

// 산 목록. 앱이 처음에 받아 산 고르기와 첫 화면 문구에 쓴다
const list = MOUNTAINS.map((m) => ({ id: m.id, name: m.name, elevation: m.elevation, courses: m.courses.length }))
await fs.writeFile(path.join(DATA, 'mountains.json'), JSON.stringify(list, null, 2))
console.log(`\n산 ${list.length}개를 mountains.json 에 썼다`)
