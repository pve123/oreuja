import { create } from 'zustand'
import { MAPBOX_TOKEN, type LocalRect } from './satellite'

/** 위성사진 한 장의 픽셀. 숲·바위를 어디에 둘지와 무슨 색으로 칠할지 정하는 데 쓴다 */
export type PhotoLayer = { rect: LocalRect; width: number; height: number; data: Uint8ClampedArray }

/** 'none' 토큰 없음, 'loading' 받는 중, 'ready' 받음, 'failed' 실패 */
export type PhotoStatus = 'none' | 'loading' | 'ready' | 'failed'

type State = {
  base: PhotoLayer | null
  detail: PhotoLayer | null
  baseStatus: PhotoStatus
  detailStatus: PhotoStatus
  setLayer: (key: 'base' | 'detail', status: PhotoStatus, layer?: PhotoLayer) => void
}

export const usePhotos = create<State>((set) => ({
  base: null,
  detail: null,
  // 토큰이 있으면 처음부터 받는 중으로 둬서, 숲·바위가 사진 없이 한 번 놓였다가 다시 놓이며 튀지 않게 한다
  baseStatus: MAPBOX_TOKEN ? 'loading' : 'none',
  detailStatus: MAPBOX_TOKEN ? 'loading' : 'none',
  setLayer: (key, status, layer) =>
    set(key === 'base' ? { baseStatus: status, base: layer ?? null } : { detailStatus: status, detail: layer ?? null }),
}))

/** 캔버스에 그린 위성사진에서 픽셀을 꺼낸다 */
export function layerFromCanvas(canvas: HTMLCanvasElement, rect: LocalRect): PhotoLayer {
  const ctx = canvas.getContext('2d')!
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { rect, width: canvas.width, height: canvas.height, data }
}

/** 둘레 몇 픽셀을 평균 낸 색. 선명한 사진이 덮는 곳이면 그쪽을 쓴다 */
export function samplePhoto(layers: (PhotoLayer | null)[], x: number, z: number): [number, number, number] | null {
  for (const layer of layers) {
    if (!layer) continue
    const { rect, width, height, data } = layer
    if (x < rect.minX || x > rect.maxX || z < rect.minZ || z > rect.maxZ) continue
    const px = Math.round(((x - rect.minX) / (rect.maxX - rect.minX)) * (width - 1))
    const py = Math.round(((z - rect.minZ) / (rect.maxZ - rect.minZ)) * (height - 1))
    let r = 0, g = 0, b = 0, n = 0
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const qx = Math.min(width - 1, Math.max(0, px + dx))
        const qy = Math.min(height - 1, Math.max(0, py + dy))
        const k = (qy * width + qx) * 4
        r += data[k]; g += data[k + 1]; b += data[k + 2]; n++
      }
    return [r / n, g / n, b / n]
  }
  return null
}

export type Ground = 'forest' | 'rock' | 'other'

/**
 * 사진 색으로 땅의 종류를 가른다.
 * - 숲: 초록이 빨강·파랑보다 뚜렷하게 강하다 (초과 녹색 지수 2G-R-B)
 * - 바위: 채도가 낮고 밝다 (북한산 화강암은 밝은 회색~누런 회색)
 * - 그 밖: 길, 주차장, 건물, 그림자 등
 */
export function classifyGround([r, g, b]: [number, number, number]): Ground {
  const excessGreen = 2 * g - r - b
  const spread = Math.max(r, g, b) - Math.min(r, g, b)
  const light = (r + g + b) / 3
  if (excessGreen > 14 && light < 150) return 'forest'
  if (spread < 32 && light > 105) return 'rock'
  return 'other'
}
