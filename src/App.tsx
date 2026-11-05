import { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { loadData, type Terrain, type Trail } from './lib/data'
import { useGame } from './lib/store'
import { World } from './scene/World'
import { MAPBOX_TOKEN } from './lib/satellite'
import { AvatarThumbnails } from './ui/AvatarThumbnails'
import { Hud, SummitModal } from './ui/Hud'
import { SoundControls } from './ui/SoundControls'
import { startNet } from './lib/net'

export default function App() {
  const [data, setData] = useState<{ terrain: Terrain; trails: Trail[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const courseId = useGame((s) => s.courseId)

  // 같이하기 서버에 붙는다. 서버가 없으면 혼자 오르기로 동작한다
  useEffect(() => startNet(), [])

  useEffect(() => {
    // 개발 중에는 ?course=bukhansan-sanseong 처럼 코스를 골라 시작할 수 있다
    const debugCourse = import.meta.env.DEV ? new URLSearchParams(location.search).get('course') : null
    loadData()
      .then((d) => {
        if (debugCourse && d.trails.some((t) => t.data.id === debugCourse)) useGame.setState({ courseId: debugCourse })
        setData(d)
      })
      .catch((e) => setError(String(e)))
  }, [])

  if (error) return <div className="loading">데이터를 불러오지 못했어요: {error}</div>
  if (!data) return <div className="loading">북한산을 불러오는 중…</div>
  const trail = data.trails.find((t) => t.data.id === courseId) ?? data.trails[0]

  return (
    <>
      <Canvas
        shadows
        camera={{ fov: 55, near: 0.5, far: 20000 }}
        // 기념사진 캡처를 위해 그린 화면을 유지
        gl={{ preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping }}
        dpr={[1, 2]}
      >
        <World terrain={data.terrain} trail={trail} />
      </Canvas>
      <Hud trail={trail} trails={data.trails} />
      <AvatarThumbnails />
      <SoundControls />
      <SummitModal trail={trail} />
      <div className="attribution">
        지도 © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · 지형 국토지리정보원 수치지형도, AWS Terrain Tiles · 나무{' '}
        <a href="https://quaternius.com">Quaternius</a>
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
