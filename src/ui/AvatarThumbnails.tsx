import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrthographicCamera } from '@react-three/drei'
import { AVATARS, useAvatarThumbs } from '../lib/avatars'
import { Avatar } from '../scene/Avatar'
import type { HikerHandle } from '../scene/Hiker'

const SIZE = 160 // 그림 한 장 크기(px)
const FRAME_HEIGHT = 2.6 // 그림 한 장에 담을 높이(m)
// 캐릭터 사이 간격(m). 한 칸이 그림 한 장이 되므로 높이와 같아야 정사각형으로 찌그러짐 없이 잘린다
const SPACING = FRAME_HEIGHT
const SETTLE_FRAMES = 4 // 몇 프레임 그린 뒤(만세 자세가 잡힌 뒤) 찍는다
/** 첫 화면(지형·내 캐릭터)을 먼저 받도록 이만큼 기다렸다가 나머지 캐릭터 파일을 받아 찍는다 (ms) */
const START_DELAY = 2000

/** 다섯 캐릭터를 나란히 세워 한 번에 찍고, 한 칸씩 잘라 그림으로 만든다 */
function Studio() {
  const handles = useRef<(HikerHandle | null)[]>([])
  const frames = useRef(0)
  const gl = useThree((s) => s.gl)

  useFrame(() => {
    if (useAvatarThumbs.getState().done) return
    handles.current.forEach((h) => h?.setCheering(true))
    // GLB 캐릭터 파일을 다 받은 뒤부터 센다
    if (!handles.current.every((h) => h?.ready())) return
    if (++frames.current < SETTLE_FRAMES) return

    const src = gl.domElement
    const cell = src.width / AVATARS.length
    const thumbs: Record<string, string> = {}
    AVATARS.forEach((a, i) => {
      const c = document.createElement('canvas')
      c.width = c.height = SIZE
      c.getContext('2d')!.drawImage(src, i * cell, 0, cell, src.height, 0, 0, SIZE, SIZE)
      thumbs[a.kind] = c.toDataURL('image/png')
    })
    useAvatarThumbs.setState({ thumbs, done: true })
  })

  return (
    <>
      <ambientLight intensity={1.2} />
      <directionalLight position={[2, 4, 5]} intensity={2} />
      {AVATARS.map((a, i) => (
        <group key={a.kind} position={[(i - (AVATARS.length - 1) / 2) * SPACING, 0, 0]}>
          <Avatar
            ref={(h) => {
              handles.current[i] = h
            }}
            kind={a.kind}
          />
        </group>
      ))}
    </>
  )
}

/**
 * 앱이 뜰 때 한 번 캐릭터 모습 그림을 만들고 사라진다.
 * 캐릭터마다 3D 화면을 따로 띄우면 무거워서, 화면 하나에 나란히 세워 한 번에 찍는다.
 */
export function AvatarThumbnails() {
  const done = useAvatarThumbs((s) => s.done)
  const [started, setStarted] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setStarted(true), START_DELAY)
    return () => clearTimeout(t)
  }, [])
  // 끝내 못 찍어도 목록은 이름으로 보이니, 시작하고 10초 뒤에는 숨은 화면을 치운다
  useEffect(() => {
    if (!started) return
    const t = setTimeout(() => useAvatarThumbs.setState({ done: true }), 10000)
    return () => clearTimeout(t)
  }, [started])
  if (done || !started) return null

  const width = AVATARS.length * SPACING
  return (
    <div style={{ position: 'fixed', left: -10000, top: 0, width: SIZE * AVATARS.length, height: SIZE }} aria-hidden>
      <Canvas gl={{ preserveDrawingBuffer: true, alpha: true }} dpr={1}>
        <OrthographicCamera
          makeDefault
          position={[0, 1.2, 10]}
          left={-width / 2}
          right={width / 2}
          top={FRAME_HEIGHT / 2}
          bottom={-FRAME_HEIGHT / 2}
          near={0.1}
          far={50}
        />
        <Studio />
      </Canvas>
    </div>
  )
}
