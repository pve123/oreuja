import * as THREE from 'three'
import { sampleHeight, type Terrain, type Trail } from './data'

/** 기념사진 카메라는 정상에서 풍경 반대쪽으로 이만큼 물러난다(m) */
export const PHOTO_CAMERA_BACK = 6

/**
 * 정상에서 가장 낮게 트인 방향(수평 단위 벡터). 기념사진 배경으로 쓸 풍경 쪽이다.
 * 카메라는 이 반대쪽에 서고, 깃발은 이쪽(아바타 뒤 배경)에 선다.
 */
export function summitVista(terrain: Terrain, trail: Trail) {
  const top = trail.positionAt(trail.length)
  let best = new THREE.Vector3(1, 0, 0)
  let lowest = Infinity
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2
    const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a))
    let sum = 0
    for (const r of [30, 60, 120]) sum += sampleHeight(terrain, top.x + dir.x * r, top.z + dir.z * r)
    if (sum < lowest) {
      lowest = sum
      best = dir
    }
  }
  return best
}

/** 점 p 에서 선분 ab 까지의 수평 거리(m) */
export function distanceToSegmentXZ(px: number, pz: number, a: THREE.Vector3, b: THREE.Vector3) {
  const abx = b.x - a.x
  const abz = b.z - a.z
  const t = THREE.MathUtils.clamp(((px - a.x) * abx + (pz - a.z) * abz) / Math.max(abx * abx + abz * abz, 1e-6), 0, 1)
  return Math.hypot(px - (a.x + abx * t), pz - (a.z + abz * t))
}
