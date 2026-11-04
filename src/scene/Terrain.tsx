import { useMemo } from 'react'
import * as THREE from 'three'
import type { Terrain as TerrainData } from '../lib/data'

const GRASS_LOW = new THREE.Color('#5d7f3a')
const FOREST = new THREE.Color('#3f6b2e')
const HIGH = new THREE.Color('#7a7d5a')
const ROCK = new THREE.Color('#9a958c')

export function Terrain({ terrain }: { terrain: TerrainData }) {
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
      <meshStandardMaterial vertexColors roughness={0.95} />
    </mesh>
  )
}
