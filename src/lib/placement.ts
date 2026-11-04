import { useMemo } from 'react'
import type * as THREE from 'three'
import type { Trail } from './data'
import { usePhotos, type PhotoLayer } from './photo-map'

/** 등산로에서 r 미터 안인지 빠르게 판정하는 함수를 만든다 (20m 격자로 나눠 둔다) */
export function makeNearTrail(trail: Trail) {
  const cell = 20
  const grid = new Map<string, THREE.Vector3[]>()
  for (const p of trail.points) {
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key)!.push(p)
  }
  return (x: number, z: number, r: number) => {
    const cx = Math.floor(x / cell)
    const cz = Math.floor(z / cell)
    const reach = Math.ceil(r / cell)
    for (let a = -reach; a <= reach; a++)
      for (let b = -reach; b <= reach; b++)
        for (const p of grid.get(`${cx + a},${cz + b}`) ?? []) if ((p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return true
    return false
  }
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
