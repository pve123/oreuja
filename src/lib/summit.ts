import * as THREE from 'three'
import { sampleHeight, type Terrain, type Trail } from './data'

/** 기념사진 카메라는 정상에서 풍경 반대쪽으로 이만큼 물러난다(m) */
export const PHOTO_CAMERA_BACK = 6

/** 시야를 재는 거리(m). 가까운 바위부터 먼 능선까지 */
const VISTA_RANGES = [5, 10, 15, 20, 30, 45, 60, 90, 120]
/** 눈높이(m). 정상에 선 사람 눈 위치에서 각도를 잰다 */
const VISTA_EYE = 1.6

/**
 * 정상마다 기념사진 배경에 꼭 넣을 대표 풍경 (정상 이름 → 바라볼 봉우리 위경도).
 * 실제 인증 사진처럼 영봉·백운대에서는 인수봉을, 도봉산 신선대에서는 멀리 북한산 백운대를 등지고 찍는다.
 * 그쪽이 가까운 지형에 막히면(VIEW_BLOCKED 보다 높이 가리면) 가장 트인 방향을 쓴다
 */
const VIEW_TARGETS: Record<string, { name: string; lat: number; lon: number }> = {
  영봉: { name: '인수봉', lat: 37.6602237, lon: 126.9801803 },
  백운대: { name: '인수봉', lat: 37.6602237, lon: 126.9801803 },
  신선대: { name: '북한산 백운대', lat: 37.6586301, lon: 126.9780032 },
}
/** 대표 풍경 쪽을 가까운 지형이 이 각도(라디안)보다 높이 가리면 쓰지 않는다. 사진에 비탈만 찍히지 않게 */
const VIEW_BLOCKED = THREE.MathUtils.degToRad(12)
/** 위경도 → 장면 좌표에 쓰는 지구 반지름(m). scripts/prepare-data.mjs 와 같다 */
const EARTH_R = 6378137

/** 위경도를 이 산 지형의 장면 좌표(x 동쪽, z 남쪽)로 바꾼다 */
function toLocal(terrain: Terrain, lat: number, lon: number) {
  const { origin } = terrain
  const cosLat = Math.cos((origin.lat * Math.PI) / 180)
  return { x: (((lon - origin.lon) * Math.PI) / 180) * EARTH_R * cosLat, z: -(((lat - origin.lat) * Math.PI) / 180) * EARTH_R }
}

/** 정상에서 dir 쪽을 볼 때 가까운 곳부터 먼 곳까지 지형이 눈높이를 가리는 가장 큰 각도 */
function horizonAngle(terrain: Terrain, top: THREE.Vector3, dir: THREE.Vector3) {
  const eye = top.y + VISTA_EYE
  let horizon = -Infinity
  for (const r of VISTA_RANGES) horizon = Math.max(horizon, Math.atan2(sampleHeight(terrain, top.x + dir.x * r, top.z + dir.z * r) - eye, r))
  return horizon
}

const vistaCache = new WeakMap<Trail, THREE.Vector3>()

/**
 * 기념사진 배경으로 쓸 방향(수평 단위 벡터). 정상에 대표 풍경(VIEW_TARGETS)이 있으면 그쪽, 없으면 가장 트인 쪽이다.
 * 카메라는 이 반대쪽에 서고, 깃발은 이쪽(아바타 뒤 배경)에 선다.
 * 방향마다 가까운 곳부터 먼 곳까지 지형이 눈높이를 가리는 가장 큰 각도를 재고, 그 각도가 가장 낮은 방향을 고른다.
 * 30m 밖만 재면 관악산 연주대처럼 정상 바로 옆에 솟은 바위가 사진을 가린다
 */
export function summitVista(terrain: Terrain, trail: Trail) {
  const hit = vistaCache.get(trail)
  if (hit) return hit.clone()
  const top = trail.positionAt(trail.length)
  let best = new THREE.Vector3(1, 0, 0)
  let lowest = Infinity
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2
    const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a))
    const horizon = horizonAngle(terrain, top, dir)
    if (horizon < lowest) {
      lowest = horizon
      best = dir
    }
  }
  const target = VIEW_TARGETS[trail.data.summit]
  if (target) {
    const p = toLocal(terrain, target.lat, target.lon)
    const dir = new THREE.Vector3(p.x - top.x, 0, p.z - top.z)
    // 대표 풍경까지 너무 가까우면(정상 그 자체) 방향을 정할 수 없다
    if (dir.length() > 30) {
      dir.normalize()
      if (horizonAngle(terrain, top, dir) < VIEW_BLOCKED) best = dir
    }
  }
  vistaCache.set(trail, best)
  return best.clone()
}

/** 점 p 에서 선분 ab 까지의 수평 거리(m) */
export function distanceToSegmentXZ(px: number, pz: number, a: THREE.Vector3, b: THREE.Vector3) {
  const abx = b.x - a.x
  const abz = b.z - a.z
  const t = THREE.MathUtils.clamp(((px - a.x) * abx + (pz - a.z) * abz) / Math.max(abx * abx + abz * abz, 1e-6), 0, 1)
  return Math.hypot(px - (a.x + abx * t), pz - (a.z + abz * t))
}
