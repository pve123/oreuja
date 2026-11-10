import * as THREE from 'three'

const TILE = 256 // 타일 한 장 크기(px)
const R = 6378137
/** 그래픽 카드가 무리 없이 다루는 텍스처 한 변 최대 크기(px) */
const MAX_TEXTURE = 4096

/**
 * 브이월드(국토교통부 공간정보 오픈플랫폼) 인증키. 브라우저에 들어가는 공개 키이고, 브이월드에 등록한 주소에서만 통한다.
 * 비우면 위성사진 없이 고도·경사 색으로 지형을 그린다
 */
export const VWORLD_KEY: string | undefined = import.meta.env.VITE_VWORLD_KEY || undefined

/** 받은 타일 중 이만큼 넘게 실패하면 사진을 쓰지 않는다 (빈 칸이 많으면 사진 없이 칠한 색이 낫다) */
const MAX_FAILED = 0.2

/** 로컬 좌표(m) 사각형. x 동쪽, z 남쪽 */
export type LocalRect = { minX: number; maxX: number; minZ: number; maxZ: number }

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // WebGL 텍스처로 쓰려면 CORS 허용 이미지여야 한다
    img.onload = () => resolve(img)
    // 인증키가 틀리거나 등록하지 않은 주소면 브이월드는 그림 대신 오류 XML 을 돌려줘서 여기로 온다
    img.onerror = () => reject(new Error(`위성 타일을 받지 못했어요: ${url.replace(/1\.0\.0\/[^/]+\//, '1.0.0/***/')}`))
    img.src = url
  })
}

/**
 * 로컬 사각형 범위만큼 브이월드 영상지도(항공사진) 타일을 받아 한 장으로 이어 붙인 텍스처를 만든다.
 * 화면을 열 때마다 받아 이어 붙이기만 하고 따로 저장하지 않는다.
 * 지형 높이 지도와 같은 웹 메르카토르 격자라서 잘라 붙이기만 하면 위치가 맞는다.
 * 결과 사진이 MAX_TEXTURE 를 넘으면 확대 단계를 한 단계씩 낮춘다.
 *
 * @param zoom 원하는 확대 단계(256px 타일 기준). 16이면 1px ≈ 1.9m, 18이면 1px ≈ 0.5m
 */
export async function loadSatelliteTexture(rect: LocalRect, origin: { lat: number; lon: number }, key: string, zoom: number) {
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
  let failed = 0
  let lastError: unknown
  for (let tx = Math.floor(p.px0 / TILE); tx <= Math.floor(p.px1 / TILE); tx++) {
    for (let ty = Math.floor(p.py0 / TILE); ty <= Math.floor(p.py1 / TILE); ty++) {
      // WMTS 주소 순서는 확대 단계/행(y)/열(x). Satellite 는 항공사진 레이어다
      const url = `https://api.vworld.kr/req/wmts/1.0.0/${key}/Satellite/${z}/${ty}/${tx}.jpeg`
      jobs.push(
        loadImage(url)
          .then((img) => ctx.drawImage(img, tx * TILE - p.px0, ty * TILE - p.py0, TILE, TILE))
          // 바다·국경 밖처럼 사진이 없는 칸도 있어서 한 장 실패로 전체를 버리지 않는다
          .catch((e) => {
            failed++
            lastError = e
          }),
      )
    }
  }
  await Promise.all(jobs)
  if (failed > jobs.length * MAX_FAILED) throw lastError

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
