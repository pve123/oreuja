import { forwardRef, Suspense, useCallback, useEffect, useImperativeHandle, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { AVATAR_MODELS, type AvatarKind, type AvatarModel } from '../lib/avatars'
import { Hiker, type HikerHandle } from './Hiker'
import { attachTrekkingPole } from './TrekkingPole'

/** GLB 캐릭터 키를 이 높이(m)로 맞춘다. 도형 아바타(기본 등산객 약 2m)와 비슷하게 */
const TARGET_HEIGHT = 1.9
/** Hiker 걸음 주기와 같게: 1m 에 2.2 라디안. 2π 가 걷기 동작 한 바퀴(두 걸음)다 */
const STRIDE_RAD_PER_M = 2.2
/** 동작이 바뀔 때 섞이는 빠르기 (클수록 빨리 바뀐다) */
const BLEND = 10

type Motion = { phase: number; swing: number; cheering: boolean; airborne: boolean; ready: boolean }
const REST: Motion = { phase: 0, swing: 0, cheering: false, airborne: false, ready: false }

/**
 * 캐릭터 종류에 맞게 도형 아바타(Hiker) 또는 GLB 캐릭터를 그린다.
 * 바깥 group 은 늘 있으므로, GLB 를 받는 중에도 World·Peers 가 위치를 옮길 수 있다.
 */
export const Avatar = forwardRef<HikerHandle, { kind: AvatarKind }>(function Avatar({ kind }, ref) {
  const group = useRef<THREE.Group>(null!)
  const shape = useRef<HikerHandle>(null)
  const motion = useRef<Motion>({ phase: 0, swing: 0, cheering: false, airborne: false, ready: false })
  const model = AVATAR_MODELS[kind]
  const setReady = useCallback((on: boolean) => {
    motion.current.ready = on
  }, [])

  // 멈추면 서서히 쉬는 자세로
  useFrame((_, dt) => {
    motion.current.swing = Math.max(0, motion.current.swing - Math.min(dt, 0.1) * 3)
  })

  useImperativeHandle(ref, () => ({
    group: group.current,
    stride: (m) => {
      shape.current?.stride(m)
      motion.current.phase += m * STRIDE_RAD_PER_M
      motion.current.swing = Math.min(1, motion.current.swing + Math.abs(m) * 2)
    },
    setCheering: (on) => {
      shape.current?.setCheering(on)
      motion.current.cheering = on
    },
    setAirborne: (on) => {
      shape.current?.setAirborne(on)
      motion.current.airborne = on
    },
    ready: () => (model ? motion.current.ready : true),
  }))

  return (
    <group ref={group}>
      {model ? (
        <Suspense fallback={null}>
          <ModelBody
            key={kind}
            model={model}
            motion={motion}
            onReady={setReady}
          />
        </Suspense>
      ) : (
        <Hiker ref={shape} kind={kind} />
      )}
    </group>
  )
})

/** GLB 캐릭터 한 명. 걷기 동작은 걸은 거리에 맞춰 돌려서 발소리와 발걸음이 맞는다 */
function ModelBody({ model, motion, onReady }: { model: AvatarModel; motion: RefObject<Motion>; onReady: (on: boolean) => void }) {
  const gltf = useGLTF(model.url)
  // 동작 파일이 따로 없으면 캐릭터 파일을 한 번 더 넘긴다 (useGLTF 는 같은 주소를 캐시한다)
  const animGltf = useGLTF(model.animUrl ?? model.url)

  // 같은 캐릭터를 여러 명(나·같이하기·썸네일)이 쓰므로 뼈대째 복제한다
  const { root, scale } = useMemo(() => {
    const root = cloneSkinned(gltf.scene) as THREE.Group
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        // 뼈대로 움직이는 메시는 원래 경계 상자로 잘못 가려질 수 있다
        mesh.frustumCulled = false
      }
    })
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3())
    return { root, scale: size.y > 0 ? TARGET_HEIGHT / size.y : 1 }
  }, [gltf.scene])

  const animator = useMemo(() => {
    const animator = createAnimator(root, animGltf.animations, model)
    // 쉬는 자세를 입힌 뒤 그 자세 기준으로 스틱을 손에 붙인다
    animator.start()
    animator.update(0, REST)
    for (const bone of model.pole.bones) {
      if (!attachTrekkingPole(root, bone, model.pole.grip, scale)) console.warn(`[Avatar] ${model.url} 에서 스틱을 쥘 뼈 ${bone} 를 찾지 못했다`)
    }
    return animator
  }, [root, animGltf.animations, model, scale])

  useEffect(() => {
    // StrictMode 는 effect 를 정리했다가 다시 부르므로, 멈춘 동작을 여기서 다시 튼다
    animator.start()
    onReady(true)
    return () => {
      onReady(false)
      animator.stop()
    }
  }, [animator, onReady])

  useFrame((_, dt) => animator.update(Math.min(dt, 0.1), motion.current))

  return <primitive object={root} scale={scale} />
}

type Slot = 'idle' | 'walk' | 'air' | 'cheer'
const SLOTS: Slot[] = ['idle', 'walk', 'air', 'cheer']

/** 캐릭터 하나의 동작 섞기. 쉬기·걷기·공중·만세 동작의 비중을 상태에 맞춰 부드럽게 옮긴다 */
function createAnimator(root: THREE.Object3D, clips: THREE.AnimationClip[], model: AvatarModel) {
  const mixer = new THREE.AnimationMixer(root)
  const actions = {} as Record<Slot, THREE.AnimationAction | null>
  for (const slot of SLOTS) {
    const clip = THREE.AnimationClip.findByName(clips, model.clips[slot])
    if (!clip) console.warn(`[Avatar] ${model.url} 에 ${model.clips[slot]} 동작이 없다`)
    actions[slot] = clip ? mixer.clipAction(clip) : null
  }
  const weights: Record<Slot, number> = { idle: 1, walk: 0, air: 0, cheer: 0 }

  return {
    update(dt: number, m: Motion) {
      const target: Record<Slot, number> = m.airborne
        ? { idle: 0, walk: 0, air: 1, cheer: 0 }
        : m.cheering
          ? { idle: 0, walk: 0, air: 0, cheer: 1 }
          : { idle: 1 - m.swing, walk: m.swing, air: 0, cheer: 0 }
      const k = 1 - Math.exp(-BLEND * dt)
      for (const slot of SLOTS) {
        weights[slot] += (target[slot] - weights[slot]) * k
        actions[slot]?.setEffectiveWeight(weights[slot])
      }
      if (actions.walk) {
        const cycle = (((m.phase / (Math.PI * 2)) % 1) + 1) % 1
        actions.walk.time = cycle * actions.walk.getClip().duration
      }
      mixer.update(dt)
    },
    start() {
      for (const slot of SLOTS) actions[slot]?.setEffectiveWeight(weights[slot]).play()
      // 걷기는 시간이 아니라 걸은 거리로 돌린다
      if (actions.walk) actions.walk.timeScale = 0
    },
    stop() {
      mixer.stopAllAction()
    },
  }
}

for (const m of Object.values(AVATAR_MODELS)) {
  useGLTF.preload(m.url)
  if (m.animUrl) useGLTF.preload(m.animUrl)
}
