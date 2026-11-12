// 국토지리정보원 1:5,000 수치지형도(DXF)의 등고선·표고점으로 높이 격자를 만든다.
// prepare-data.mjs 에서 불러 쓴다. GDAL 없이 좌표 변환과 보간을 직접 한다.

// ── EPSG:5186 (KGD2002 중부원점 TM) → 위경도 ─────────────────
const A = 6378137
const F = 1 / 298.257222101 // GRS80
const E2 = 2 * F - F * F
const EP2 = E2 / (1 - E2)
// 중부원점: 북위 38°, 동경 127° 를 (200000, 600000) m 로 둔다. 축척 계수는 1
const K0 = 1
const LAT0 = (38 * Math.PI) / 180
const LON0 = (127 * Math.PI) / 180
const FE = 200000
const FN = 600000

const meridianArc = (phi) =>
  A *
  ((1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * phi -
    ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi) +
    ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi) -
    ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi))
const M0 = meridianArc(LAT0)

/** 횡메르카토르 역변환 (Snyder 식 8-18~8-25). 반환: { lat, lon } (도) */
function tm5186ToLatLon(x, y) {
  const M = M0 + (y - FN) / K0
  const mu = M / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256))
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2))
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu)
  const sin1 = Math.sin(phi1)
  const cos1 = Math.cos(phi1)
  const tan1 = Math.tan(phi1)
  const C1 = EP2 * cos1 ** 2
  const T1 = tan1 ** 2
  const N1 = A / Math.sqrt(1 - E2 * sin1 ** 2)
  const R1 = (A * (1 - E2)) / (1 - E2 * sin1 ** 2) ** 1.5
  const D = (x - FE) / (N1 * K0)
  const lat =
    phi1 -
    ((N1 * tan1) / R1) *
      (D ** 2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * EP2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * EP2 - 3 * C1 ** 2) * D ** 6) / 720)
  const lon =
    LON0 +
    (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * EP2 + 24 * T1 ** 2) * D ** 5) / 120) /
      cos1
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI }
}

// ── DXF 읽기 ─────────────────────────────────────────────
const CONTOUR_LAYERS = ['F0017111', 'F0017114'] // 주곡선(5m), 계곡선(25m)
const SPOT_LAYER = 'F0027217' // 표고점

/**
 * DXF 에서 등고선(높이가 있는 폴리라인)과 표고점, 도엽 범위를 꺼낸다.
 * 반환 좌표는 EPSG:5186 (m).
 */
export function parseDxf(text) {
  const lines = text.split(/\r?\n/)
  const contours = []
  const spots = []
  let extMin = null
  let extMax = null
  let inEntities = false
  let entity = null

  const flush = () => {
    if (!entity) return
    if (entity.type === 'LWPOLYLINE' && CONTOUR_LAYERS.includes(entity.layer) && entity.elev != null && entity.pts.length > 1) {
      contours.push({ z: entity.elev, pts: entity.pts })
    } else if (entity.type === 'INSERT' && entity.layer === SPOT_LAYER && entity.z != null) {
      spots.push({ x: entity.x, y: entity.y, z: entity.z })
    }
    entity = null
  }

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i].trim()
    const val = lines[i + 1].trim()
    if (code === '9' && (val === '$EXTMIN' || val === '$EXTMAX')) {
      const p = { x: Number(lines[i + 3].trim()), y: Number(lines[i + 5].trim()) }
      if (val === '$EXTMIN') extMin = p
      else extMax = p
      continue
    }
    if (code === '2' && val === 'ENTITIES') inEntities = true
    if (code === '0') {
      flush()
      if (val === 'ENDSEC') inEntities = false
      else if (inEntities) entity = { type: val, layer: null, pts: [], elev: null }
      continue
    }
    if (!entity) continue
    if (code === '8') entity.layer = val
    else if (code === '38') entity.elev = Number(val)
    else if (code === '10') {
      if (entity.type === 'LWPOLYLINE') entity.pts.push({ x: Number(val), y: NaN })
      else entity.x = Number(val)
    } else if (code === '20') {
      if (entity.type === 'LWPOLYLINE') entity.pts[entity.pts.length - 1].y = Number(val)
      else entity.y = Number(val)
    } else if (code === '30' && entity.type === 'INSERT') entity.z = Number(val)
  }
  flush()
  return { contours, spots, extMin, extMax }
}

// ── 등고선 → 높이 격자 ───────────────────────────────────
/**
 * @param sheets      parseDxf 결과 배열
 * @param toLocal     (lat, lon) → { x, z } 로컬 좌표(m)
 * @param extent      { minX, maxX, minZ, maxZ } 만들 격자의 범위(로컬 m)
 * @param spacing     격자 간격(m)
 * @param baseSample  (x, z) → 높이. 도엽 밖과 첫 추정값에 쓰는 기존(30m) 지형
 */
export function buildContourDem({ sheets, toLocal, extent, spacing, baseSample }) {
  const width = Math.round((extent.maxX - extent.minX) / spacing) + 1
  const height = Math.round((extent.maxZ - extent.minZ) / spacing) + 1
  const cellX = (extent.maxX - extent.minX) / (width - 1)
  const cellZ = (extent.maxZ - extent.minZ) / (height - 1)
  const local = (p) => {
    const { lat, lon } = tm5186ToLatLon(p.x, p.y)
    return toLocal(lat, lon)
  }

  // 1) 기존 지형과 국토지리정보원 높이 기준 차이를 표고점으로 재서 보정한다
  const diffs = []
  for (const s of sheets) for (const sp of s.spots) {
    const p = local(sp)
    diffs.push(sp.z - baseSample(p.x, p.z))
  }
  diffs.sort((a, b) => a - b)
  const offset = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0

  // 2) 첫 추정값은 보정한 기존 지형. 도엽 밖 칸은 이 값으로 고정한다
  const value = new Float32Array(width * height)
  const fixed = new Uint8Array(width * height)
  const inside = new Uint8Array(width * height)
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++)
      value[j * width + i] = baseSample(extent.minX + i * cellX, extent.minZ + j * cellZ) + offset

  for (const s of sheets) {
    if (!s.extMin || !s.extMax) continue
    const corners = [
      local({ x: s.extMin.x, y: s.extMin.y }),
      local({ x: s.extMax.x, y: s.extMin.y }),
      local({ x: s.extMin.x, y: s.extMax.y }),
      local({ x: s.extMax.x, y: s.extMax.y }),
    ]
    const i0 = Math.ceil((Math.min(...corners.map((c) => c.x)) - extent.minX) / cellX)
    const i1 = Math.floor((Math.max(...corners.map((c) => c.x)) - extent.minX) / cellX)
    const j0 = Math.ceil((Math.min(...corners.map((c) => c.z)) - extent.minZ) / cellZ)
    const j1 = Math.floor((Math.max(...corners.map((c) => c.z)) - extent.minZ) / cellZ)
    for (let j = Math.max(1, j0); j <= Math.min(height - 2, j1); j++)
      for (let i = Math.max(1, i0); i <= Math.min(width - 2, i1); i++) inside[j * width + i] = 1
  }
  for (let k = 0; k < fixed.length; k++) if (!inside[k]) fixed[k] = 1

  // 3) 등고선과 표고점을 격자에 찍는다. 한 칸에 여러 값이 오면 평균
  const sum = new Float64Array(width * height)
  const count = new Uint16Array(width * height)
  const stamp = (x, z, h) => {
    const i = Math.round((x - extent.minX) / cellX)
    const j = Math.round((z - extent.minZ) / cellZ)
    if (i < 0 || j < 0 || i >= width || j >= height) return
    const k = j * width + i
    if (!inside[k]) return
    sum[k] += h
    count[k]++
  }
  let contourCount = 0
  for (const s of sheets) {
    for (const c of s.contours) {
      contourCount++
      const pts = c.pts.map(local)
      for (let n = 1; n < pts.length; n++) {
        const a = pts[n - 1]
        const b = pts[n]
        // 칸 크기의 0.4 배 간격으로 찍어 선분이 지나는 칸을 하나도 빠뜨리지 않는다
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (spacing * 0.4)))
        for (let t = 0; t <= steps; t++) stamp(a.x + ((b.x - a.x) * t) / steps, a.z + ((b.z - a.z) * t) / steps, c.z)
      }
    }
    for (const sp of s.spots) {
      const p = local(sp)
      stamp(p.x, p.z, sp.z)
    }
  }
  let stamped = 0
  for (let k = 0; k < count.length; k++)
    if (count[k]) {
      value[k] = sum[k] / count[k]
      fixed[k] = 1
      stamped++
    }

  // 4) 나머지 칸은 라플라스 방정식(주변 평균)으로 채운다. SOR 로 빨리 수렴시킨다
  // OMEGA 는 2 에 가까울수록 빨리 수렴한다(2 이상이면 발산). 한 번 돌아 가장 크게 바뀐 칸이 5mm 아래면 멈추고, 4000 번에서는 그만둔다
  const OMEGA = 1.92
  let iterations = 0
  let change = Infinity
  while (change > 0.005 && iterations < 4000) {
    change = 0
    for (let j = 1; j < height - 1; j++) {
      for (let i = 1; i < width - 1; i++) {
        const k = j * width + i
        if (fixed[k]) continue
        const avg = (value[k - 1] + value[k + 1] + value[k - width] + value[k + width]) / 4
        const d = OMEGA * (avg - value[k])
        value[k] += d
        if (Math.abs(d) > change) change = Math.abs(d)
      }
    }
    iterations++
  }

  return { width, height, heights: value, offset, contourCount, spotCount: diffs.length, stamped, iterations, change }
}
