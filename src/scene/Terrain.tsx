import { useEffect, useMemo, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Terrain as TerrainData } from '../lib/data'
import { MAPBOX_TOKEN, loadSatelliteTexture } from '../lib/satellite'

const GRASS_LOW = new THREE.Color('#5d7f3a')
const FOREST = new THREE.Color('#3f6b2e')
const HIGH = new THREE.Color('#7a7d5a')
const ROCK = new THREE.Color('#9a958c')

export function Terrain({ terrain }: { terrain: TerrainData }) {
  const gl = useThree((s) => s.gl)
  // Mapbox 토큰이 있으면 위성사진을 입히고, 없거나 실패하면 고도·경사 색을 쓴다
  const [satellite, setSatellite] = useState<THREE.Texture | null>(null)

  useEffect(() => {
    if (!MAPBOX_TOKEN) return
    let cancelled = false
    let loaded: THREE.Texture | null = null
    loadSatelliteTexture(terrain, MAPBOX_TOKEN)
      .then((texture) => {
        loaded = texture
        // 비스듬히 볼 때 사진이 뭉개지지 않게
        texture.anisotropy = gl.capabilities.getMaxAnisotropy()
        if (cancelled) texture.dispose()
        else setSatellite(texture)
      })
      .catch((e) => console.warn('위성사진 없이 그립니다.', e))
    return () => {
      cancelled = true
      loaded?.dispose()
    }
  }, [terrain, gl])

  const geometry = useMemo(() => {
    const { width, height, heights, minX, maxX, minZ, maxZ, minHeight, maxHeight } = terrain
    const geo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, width - 1, height - 1)
    geo.rotateX(-Math.PI / 2) // 0번 행이 북쪽(-z)이 되도록 눕힘
    geo.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2)

    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) pos.setY(i, heights[i])
    geo.computeVertexNormals()

    // 고도와 경사로 색칠: 가파르면 바위, 높을수록 덜 푸르게
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

  return (
    <mesh geometry={geometry} receiveShadow>
      {satellite ? (
        <meshStandardMaterial key="satellite" map={satellite} roughness={1} />
      ) : (
        <meshStandardMaterial key="colors" vertexColors roughness={0.95} />
      )}
    </mesh>
  )
}
