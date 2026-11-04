import * as THREE from 'three'
import type { TerrainMeta } from './data'

/** 위성사진 확대 단계. 15면 지형 4km 범위가 약 2200px 사진 한 장이 된다 */
const ZOOM = 15
const TILE = 512 // 타일 한 장 크기(px)
const R = 6378137

export const MAPBOX_TOKEN: string | undefined = import.meta.env.VITE_MAPBOX_TOKEN || undefined

const lon2px = (lon: number) => ((lon + 180) / 360) * 2 ** ZOOM * TILE
const lat2px = (lat: number) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** ZOOM * TILE
}

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
 * 지형 범위만큼 Mapbox 위성 타일을 받아 한 장으로 이어 붙인 텍스처를 만든다.
 * 지형 높이 지도와 같은 웹 메르카토르 격자라서 잘라 붙이기만 하면 위치가 맞는다.
 */
export async function loadSatelliteTexture(terrain: TerrainMeta, token: string) {
  const { origin } = terrain
  const cosLat = Math.cos((origin.lat * Math.PI) / 180)
  // 로컬 좌표(x 동쪽, z 남쪽, m) → 위경도
  const lonOf = (x: number) => origin.lon + ((x / (R * cosLat)) * 180) / Math.PI
  const latOf = (z: number) => origin.lat - ((z / R) * 180) / Math.PI

  const px0 = lon2px(lonOf(terrain.minX))
  const px1 = lon2px(lonOf(terrain.maxX))
  const py0 = lat2px(latOf(terrain.minZ))
  const py1 = lat2px(latOf(terrain.maxZ))

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(px1 - px0)
  canvas.height = Math.round(py1 - py0)
  const ctx = canvas.getContext('2d')!

  const jobs: Promise<void>[] = []
  for (let tx = Math.floor(px0 / TILE); tx <= Math.floor(px1 / TILE); tx++) {
    for (let ty = Math.floor(py0 / TILE); ty <= Math.floor(py1 / TILE); ty++) {
      // Static Tiles API 의 위성 스타일. 새 계정에서는 v4 Raster Tiles API 가 막혀 있어(429) 이쪽을 쓴다
      const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/${TILE}/${ZOOM}/${tx}/${ty}?access_token=${token}`
      jobs.push(loadImage(url).then((img) => ctx.drawImage(img, tx * TILE - px0, ty * TILE - py0, TILE, TILE)))
    }
  }
  await Promise.all(jobs)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
