import { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { loadData, type Terrain, type Trail } from './lib/data'
import { World } from './scene/World'
import { MAPBOX_TOKEN } from './lib/satellite'
import { AvatarThumbnails } from './ui/AvatarThumbnails'
import { Hud, SummitModal } from './ui/Hud'

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
      <Canvas
        shadows
        camera={{ fov: 55, near: 0.5, far: 20000 }}
        // 기념사진 캡처를 위해 그린 화면을 유지
        gl={{ preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping }}
        dpr={[1, 2]}
      >
        <World terrain={data.terrain} trail={data.trail} />
      </Canvas>
      <Hud trail={data.trail} />
      <AvatarThumbnails />
      <SummitModal trail={data.trail} />
      <div className="attribution">
        지도 © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · 지형 국토지리정보원 수치지형도, AWS Terrain Tiles
        {MAPBOX_TOKEN && (
          <>
            {' · 위성사진 © '}
            <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="https://www.maxar.com/">Maxar</a>
          </>
        )}
      </div>
    </>
  )
}
