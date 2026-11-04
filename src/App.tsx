import { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { loadData, type Terrain, type Trail } from './lib/data'
import { World } from './scene/World'

export default function App() {
  const [data, setData] = useState<{ terrain: Terrain; trail: Trail } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadData()
      .then(setData)
      .catch((e) => setError(String(e)))
  }, [])

  if (error) return <div className="loading">데이터를 불러오지 못했어요: {error}</div>
  if (!data) return <div className="loading">북한산을 불러오는 중…</div>

  return (
    <>
      <Canvas shadows camera={{ fov: 55, near: 0.5, far: 20000 }} gl={{ toneMapping: THREE.ACESFilmicToneMapping }} dpr={[1, 2]}>
        <World terrain={data.terrain} trail={data.trail} />
      </Canvas>
      <div className="attribution">
        지도 © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · 지형 AWS Terrain Tiles
      </div>
    </>
  )
}
