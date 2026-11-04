import { forwardRef, useImperativeHandle, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export type HikerHandle = {
  group: THREE.Group
  /** 걸은 거리만큼 팔다리를 흔든다 */
  stride: (meters: number) => void
  setCheering: (on: boolean) => void
  /** 공중에 떠 있으면 다리를 접는다 */
  setAirborne: (on: boolean) => void
}

/**
 * 임시 아바타 (도형으로 만든 등산객).
 * 나중에 Quaternius 같은 무료 GLB 캐릭터로 바꾸면 된다.
 */
export const Hiker = forwardRef<HikerHandle>(function Hiker(_, ref) {
  const group = useRef<THREE.Group>(null!)
  const legL = useRef<THREE.Group>(null!)
  const legR = useRef<THREE.Group>(null!)
  const armL = useRef<THREE.Group>(null!)
  const armR = useRef<THREE.Group>(null!)
  const state = useRef({ phase: 0, swing: 0, cheering: false, airborne: false })

  useImperativeHandle(ref, () => ({
    group: group.current,
    stride: (m) => {
      state.current.phase += m * 2.2
      state.current.swing = Math.min(1, state.current.swing + Math.abs(m) * 2)
    },
    setCheering: (on) => {
      state.current.cheering = on
    },
    setAirborne: (on) => {
      state.current.airborne = on
    },
  }))

  useFrame((_, dt) => {
    const s = state.current
    s.swing = Math.max(0, s.swing - dt * 3) // 멈추면 서서히 차렷
    const a = Math.sin(s.phase) * 0.7 * s.swing
    if (s.airborne) {
      // 점프 중: 한쪽 다리는 앞으로 접고 다른 쪽은 뒤로
      legL.current.rotation.x = -0.9
      legR.current.rotation.x = 0.4
    } else {
      legL.current.rotation.x = a
      legR.current.rotation.x = -a
    }
    if (s.cheering) {
      // 만세
      armL.current.rotation.set(0, 0, 2.7)
      armR.current.rotation.set(0, 0, -2.7)
    } else {
      armL.current.rotation.set(-a, 0, 0.12)
      armR.current.rotation.set(a, 0, -0.12)
    }
  })

  return (
    <group ref={group}>
      {/* 다리 (엉덩이 높이에서 회전) */}
      {[
        [legL, -0.14],
        [legR, 0.14],
      ].map(([r, x]) => (
        <group key={x as number} ref={r as React.RefObject<THREE.Group>} position={[x as number, 0.9, 0]}>
          <mesh position={[0, -0.45, 0]} castShadow>
            <capsuleGeometry args={[0.1, 0.7]} />
            <meshStandardMaterial color="#2b2d42" />
          </mesh>
          <mesh position={[0, -0.88, 0.06]} castShadow>
            <boxGeometry args={[0.18, 0.12, 0.3]} />
            <meshStandardMaterial color="#5c4033" />
          </mesh>
        </group>
      ))}
      {/* 몸통 */}
      <mesh position={[0, 1.25, 0]} castShadow>
        <capsuleGeometry args={[0.24, 0.45]} />
        <meshStandardMaterial color="#e63946" />
      </mesh>
      {/* 배낭 */}
      <mesh position={[0, 1.3, -0.28]} castShadow>
        <boxGeometry args={[0.4, 0.5, 0.2]} />
        <meshStandardMaterial color="#1d3557" />
      </mesh>
      {/* 팔 (어깨에서 회전) */}
      {[
        [armL, -0.34],
        [armR, 0.34],
      ].map(([r, x]) => (
        <group key={x as number} ref={r as React.RefObject<THREE.Group>} position={[x as number, 1.5, 0]}>
          <mesh position={[0, -0.3, 0]} castShadow>
            <capsuleGeometry args={[0.07, 0.45]} />
            <meshStandardMaterial color="#e63946" />
          </mesh>
        </group>
      ))}
      {/* 머리와 모자 */}
      <mesh position={[0, 1.8, 0]} castShadow>
        <sphereGeometry args={[0.17, 20, 16]} />
        <meshStandardMaterial color="#f1c27d" />
      </mesh>
      <mesh position={[0, 1.93, 0.03]} castShadow>
        <cylinderGeometry args={[0.15, 0.2, 0.12, 20]} />
        <meshStandardMaterial color="#457b9d" />
      </mesh>
      <mesh position={[0, 1.88, 0.15]} rotation={[0.2, 0, 0]}>
        <boxGeometry args={[0.28, 0.02, 0.16]} />
        <meshStandardMaterial color="#457b9d" />
      </mesh>
    </group>
  )
})
