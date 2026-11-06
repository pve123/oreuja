import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Terrain as TerrainData, Trail } from '../lib/data'
import { MAPBOX_TOKEN, loadSatelliteTexture, type LocalRect } from '../lib/satellite'
import { layerFromCanvas, usePhotos } from '../lib/photo-map'
import { daylight } from '../lib/daylight'

const GRASS_LOW = new THREE.Color('#5d7f3a')
const FOREST = new THREE.Color('#3f6b2e')
const HIGH = new THREE.Color('#7a7d5a')
const ROCK = new THREE.Color('#9a958c')

/** 지형 전체 위성사진 확대 단계 (1px ≈ 1.9m) */
const BASE_ZOOM = 15
/** 등산로 주변 선명한 위성사진 확대 단계 (1px ≈ 0.5m) */
const DETAIL_ZOOM = 17
/** 등산로에서 이만큼까지 선명한 사진을 덮는다(m) */
const DETAIL_MARGIN = 200

type Props = { terrain: TerrainData; trail: Trail }

/**
 * 위성사진에는 이미 해와 나무 그림자가 찍혀 있어서 조명을 그대로 받으면 숲이 검게 뭉개진다.
 * 사진 색의 일부를 발광색으로도 써서 조명이 어두운 곳에서도 사진 무늬가 보이게 한다.
 * 발광 세기는 시간대에 따라 바뀐다 (새벽에는 낮춰 사진이 스스로 빛나지 않게. src/lib/daylight.ts)
 */
const PHOTO_LIGHTING = {
  roughness: 1,
  color: new THREE.Color(0.8, 0.8, 0.8),
  emissive: new THREE.Color(1, 1, 1),
  emissiveIntensity: 0.45,
}

/**
 * 범위만큼 위성사진을 받아 텍스처로 돌려준다. 토큰이 없거나 실패하면 null.
 * 받은 사진의 픽셀은 숲·바위 배치에 쓰도록 usePhotos 에도 올린다.
 */
function useSatellite(rect: LocalRect | null, origin: TerrainData['origin'], zoom: number, key: 'base' | 'detail') {
  const gl = useThree((s) => s.gl)
  const [texture, setTexture] = useState<THREE.Texture | null>(null)

  useEffect(() => {
    const { setLayer } = usePhotos.getState()
    if (!MAPBOX_TOKEN || !rect) {
      setLayer(key, 'none')
      return
    }
    setLayer(key, 'loading')
    let cancelled = false
    let loaded: THREE.Texture | null = null
    loadSatelliteTexture(rect, origin, MAPBOX_TOKEN, zoom)
      .then((t) => {
        loaded = t
        if (!cancelled) setLayer(key, 'ready', layerFromCanvas(t.image as HTMLCanvasElement, rect))
        if (import.meta.env.DEV) {
          const img = t.image as HTMLCanvasElement
          console.info(`위성사진 확대 ${zoom}: ${img.width}x${img.height}px`)
        }
        // 비스듬히 볼 때 사진이 뭉개지지 않게
        t.anisotropy = gl.capabilities.getMaxAnisotropy()
        if (cancelled) t.dispose()
        else setTexture(t)
      })
      .catch((e) => {
        console.warn(`위성사진(확대 ${zoom}) 없이 그립니다.`, e)
        if (!cancelled) setLayer(key, 'failed')
      })
    return () => {
      cancelled = true
      loaded?.dispose()
    }
  }, [rect, origin, zoom, gl, key])

  return texture
}

export function Terrain({ terrain, trail }: Props) {
  const geometry = useMemo(() => {
    const { width, height, heights, minX, maxX, minZ, maxZ, minHeight, maxHeight } = terrain
    const geo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, width - 1, height - 1)
    geo.rotateX(-Math.PI / 2) // 0번 행이 북쪽(-z)이 되도록 눕힘
    geo.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2)

    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) pos.setY(i, heights[i])
    geo.computeVertexNormals()

    // 고도와 경사로 색칠: 가파르면 바위, 높을수록 덜 푸르게 (위성사진이 없을 때 쓴다)
    const normals = geo.attributes.normal as THREE.BufferAttribute
    const colors = new Float32Array(pos.count * 3)
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const h = (heights[i] - minHeight) / (maxHeight - minHeight)
      c.copy(GRASS_LOW).lerp(FOREST, Math.min(1, h * 2))
      if (h > 0.55) c.lerp(HIGH, (h - 0.55) / 0.45)
      const steep = THREE.MathUtils.smoothstep(1 - normals.getY(i), 0.25, 0.45)
      c.lerp(ROCK, steep)
      colors.set([c.r, c.g, c.b], i * 3)
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return geo
  }, [terrain])

  // 등산로 주변만 따로 떼어 낸 지형 조각. 꼭짓점과 법선을 전체 지형에서 그대로 가져와 모양과 빛이 똑같다
  const detail = useMemo(() => {
    const { width, height, minX, maxX, minZ, maxZ } = terrain
    const cellX = (maxX - minX) / (width - 1)
    const cellZ = (maxZ - minZ) / (height - 1)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const p of trail.points) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x)
      z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z)
    }
    const i0 = THREE.MathUtils.clamp(Math.floor((x0 - DETAIL_MARGIN - minX) / cellX), 0, width - 2)
    const i1 = THREE.MathUtils.clamp(Math.ceil((x1 + DETAIL_MARGIN - minX) / cellX), i0 + 1, width - 1)
    const j0 = THREE.MathUtils.clamp(Math.floor((z0 - DETAIL_MARGIN - minZ) / cellZ), 0, height - 2)
    const j1 = THREE.MathUtils.clamp(Math.ceil((z1 + DETAIL_MARGIN - minZ) / cellZ), j0 + 1, height - 1)
    const rect: LocalRect = { minX: minX + i0 * cellX, maxX: minX + i1 * cellX, minZ: minZ + j0 * cellZ, maxZ: minZ + j1 * cellZ }

    const w = i1 - i0 + 1
    const h = j1 - j0 + 1
    const srcPos = geometry.attributes.position as THREE.BufferAttribute
    const srcNor = geometry.attributes.normal as THREE.BufferAttribute
    const positions = new Float32Array(w * h * 3)
    const normals = new Float32Array(w * h * 3)
    const uvs = new Float32Array(w * h * 2)
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const src = (j0 + j) * width + (i0 + i)
        const dst = j * w + i
        positions.set([srcPos.getX(src), srcPos.getY(src), srcPos.getZ(src)], dst * 3)
        normals.set([srcNor.getX(src), srcNor.getY(src), srcNor.getZ(src)], dst * 3)
        uvs.set([i / (w - 1), 1 - j / (h - 1)], dst * 2) // 사진 위쪽이 북쪽
      }
    }
    // PlaneGeometry 와 같은 대각선으로 삼각형을 나눠야 전체 지형과 정확히 겹친다
    const index: number[] = []
    for (let j = 0; j < h - 1; j++) {
      for (let i = 0; i < w - 1; i++) {
        const a = j * w + i
        const b = (j + 1) * w + i
        const c = (j + 1) * w + i + 1
        const d = j * w + i + 1
        index.push(a, b, d, b, c, d)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geo.setIndex(index)
    return { geo, rect }
  }, [terrain, trail, geometry])

  const wholeRect = useMemo<LocalRect>(
    () => ({ minX: terrain.minX, maxX: terrain.maxX, minZ: terrain.minZ, maxZ: terrain.maxZ }),
    [terrain],
  )
  const baseSatellite = useSatellite(wholeRect, terrain.origin, BASE_ZOOM, 'base')
  const detailSatellite = useSatellite(detail.rect, terrain.origin, DETAIL_ZOOM, 'detail')

  // 위성사진 재질의 발광 세기를 시간대에 맞춘다
  const group = useRef<THREE.Group>(null!)
  useFrame(() => {
    for (const child of group.current.children) {
      const m = (child as THREE.Mesh).material as THREE.MeshStandardMaterial
      if (m.emissiveMap) m.emissiveIntensity = daylight.photoEmissive
    }
  })

  return (
    <group ref={group}>
      <mesh geometry={geometry} receiveShadow>
        {baseSatellite ? (
          <meshStandardMaterial key="satellite" map={baseSatellite} {...PHOTO_LIGHTING} emissiveMap={baseSatellite} />
        ) : (
          <meshStandardMaterial key="colors" vertexColors roughness={0.95} />
        )}
      </mesh>
      {detailSatellite && (
        <mesh geometry={detail.geo} receiveShadow>
          {/* 같은 자리의 전체 지형보다 앞에 그려지게 살짝 당긴다 (흙길은 -2 라 이보다 위) */}
          <meshStandardMaterial
            map={detailSatellite}
            {...PHOTO_LIGHTING}
            emissiveMap={detailSatellite}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      )}
    </group>
  )
}
