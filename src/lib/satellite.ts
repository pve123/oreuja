import * as THREE from 'three'

const TILE = 512 // 타일 한 장 크기(px)
const R = 6378137
/** 그래픽 카드가 무리 없이 다루는 텍스처 한 변 최대 크기(px) */
const MAX_TEXTURE = 4096

export const MAPBOX_TOKEN: string | undefined = import.meta.env.VITE_MAPBOX_TOKEN || undefined

/** 로컬 좌표(m) 사각형. x 동쪽, z 남쪽 */
export type LocalRect = { minX: number; maxX: number; minZ: number; maxZ: number }

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // WebGL 텍스처로 쓰려면 CORS 허용 이미지여야 한다
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`위성 타일을 받지 못했어요: ${url.replace(/access_token=[^&]+/, 'access_token=***')}`))
    img.src = url
  })
}

/**
 * 로컬 사각형 범위만큼 Mapbox 위성 타일을 받아 한 장으로 이어 붙인 텍스처를 만든다.
 * 지형 높이 지도와 같은 웹 메르카토르 격자라서 잘라 붙이기만 하면 위치가 맞는다.
 * 결과 사진이 MAX_TEXTURE 를 넘으면 확대 단계를 한 단계씩 낮춘다.
 *
 * @param zoom 원하는 확대 단계. 15면 1px ≈ 1.9m, 17이면 1px ≈ 0.5m
 */
export async function loadSatelliteTexture(rect: LocalRect, origin: { lat: number; lon: number }, token: string, zoom: number) {
  const cosLat = Math.cos((origin.lat * Math.PI) / 180)
  // 로컬 좌표 → 위경도
  const lonOf = (x: number) => origin.lon + ((x / (R * cosLat)) * 180) / Math.PI
  const latOf = (z: number) => origin.lat - ((z / R) * 180) / Math.PI

  let z = zoom
  const pixels = (zz: number) => {
    const world = 2 ** zz * TILE
    const lon2px = (lon: number) => ((lon + 180) / 360) * world
    const lat2px = (lat: number) => {
      const r = (lat * Math.PI) / 180
      return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * world
    }
    return {
      px0: lon2px(lonOf(rect.minX)),
      px1: lon2px(lonOf(rect.maxX)),
      py0: lat2px(latOf(rect.minZ)),
      py1: lat2px(latOf(rect.maxZ)),
    }
  }
  let p = pixels(z)
  while (Math.max(p.px1 - p.px0, p.py1 - p.py0) > MAX_TEXTURE && z > 10) p = pixels(--z)

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(p.px1 - p.px0)
  canvas.height = Math.round(p.py1 - p.py0)
  const ctx = canvas.getContext('2d')!

  const jobs: Promise<void>[] = []
  for (let tx = Math.floor(p.px0 / TILE); tx <= Math.floor(p.px1 / TILE); tx++) {
    for (let ty = Math.floor(p.py0 / TILE); ty <= Math.floor(p.py1 / TILE); ty++) {
      // Static Tiles API 의 위성 스타일. 새 계정에서는 v4 Raster Tiles API 가 막혀 있어(429) 이쪽을 쓴다
      const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/${TILE}/${z}/${tx}/${ty}?access_token=${token}`
      jobs.push(loadImage(url).then((img) => ctx.drawImage(img, tx * TILE - p.px0, ty * TILE - p.py0, TILE, TILE)))
    }
  }
  await Promise.all(jobs)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
