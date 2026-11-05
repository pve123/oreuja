import type { Terrain, Trail } from './data'
import { pushUp } from './steps'

/** 등산로 둘레 이 거리 안의 지형만 충돌체로 만든다(m). 길 밖으로 20m 까지, 카메라는 그보다 15m 더 나갈 수 있다 */
export const CORRIDOR = 40

/**
 * 등산로 둘레 지형을 화면 지형과 같은 삼각형으로 나눈 trimesh.
 * 지형 메시(PlaneGeometry)와 meshHeight 가 쓰는 대각선 (i,j+1)-(i+1,j) 를 그대로 따라 높이 기준이 하나가 된다.
 */
export function corridorMesh(t: Terrain, trail: Trail) {
  const cellX = (t.maxX - t.minX) / (t.width - 1)
  const cellZ = (t.maxZ - t.minZ) / (t.height - 1)
  const used = new Uint8Array((t.width - 1) * (t.height - 1))
  // 등산로를 따라 5m 마다 둘레 칸에 표시한다
  for (let d = 0; d <= trail.length; d += 5) {
    const p = trail.positionAt(d)
    const i0 = Math.max(0, Math.floor((p.x - CORRIDOR - t.minX) / cellX))
    const i1 = Math.min(t.width - 2, Math.floor((p.x + CORRIDOR - t.minX) / cellX))
    const j0 = Math.max(0, Math.floor((p.z - CORRIDOR - t.minZ) / cellZ))
    const j1 = Math.min(t.height - 2, Math.floor((p.z + CORRIDOR - t.minZ) / cellZ))
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const cx = t.minX + (i + 0.5) * cellX
        const cz = t.minZ + (j + 0.5) * cellZ
        if ((cx - p.x) ** 2 + (cz - p.z) ** 2 < (CORRIDOR + cellX) ** 2) used[j * (t.width - 1) + i] = 1
      }
  }
  const vertices: number[] = []
  const indices: number[] = []
  const index = new Map<number, number>()
  const vertex = (i: number, j: number) => {
    const key = j * t.width + i
    let k = index.get(key)
    if (k === undefined) {
      k = vertices.length / 3
      vertices.push(t.minX + i * cellX, t.heights[key], t.minZ + j * cellZ)
      index.set(key, k)
    }
    return k
  }
  for (let j = 0; j < t.height - 1; j++)
    for (let i = 0; i < t.width - 1; i++) {
      if (!used[j * (t.width - 1) + i]) continue
      const a = vertex(i, j)
      const b = vertex(i + 1, j)
      const c = vertex(i, j + 1)
      const d = vertex(i + 1, j + 1)
      pushUp(vertices, indices, a, b, c)
      pushUp(vertices, indices, d, c, b)
    }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) }
}

