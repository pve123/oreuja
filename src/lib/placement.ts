import { useMemo } from 'react'
import * as THREE from 'three'
import type { Terrain, Trail } from './data'
import { usePhotos, type PhotoLayer } from './photo-map'

/** 등산로 점을 나눠 담는 격자 한 칸 크기(m). 가까운 칸만 뒤지면 되어 빠르다 */
const TRAIL_CELL = 20

/** 등산로에서 r 미터 안인지 빠르게 판정하는 함수를 만든다 */
export function makeNearTrail(trail: Trail) {
  const grid = new Map<string, THREE.Vector3[]>()
  for (const p of trail.points) {
    const key = `${Math.floor(p.x / TRAIL_CELL)},${Math.floor(p.z / TRAIL_CELL)}`
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key)!.push(p)
  }
  return (x: number, z: number, r: number) => {
    const cellX = Math.floor(x / TRAIL_CELL)
    const cellZ = Math.floor(z / TRAIL_CELL)
    const reach = Math.ceil(r / TRAIL_CELL)
    for (let dx = -reach; dx <= reach; dx++)
      for (let dz = -reach; dz <= reach; dz++)
        for (const p of grid.get(`${cellX + dx},${cellZ + dz}`) ?? []) if ((p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return true
    return false
  }
}

/** 숲·바위를 놓을 후보 자리. share 비율만큼은 등산로 점 둘레 range 미터 안에서(걸으며 보이게), 나머지는 지형 전체에서 고른다 */
export function scatterPoint(rand: () => number, trail: Trail, terrain: Terrain, share: number, range: number) {
  if (rand() < share) {
    const p = trail.points[Math.floor(rand() * trail.points.length)]
    return { x: p.x + (rand() * 2 - 1) * range, z: p.z + (rand() * 2 - 1) * range }
  }
  return { x: THREE.MathUtils.lerp(terrain.minX, terrain.maxX, rand()), z: THREE.MathUtils.lerp(terrain.minZ, terrain.maxZ, rand()) }
}

/**
 * 숲·바위 배치에 쓸 위성사진.
 * settled 가 false 면 아직 받는 중이라 배치를 미룬다 (받은 뒤 자리가 바뀌어 튀지 않게).
 * layers 가 비어 있으면 사진 없이(고도·경사로) 배치한다.
 */
export function usePhotoLayers(): { settled: boolean; layers: PhotoLayer[] } {
  const base = usePhotos((s) => s.base)
  const detail = usePhotos((s) => s.detail)
  const baseStatus = usePhotos((s) => s.baseStatus)
  const detailStatus = usePhotos((s) => s.detailStatus)
  const settled = baseStatus !== 'loading' && detailStatus !== 'loading'
  // 사진이 바뀔 때만 새 배열을 만들어, 배치 계산이 렌더링마다 다시 돌지 않게 한다
  const layers = useMemo(() => [detail, base].filter((l): l is PhotoLayer => l !== null), [detail, base])
  return { settled, layers }
}
