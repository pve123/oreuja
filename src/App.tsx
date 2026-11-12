import { useEffect, useRef, useState } from 'react'
import { PerformanceMonitor, useProgress } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { loadData, type Terrain, type Trail } from './lib/data'
import { IS_TOUCH } from './lib/device'
import { DEFAULT_MOUNTAIN, loadMountain, loadMountains, type Mountain } from './lib/mountains'
import { startNet } from './lib/net'
import { VWORLD_KEY } from './lib/satellite'
import { failSplash, hideSplash, setSplash } from './lib/splash'
import { useGame } from './lib/store'
import { World } from './scene/World'
import { AvatarThumbnails } from './ui/AvatarThumbnails'
import { Hud, SummitModal } from './ui/Hud'
import { Lobby } from './ui/Lobby'
import { SoundControls } from './ui/SoundControls'

/** 첫 화면 진행 막대 몫: 지형 데이터 0.05~0.6, 3D 모델·텍스처 0.6~0.92, 장면 준비 나머지 */
const DATA_START = 0.05
const DATA_END = 0.6
const ASSETS_END = 0.92
/** 장면 준비 신호가 끝내 오지 않아도 이 시간(ms)이 지나면 첫 화면을 걷는다 */
const SPLASH_TIMEOUT = 25000
/**
 * 화소 배율 범위 [가장 낮게, 가장 높게]. 폰은 화소가 촘촘해서(3배까지) 그대로 그리면 GPU 가 벅차 1.5배까지만 그린다.
 * PerformanceMonitor 가 프레임이 떨어지면 낮추고 여유가 생기면 올린다. 저사양 폰은 0.75배까지 내려 끊김을 줄인다
 */
const DPR_RANGE: [number, number] = IS_TOUCH ? [0.75, 1.5] : [1, 2]
/** 배율을 이 단위로 반올림한다. 조금씩 자주 바뀌면 그때마다 화면 버퍼를 새로 만들어 오히려 끊긴다 */
const DPR_STEP = 0.25
const clampDpr = (v: number) => Math.min(window.devicePixelRatio || 1, Math.round(v / DPR_STEP) * DPR_STEP)
/** 화질을 올렸다 내렸다 방향이 이만큼 바뀌면 오르내림을 멈추고 가장 낮은 배율에 둔다 (배율이 바뀔 때마다 잠깐 끊기므로) */
const DPR_MAX_FLIPS = 4

/** 첫 화면 동안 받아 오는 것: 지형, 코스, 산 목록, 지금 고른 산 */
type LoadedData = { terrain: Terrain; trails: Trail[]; mountains: Mountain[]; mountain: Mountain }

export default function App() {
  const [data, setData] = useState<LoadedData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const courseId = useGame((s) => s.courseId)
  const [dpr, setDpr] = useState(() => clampDpr(DPR_RANGE[1]))
  // 화질 오르내림 기록. drei 의 flipflops 는 이미 최고 화질인데 올린 것도 세서 빠른 기기가 가장 낮은 화질로 떨어지므로 직접 센다
  const tuningRef = useRef({ factor: 1, dir: 0, flips: 0, frozen: false })
  const adjustDpr = (factor: number, dir: number) => {
    const tuning = tuningRef.current
    // 오르내림을 멈췄거나, 이미 끝까지 올리거나 내려서 배율이 그대로인 신호는 무시한다
    if (tuning.frozen || factor === tuning.factor) return
    tuning.factor = factor
    if (tuning.dir !== 0 && dir !== tuning.dir && ++tuning.flips >= DPR_MAX_FLIPS) {
      tuning.frozen = true
      setDpr(clampDpr(DPR_RANGE[0]))
      return
    }
    tuning.dir = dir
    setDpr(clampDpr(DPR_RANGE[0] + (DPR_RANGE[1] - DPR_RANGE[0]) * factor))
  }

  // 같이하기 서버에 붙는다. 서버가 없으면 혼자 오르기로 동작한다
  useEffect(() => startNet(), [])

  useEffect(() => {
    // 개발 중에는 ?mountain=dobongsan&course=dobongsan-uiam 처럼 산과 코스를 골라 시작할 수 있다
    const params = import.meta.env.DEV ? new URLSearchParams(location.search) : null
    const debugCourse = params?.get('course')
    const debugMountain = params?.get('mountain')
    const saved = debugMountain ? { ...DEFAULT_MOUNTAIN, id: debugMountain, name: debugMountain } : loadMountain()
    setSplash('지형을 펼치는 중', DATA_START)
    const loadMountainData = (m: Mountain): Promise<LoadedData> =>
      Promise.all([loadMountains(), loadData(m.id, (p) => setSplash('지형을 펼치는 중', DATA_START + p * (DATA_END - DATA_START)))]).then(
        ([mountains, d]) => ({ ...d, mountains, mountain: mountains.find((x) => x.id === m.id) ?? m }),
      )
    // 기억해 둔 산이 없어졌으면(데이터를 받지 못하면) 기본 산으로 연다
    loadMountainData(saved)
      .catch((e) => (saved.id === DEFAULT_MOUNTAIN.id ? Promise.reject(e) : loadMountainData(DEFAULT_MOUNTAIN)))
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
        gl={{ preserveDrawingBuffer: true, toneMapping: THREE.NoToneMapping, powerPreference: 'high-performance' }}
        dpr={dpr}
      >
        {/* 기기 따라 화질 자동 조절: 가장 높은 배율에서 시작해 프레임이 떨어지면 내리고 여유가 생기면 올린다 */}
        <PerformanceMonitor
          factor={1}
          // 한 번 판단(2.5초)에 배율 범위의 20% 씩 움직여 0.25 단위 배율이 바로 한 칸씩 바뀌게 한다
          step={0.2}
          onDecline={({ factor }) => adjustDpr(factor, -1)}
          onIncline={({ factor }) => adjustDpr(factor, 1)}
        >
          <World terrain={data.terrain} trail={trail} />
        </PerformanceMonitor>
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
        {VWORLD_KEY && (
          <>
            {' · 위성사진 © '}
            <a href="https://www.vworld.kr">브이월드</a>
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
