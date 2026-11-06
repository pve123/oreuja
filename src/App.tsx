import { useEffect, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { loadData, type Terrain, type Trail } from './lib/data'
import { DEFAULT_MOUNTAIN, loadMountain, loadMountains, type Mountain } from './lib/mountains'
import { useGame } from './lib/store'
import { World } from './scene/World'
import { MAPBOX_TOKEN } from './lib/satellite'
import { AvatarThumbnails } from './ui/AvatarThumbnails'
import { Hud, SummitModal } from './ui/Hud'
import { Lobby } from './ui/Lobby'
import { SoundControls } from './ui/SoundControls'
import { startNet } from './lib/net'
import { failSplash, hideSplash, setSplash } from './lib/splash'

/** 첫 화면 진행 막대 몫: 지형 데이터 0.05~0.6, 3D 모델·텍스처 0.6~0.92, 장면 준비 나머지 */
const DATA_END = 0.6
const ASSETS_END = 0.92
/** 장면 준비 신호가 끝내 오지 않아도 이 시간(ms)이 지나면 첫 화면을 걷는다 */
const SPLASH_TIMEOUT = 25000

export default function App() {
  const [data, setData] = useState<{ terrain: Terrain; trails: Trail[]; mountains: Mountain[]; mountain: Mountain } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const courseId = useGame((s) => s.courseId)

  // 같이하기 서버에 붙는다. 서버가 없으면 혼자 오르기로 동작한다
  useEffect(() => startNet(), [])

  useEffect(() => {
    // 개발 중에는 ?mountain=dobongsan&course=dobongsan-uiam 처럼 산과 코스를 골라 시작할 수 있다
    const params = import.meta.env.DEV ? new URLSearchParams(location.search) : null
    const debugCourse = params?.get('course')
    const debugMountain = params?.get('mountain')
    const saved = debugMountain ? { ...DEFAULT_MOUNTAIN, id: debugMountain, name: debugMountain } : loadMountain()
    setSplash('지형을 펼치는 중', 0.05)
    const load = (m: Mountain) =>
      Promise.all([loadMountains(), loadData(m.id, (p) => setSplash('지형을 펼치는 중', 0.05 + p * (DATA_END - 0.05)))]).then(
        ([mountains, d]) => ({ ...d, mountains, mountain: mountains.find((x) => x.id === m.id) ?? m }),
      )
    // 기억해 둔 산이 없어졌으면(데이터를 받지 못하면) 기본 산으로 연다
    load(saved)
      .catch((e) => (saved.id === DEFAULT_MOUNTAIN.id ? Promise.reject(e) : load(DEFAULT_MOUNTAIN)))
      .then((d) => {
        // 개발용 코스 지정이면 베이스캠프를 건너뛰고 바로 걷는다
        if (debugCourse && d.trails.some((t) => t.data.id === debugCourse)) useGame.setState({ courseId: debugCourse, mode: 'hiking' })
        setSplash('숲과 길을 그리는 중', DATA_END)
        setData(d)
      })
      .catch((e) => {
        console.error(e)
        setError(String(e))
      })
  }, [])

  // 실패하면 첫 화면에 안내와 다시 시도 버튼을 띄운다 (원문 오류는 콘솔에만)
  useEffect(() => {
    if (error) failSplash('산길을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요')
  }, [error])

  // 첫 화면(스플래시)은 데이터를 받는 동안 index.html 의 것이 그대로 보인다
  if (!data) return null
  const trail = data.trails.find((t) => t.data.id === courseId) ?? data.trails[0]

  return (
    <>
      <Canvas
        shadows
        camera={{ fov: 55, near: 0.5, far: 20000 }}
        // 기념사진 캡처를 위해 그린 화면을 유지. 톤 매핑은 후처리 맨 끝에서 한다 (scene/World 의 PostEffects)
        gl={{ preserveDrawingBuffer: true, toneMapping: THREE.NoToneMapping }}
        dpr={[1, 2]}
      >
        <World terrain={data.terrain} trail={trail} />
      </Canvas>
      <SplashProgress />
      <Hud trail={trail} trails={data.trails} />
      <Lobby trail={trail} trails={data.trails} mountains={data.mountains} mountain={data.mountain} />
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

/** 3D 모델·텍스처를 받는 정도를 첫 화면 진행 막대에 이어 보여 주고, 장면이 그려지면 첫 화면을 걷는다 */
function SplashProgress() {
  const { active, progress } = useProgress()
  const ready = useGame((s) => s.sceneReady)

  useEffect(() => {
    // 모델 받기가 시작되기 전에도 active 가 잠깐 false 라, 다 받았을 때(100%)만 다음 단계 문구로 넘긴다
    const assetsDone = !active && progress >= 100
    if (!ready) setSplash(assetsDone ? '출발 준비 중' : '숲과 길을 그리는 중', DATA_END + (progress / 100) * (ASSETS_END - DATA_END))
  }, [active, progress, ready])

  useEffect(() => {
    if (ready && !active) hideSplash()
  }, [ready, active])

  useEffect(() => {
    const t = setTimeout(hideSplash, SPLASH_TIMEOUT)
    return () => clearTimeout(t)
  }, [])
  return null
}
