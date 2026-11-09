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
// checkpoints 는 가는 길에 지나는 이정표. 등산로에서 MAX_CHECKPOINT_OFFSET(이정표에 maxOffset 이 있으면 그 값)보다 멀면 빼고 경고한다
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
  // 우이동 쪽 들머리에서 진달래능선(OSM 「진달래길」)을 따라 대동문까지 오른다. 예전에는 아카데미탐방지원센터에서 가장 짧은 계곡 길로 가서
  // 능선과는 마지막 15m 만 겹쳤다. 가장 짧은 길이 능선을 벗어나지 않게 능선 위 두 지점을 거쳐 가게 한다
  {
    id: 'bukhansan-jindallae',
    mountain: '북한산',
    name: '진달래능선 코스',
    level: '보통',
    start: { name: '진달래능선 입구', lat: 37.65893, lon: 127.00427 },
    summit: { name: '대동문', lat: 37.64031, lon: 126.98607 },
    via: [
      { lat: 37.65336, lon: 127.00001 },
      { lat: 37.64297, lon: 126.98977 },
    ],
    checkpoints: [
      { name: '소귀천계곡 갈림길', lat: 37.65018, lon: 126.99688, note: '능선에서 소귀천계곡 쪽으로 길이 갈라지는 곳' },
      { name: '샘터', lat: 37.64109, lon: 126.98654, note: '대동문 바로 아래 샘터. 정상까지 얼마 남지 않았다' },
    ],
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
      // 망월사에서 곧장 올라온 길이 포대능선과 만나는 곳. 다락능선과 만나는 남쪽 끝을 거치게 하면 망월사에서 다시 내려가 다락능선으로 돌아 오른다
      { lat: 37.70767, lon: 127.0193 },
    ],
    checkpoints: [
      { name: '망월사', lat: 37.70459, lon: 127.02147, note: '원도봉계곡 위 바위 아래 자리한 절. 샘터가 있다' },
      { name: '포대능선', lat: 37.70767, lon: 127.0193, note: '망월사에서 올라와 자운봉으로 이어지는 바위 능선에 올라서는 곳' },
    ],
  },
  {
    id: 'dobongsan-uiam',
    mountain: '도봉산',
    name: '우이암 코스',
    level: '쉬움',
    // 무수골 매표소에서 정식 등산로(OSM 「무수골 매표소-원통사」)로 자현암과 원통사를 지나 오른다. 예전 출발점(우이탐방지원센터)은
    // 우이령길 입구라 우이암 등산로와 바로 이어지지 않아, 마을 관리 도로로 450m 를 내려갔다 돌아 올라갔다
    start: { name: '무수골 매표소', lat: 37.67545, lon: 127.02436 },
    summit: { name: '우이암', lat: 37.68372, lon: 127.00908 },
    checkpoints: [
      { name: '자현암', lat: 37.6767, lon: 127.02172, note: '무수골 계곡 길가의 작은 암자' },
      { name: '원통사', lat: 37.68311, lon: 127.01084, note: '우이암 바로 아래 절. 원통사약수가 있다' },
    ],
  },
]

// 관악산 정상(연주대 옆 632m 봉우리)
const GWANAKSAN_COURSES = [
  // 사당 쪽 능선: 관음사에서 국기봉 둘과 하마바위, 마당바위, 관악문을 지나 연주대에 오른다. 사람이 가장 많이 다니는 길이다.
  // 사당역에서 관음사까지는 1km 가까이 도시 길이라 관음사에서 출발한다
  {
    id: 'gwanaksan-sadang',
    mountain: '관악산',
    name: '사당 코스',
    level: '보통',
    start: { name: '관음사', lat: 37.46732, lon: 126.9771 },
    summit: { name: '연주대', osmId: 442878166, elevation: 632 },
    // 관악문에서 연주대로 오르는 마지막 바위 구간(계단과 난간이 있다)이 OSM 에 암벽으로 올라 있다.
    // 빼면 연주암 쪽으로 85m 를 내려갔다 돌아 올라서, 이 코스는 짧은 암벽 구간을 허용한다
    allowAlpine: true,
    // 가장 짧은 길은 1.5km 쯤에서 동쪽 파이프능선으로 빠지고 마당바위 뒤에서도 능선을 벗어나서, 능선 위 세 곳을 거쳐 가게 한다
    via: [
      { lat: 37.45859, lon: 126.9679 }, // 하마바위
      { lat: 37.45672, lon: 126.96618 }, // 마당바위
      { lat: 37.44646, lon: 126.96763 }, // 관악문
    ],
    checkpoints: [
      { name: '관음사 국기봉', lat: 37.46458, lon: 126.97425, note: '사당 능선에 올라서면 처음 만나는 태극기 봉우리' },
      { name: '선유천 국기봉', lat: 37.46283, lon: 126.97071, note: '두 번째 국기봉. 능선 너머로 서울 시내가 보인다' },
      { name: '하마바위', lat: 37.45859, lon: 126.9679, note: '두꺼비(하마)를 닮은 너럭바위' },
      { name: '마당바위', lat: 37.45672, lon: 126.96618, note: '마당처럼 넓은 바위. 쉬어 가는 사람이 많다' },
      { name: '관악문', lat: 37.44646, lon: 126.96763, note: '바위 사이로 난 문 같은 길. 정상이 코앞이다' },
    ],
  },
  // 과천 쪽: 과천향교에서 자하능선(OSM 정식 등산로)을 타고 연주암을 거쳐 연주대에 오른다
  {
    id: 'gwanaksan-gwacheon',
    mountain: '관악산',
    name: '과천 코스',
    level: '보통',
    start: { name: '과천향교', lat: 37.43387, lon: 126.98739 },
    summit: { name: '연주대', osmId: 442878166, elevation: 632 },
    checkpoints: [
      { name: '연주암', lat: 37.4417, lon: 126.96533, note: '연주대 바로 아래 절. 정상까지 마지막 오르막이 남았다' },
    ],
  },
]

// 수락산 정상 주봉(638m). 노원 쪽 수락산역, 의정부 쪽 장암, 당고개 쪽 학림사에서 오르는 세 길
const SURAKSAN_COURSES = [
  // 수락산역 쪽: 수락산광장에서 벽운계곡을 따라 매월정과 깔딱고개, 철모바위를 지나 주봉에 오른다
  {
    id: 'suraksan-surak',
    mountain: '수락산',
    name: '수락산역 코스',
    level: '보통',
    start: { name: '수락산광장', lat: 37.68918, lon: 127.05726 },
    summit: { name: '주봉', osmId: 3803846068, elevation: 638 },
    checkpoints: [
      { name: '매월정', lat: 37.69551, lon: 127.07405, note: '능선 아래 쉼터 정자. 노원 시내가 내려다보인다' },
      { name: '깔딱고개', lat: 37.69583, lon: 127.07635, note: '이름처럼 숨이 깔딱 넘어가는 오르막' },
      { name: '철모바위', lat: 37.69749, lon: 127.08139, note: '군인 철모를 엎어 놓은 듯한 바위. 정상이 코앞이다' },
    ],
  },
  // 의정부 장암 쪽: 석림사 입구에서 석림사를 지나 계곡을 거슬러 기차바위를 거쳐 주봉에 오른다
  {
    id: 'suraksan-jangam',
    mountain: '수락산',
    name: '장암 코스',
    level: '어려움',
    start: { name: '석림사 입구', lat: 37.69995, lon: 127.06353 },
    summit: { name: '주봉', osmId: 3803846068, elevation: 638 },
    // 가장 짧은 길은 석림사 뒤 계곡으로 정상에 곧장 올라 기차바위를 지나지 않아서 기차바위를 거쳐 가게 한다
    via: [{ lat: 37.70311, lon: 127.08271 }],
    checkpoints: [
      { name: '석림사', lat: 37.70127, lon: 127.06654, note: '노강서원 위 계곡가의 절', maxOffset: 70 },
      { name: '기차바위', lat: 37.70311, lon: 127.08271, note: '기차처럼 길게 누운 바위. 밧줄을 잡고 오른다' },
    ],
  },
  // 당고개 쪽: 학림사에서 용굴암과 도솔봉을 지나 치마바위, 코끼리바위를 거쳐 주봉에 오른다
  {
    id: 'suraksan-dosol',
    mountain: '수락산',
    name: '도솔봉 코스',
    level: '보통',
    start: { name: '학림사', lat: 37.68213, lon: 127.07737 },
    summit: { name: '주봉', osmId: 3803846068, elevation: 638 },
    checkpoints: [
      { name: '용굴암', lat: 37.68822, lon: 127.08175, note: '바위굴 옆에 자리한 작은 암자', maxOffset: 70 },
      { name: '도솔봉', lat: 37.69059, lon: 127.08471, note: '수락산 남쪽 봉우리. 등산로는 봉우리 바로 아래를 지난다', maxOffset: 70 },
      { name: '치마바위', lat: 37.69373, lon: 127.08439, note: '치마를 펼친 듯 넓게 누운 바위' },
      { name: '코끼리바위', lat: 37.69509, lon: 127.08287, note: '코끼리 머리를 닮은 바위' },
    ],
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
  {
    id: 'gwanaksan',
    name: '관악산',
    elevation: 632,
    bbox: { south: 37.425, west: 126.945, north: 37.475, east: 127.0 },
    sheets: ['37612018', '37612019', '37612020', '37612028', '37612029', '37612030'],
    courses: GWANAKSAN_COURSES,
  },
  {
    id: 'suraksan',
    name: '수락산',
    elevation: 638,
    bbox: { south: 37.675, west: 127.05, north: 37.715, east: 127.1 },
    sheets: ['37705013', '37705014', '37705023', '37705024'],
    courses: SURAKSAN_COURSES,
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
/** 코스에 allowAlpine 을 주면 암벽 구간도 길로 쓰되 이만큼 비싸게 매겨, 돌아가는 길보다 훨씬 짧을 때만 지나게 한다 */
const ALPINE_PENALTY = 3
function buildGraph(osm, { allowAlpine = false } = {}) {
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
    // 암벽·릿지 구간은 빼고, 허용한 코스에서만 비싸게 매겨 쓴다
    const alpine = t.sac_scale && /alpine/.test(t.sac_scale)
    if (alpine && !allowAlpine) continue
    // 정식 등산로(sac_scale 표시)를 우선: 표시 없는 길은 비용 1.5배
    const penalty = alpine ? ALPINE_PENALTY : t.sac_scale ? 1 : 1.5
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

/**
 * 군더더기 잘라 내기: 지나온 자리에서 SPUR_GAP 안으로 되돌아오는데 그사이 경로가 SPUR_MIN~SPUR_MAX 이면 갔다가 되짚어 온 구간으로 보고 뺀다.
 * 같은 자리를 지나는 OSM 길이 겹쳐 있으면 가장 짧은 길이 한쪽으로 조금 갔다가 다른 길로 갈아타 돌아오는 일이 있다.
 * 망월사 코스는 중간에 이렇게 70m 를 왕복하는 구간이 있었다.
 * SPUR_MIN 은 갈지자 길의 꺾이는 끝처럼 짧게 가까워지는 곳을 자르지 않으려는 하한이다.
 *
 * 출발점은 따로 더 넓게(START_SPUR_GAP) 본다. 출발점 옆으로 나란히 지나는 길이 있으면 되돌아오는 길이 출발점을 정확히 지나지 않는다.
 * 진달래능선 코스는 출발점에서 산 반대쪽으로 13m 내려갔다가 3m 옆 길로 돌아와서 캐릭터가 산을 등지고 섰다.
 * 출발 방향이 거꾸로 서면 바로 눈에 띄므로 출발점만 기준을 넓히고, 경로가 출발점 가까이 돌아온 가장 먼 지점부터 시작한다
 */
const SPUR_GAP = 3
const SPUR_MIN = 12
const SPUR_MAX = 150
const START_SPUR_GAP = 5
/** 길이 도착점에서 이 거리(m) 안을 지나면 거기서 끝낸다 */
const GOAL_SNAP = 5
/** 점 p 에서 선분 a-b 위 가장 가까운 점 */
function nearestOnSegment(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2))
  return { x: a.x + dx * t, z: a.z + dz * t }
}
/**
 * 경로 한 구간(출발점이나 거쳐 갈 지점에서 다음 지점까지)의 군더더기를 뺀다. 거쳐 갈 지점에 들렀다 되돌아 나오는 길은 일부러 가는 길이라
 * 구간을 나눠 부른다. fromStart 면 코스 출발점이라 출발점 규칙도 쓴다
 */
function trimSpurs(input, courseName, fromStart) {
  let raw = input
  // 출발점 군더더기: 출발점에서 START_SPUR_GAP 안으로 돌아오는 가장 먼 선분을 찾아 그 위 가장 가까운 점에서 시작한다
  // 되돌아온 거리는 선분 위 가장 가까운 점까지 잰다 (선분 시작점까지만 재면 긴 선분 하나로 돌아오는 길을 놓친다)
  let along = 0
  let startCut = -1
  for (let k = 1; fromStart && k + 1 < raw.length; k++) {
    along += Math.hypot(raw[k].x - raw[k - 1].x, raw[k].z - raw[k - 1].z)
    if (along > SPUR_MAX) break
    const q = nearestOnSegment(raw[0], raw[k], raw[k + 1])
    if (along + Math.hypot(q.x - raw[k].x, q.z - raw[k].z) < SPUR_MIN) continue
    if (Math.hypot(q.x - raw[0].x, q.z - raw[0].z) < START_SPUR_GAP) startCut = k
  }
  if (startCut > 0) {
    const q = nearestOnSegment(raw[0], raw[startCut], raw[startCut + 1])
    console.log(`  ${courseName}: 출발점에서 갔다가 ${Math.hypot(q.x - raw[0].x, q.z - raw[0].z).toFixed(1)}m 옆으로 되돌아오는 군더더기를 뺐다`)
    raw = [q, ...raw.slice(startCut + 1)]
  }
  const out = []
  for (let i = 0; i < raw.length; i++) {
    out.push(raw[i])
    along = 0
    let cut = -1
    for (let j = i + 1; j < raw.length; j++) {
      along += Math.hypot(raw[j].x - raw[j - 1].x, raw[j].z - raw[j - 1].z)
      if (along > SPUR_MAX) break
      if (along >= SPUR_MIN && Math.hypot(raw[j].x - raw[i].x, raw[j].z - raw[i].z) < SPUR_GAP) cut = j
    }
    if (cut > 0) {
      let len = 0
      for (let j = i + 1; j <= cut; j++) len += Math.hypot(raw[j].x - raw[j - 1].x, raw[j].z - raw[j - 1].z)
      console.log(`  ${courseName}: ${i}번째 노드에서 ${len.toFixed(0)}m 갔다가 되돌아오는 군더더기를 뺐다`)
      i = cut // raw[cut] 은 raw[i] 와 같은 자리라 건너뛴다
    }
  }
  return out
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
  // 구간마다 로컬 좌표로 바꾸고 군더더기를 뺀 뒤 잇는다
  const route = []
  let from = course.start
  for (const leg of legs) {
    const part = trimSpurs(shortestPath(graph, from, leg).map((n) => toLocal(n.lat, n.lon)), course.name, from === course.start)
    route.push(...(route.length ? part.slice(1) : part))
    from = leg
  }

  // 도착점이 길 노드가 아니면 가장 가까운 노드까지 간 뒤 도착점을 덧붙이는데, 길이 도착점 옆을 지나 그 너머 노드까지 가면
  // 갔다가 되돌아오는 꼬리가 생긴다(관악산 사당 코스는 연주대 봉우리를 지나 6m 아래 노드까지 갔다 돌아왔다).
  // 길이 도착점 5m 안을 지나면 그 자리에서 끝낸다
  const goalLocal = toLocal(goal.lat, goal.lon)
  let cutAt = -1
  let cutPoint = null
  let cutDist = GOAL_SNAP
  for (let k = 1; k < route.length - 1; k++) {
    const q = nearestOnSegment(goalLocal, route[k - 1], route[k])
    const dd = Math.hypot(q.x - goalLocal.x, q.z - goalLocal.z)
    if (dd < cutDist) {
      cutDist = dd
      cutAt = k
      cutPoint = q
    }
  }
  // 도착점 쪽으로 다가가다 끝나는 보통 경우는 그대로 둔다. 끊을 자리 뒤 꼬리가 도착점까지 거리의 두 배보다 3m 넘게 길 때만
  // 지나쳤다 되돌아오는 것으로 본다
  let tail = 0
  if (cutAt > 0) {
    tail = Math.hypot(route[cutAt].x - cutPoint.x, route[cutAt].z - cutPoint.z)
    for (let k = cutAt + 1; k < route.length; k++) tail += Math.hypot(route[k].x - route[k - 1].x, route[k].z - route[k - 1].z)
  }
  if (cutAt > 0 && tail > cutDist * 2 + 3) {
    console.log(`  ${course.name}: 길이 도착점 ${cutDist.toFixed(1)}m 옆을 지나 그 자리에서 끝낸다 (뒤 ${route.length - cutAt}개 노드를 뺐다)`)
    route.splice(cutAt, route.length - cutAt, cutPoint)
  }

  // 2m 간격으로 다시 나눠 부드럽게 만든다
  const raw = route
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
    // 절이나 봉우리처럼 등산로가 바로 아래를 비켜 지나는 곳은 이정표에 maxOffset 을 주어 더 멀리까지 받는다
    if (bestD > (cp.maxOffset ?? MAX_CHECKPOINT_OFFSET)) {
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
  const osm = await loadOsm()
  const graph = buildGraph(osm)
  // 암벽 구간을 허용한 코스가 있을 때만 그 그래프를 따로 만든다
  const alpineGraph = m.courses.some((c) => c.allowAlpine) ? buildGraph(osm, { allowAlpine: true }) : null
  const trails = m.courses.map((c) => ({ ...buildTrail(c, c.allowAlpine ? alpineGraph : graph, sampleHeight), park: m.park }))
  await fs.writeFile(path.join(OUT, 'courses.json'), JSON.stringify(trails))
  console.log(`코스 ${trails.length}개를 ${m.id}/courses.json 에 썼다`)
}

// 산 목록. 앱이 처음에 받아 산 고르기와 첫 화면 문구에 쓴다
const list = MOUNTAINS.map((m) => ({ id: m.id, name: m.name, elevation: m.elevation, courses: m.courses.length }))
await fs.writeFile(path.join(DATA, 'mountains.json'), JSON.stringify(list, null, 2))
console.log(`\n산 ${list.length}개를 mountains.json 에 썼다`)
