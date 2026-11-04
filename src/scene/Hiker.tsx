import { forwardRef, useImperativeHandle, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { seededRandom } from '../lib/random'
import type { AvatarKind } from '../lib/avatars'

export type HikerHandle = {
  group: THREE.Group
  /** 걸은 거리만큼 팔다리를 흔든다 */
  stride: (meters: number) => void
  setCheering: (on: boolean) => void
  /** 공중에 떠 있으면 다리를 접는다 */
  setAirborne: (on: boolean) => void
}

/** 캐릭터마다 다른 골격 치수와 몸통. 원점은 발바닥, 앞쪽이 +z */
type Rig = {
  hipY: number
  legX: number
  legLen: number
  legR: number
  legColor: string
  foot: 'shoe' | 'web' | null
  footColor: string
  shoulderY: number
  shoulderX: number
  armLen: number
  armR: number
  armColor: string
  /** 걸을 때 몸을 좌우로 뒤뚱거리는 정도(라디안) */
  waddle: number
  /** 왕눈이 눈알 (없으면 생략) */
  eyes?: { y: number; z: number; x: number; size: number }
  body: ReactNode
}

const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => (
  <meshStandardMaterial color={color} roughness={0.8} {...extra} />
)

/** 꼭짓점을 흔든 울퉁불퉁한 감자 */
function potatoGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 2)
  const rand = seededRandom(5)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  const moved = new Map<string, number>()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`
    if (!moved.has(key)) moved.set(key, 0.88 + rand() * 0.2)
    v.multiplyScalar(moved.get(key)!)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  return geo
}

function rigOf(kind: AvatarKind, potato: THREE.BufferGeometry): Rig {
  switch (kind) {
    case 'uncle':
      return {
        hipY: 0.75, legX: 0.15, legLen: 0.55, legR: 0.11, legColor: '#ff5fa2', foot: 'shoe', footColor: '#f4f4f4',
        shoulderY: 1.32, shoulderX: 0.4, armLen: 0.42, armR: 0.08, armColor: '#b6ff00', waddle: 0.06,
        eyes: { y: 1.86, z: 0.29, x: 0.11, size: 0.1 },
        body: (
          <>
            {/* 형광 점퍼와 볼록한 배 */}
            <mesh position={[0, 1.08, 0]} castShadow>
              <capsuleGeometry args={[0.31, 0.35]} />
              {std('#b6ff00')}
            </mesh>
            <mesh position={[0, 0.98, 0.14]} castShadow>
              <sphereGeometry args={[0.3, 20, 16]} />
              {std('#a8f000')}
            </mesh>
            {/* 큰 머리 */}
            <mesh position={[0, 1.78, 0]} castShadow>
              <sphereGeometry args={[0.33, 24, 20]} />
              {std('#f1c27d')}
            </mesh>
            {/* 콧수염 */}
            <mesh position={[0, 1.66, 0.3]} rotation={[0.2, 0, 0]}>
              <boxGeometry args={[0.24, 0.05, 0.05]} />
              {std('#222')}
            </mesh>
            {/* 주황 썬캡: 머리띠 + 큰 챙 */}
            <mesh position={[0, 1.98, 0]}>
              <cylinderGeometry args={[0.31, 0.31, 0.09, 24, 1, true]} />
              {std('#ff8c00', { side: THREE.DoubleSide })}
            </mesh>
            <mesh position={[0, 1.95, 0.3]} rotation={[0.15, 0, 0]}>
              <boxGeometry args={[0.5, 0.02, 0.32]} />
              {std('#ff8c00')}
            </mesh>
          </>
        ),
      }
    case 'potato':
      return {
        hipY: 0.36, legX: 0.18, legLen: 0.3, legR: 0.06, legColor: '#c9a26b', foot: 'shoe', footColor: '#3b2a1a',
        shoulderY: 1.0, shoulderX: 0.52, armLen: 0.3, armR: 0.05, armColor: '#b8894f', waddle: 0.13,
        eyes: { y: 1.2, z: 0.44, x: 0.15, size: 0.13 },
        body: (
          <>
            <mesh geometry={potato} position={[0, 0.95, 0]} scale={[0.55, 0.72, 0.5]} castShadow>
              {std('#b8894f', { flatShading: true })}
            </mesh>
            {/* 머리 위 싹 */}
            <mesh position={[-0.07, 1.72, 0]} rotation={[0, 0, 0.6]}>
              <coneGeometry args={[0.05, 0.22, 6]} />
              {std('#7cc242')}
            </mesh>
            <mesh position={[0.07, 1.74, 0]} rotation={[0, 0, -0.5]}>
              <coneGeometry args={[0.05, 0.26, 6]} />
              {std('#8fd14f')}
            </mesh>
          </>
        ),
      }
    case 'duck':
      return {
        hipY: 0.3, legX: 0.18, legLen: 0.26, legR: 0.04, legColor: '#ff9f1c', foot: 'web', footColor: '#ff9f1c',
        shoulderY: 0.95, shoulderX: 0.56, armLen: 0.36, armR: 0.09, armColor: '#ffd60a', waddle: 0.16,
        eyes: { y: 1.56, z: 0.36, x: 0.12, size: 0.09 },
        body: (
          <>
            <mesh position={[0, 0.8, 0]} scale={[1, 0.95, 1.1]} castShadow>
              <sphereGeometry args={[0.55, 24, 20]} />
              {std('#ffd60a')}
            </mesh>
            <mesh position={[0, 1.45, 0.08]} castShadow>
              <sphereGeometry args={[0.34, 24, 20]} />
              {std('#ffd60a')}
            </mesh>
            {/* 부리 */}
            <mesh position={[0, 1.4, 0.44]} scale={[1, 0.45, 1]}>
              <sphereGeometry args={[0.16, 16, 12]} />
              {std('#ff9f1c')}
            </mesh>
            {/* 작은 배낭 */}
            <mesh position={[0, 0.9, -0.55]} castShadow>
              <boxGeometry args={[0.4, 0.42, 0.18]} />
              {std('#1d3557')}
            </mesh>
          </>
        ),
      }
    case 'tofu':
      return {
        hipY: 0.5, legX: 0.18, legLen: 0.46, legR: 0.035, legColor: '#f3e3c3', foot: null, footColor: '#f3e3c3',
        shoulderY: 1.12, shoulderX: 0.43, armLen: 0.5, armR: 0.03, armColor: '#f3e3c3', waddle: 0.1,
        eyes: { y: 1.14, z: 0.41, x: 0.15, size: 0.12 },
        body: (
          <>
            <RoundedBox args={[0.8, 0.9, 0.8]} radius={0.12} smoothness={4} position={[0, 0.96, 0]} castShadow>
              {std('#f7f5ee')}
            </RoundedBox>
            {/* 빨간 머리띠 */}
            <mesh position={[0, 1.3, 0]}>
              <boxGeometry args={[0.83, 0.1, 0.83]} />
              {std('#e63946')}
            </mesh>
            {/* 볼터치 */}
            {[-0.25, 0.25].map((x) => (
              <mesh key={x} position={[x, 0.98, 0.41]} rotation={[0, 0, 0]}>
                <circleGeometry args={[0.06, 16]} />
                {std('#ff9eb5')}
              </mesh>
            ))}
          </>
        ),
      }
    case 'hiker':
    default:
      return {
        hipY: 0.9, legX: 0.14, legLen: 0.7, legR: 0.1, legColor: '#2b2d42', foot: 'shoe', footColor: '#5c4033',
        shoulderY: 1.5, shoulderX: 0.34, armLen: 0.45, armR: 0.07, armColor: '#e63946', waddle: 0.03,
        body: (
          <>
            <mesh position={[0, 1.25, 0]} castShadow>
              <capsuleGeometry args={[0.24, 0.45]} />
              {std('#e63946')}
            </mesh>
            <mesh position={[0, 1.3, -0.28]} castShadow>
              <boxGeometry args={[0.4, 0.5, 0.2]} />
              {std('#1d3557')}
            </mesh>
            <mesh position={[0, 1.8, 0]} castShadow>
              <sphereGeometry args={[0.17, 20, 16]} />
              {std('#f1c27d')}
            </mesh>
            <mesh position={[0, 1.93, 0.03]} castShadow>
              <cylinderGeometry args={[0.15, 0.2, 0.12, 20]} />
              {std('#457b9d')}
            </mesh>
            <mesh position={[0, 1.88, 0.15]} rotation={[0.2, 0, 0]}>
              <boxGeometry args={[0.28, 0.02, 0.16]} />
              {std('#457b9d')}
            </mesh>
          </>
        ),
      }
  }
}

/** 관절(엉덩이·어깨)에서 아래로 늘어진 팔다리 */
function Limb({ limbRef, x, y, len, r, color, foot, footColor }: {
  limbRef: RefObject<THREE.Group | null>
  x: number
  y: number
  len: number
  r: number
  color: string
  foot?: Rig['foot']
  footColor?: string
}) {
  return (
    <group ref={limbRef} position={[x, y, 0]}>
      <mesh position={[0, -len / 2, 0]} castShadow>
        <capsuleGeometry args={[r, Math.max(0.01, len - r * 2)]} />
        {std(color)}
      </mesh>
      {foot === 'shoe' && (
        <mesh position={[0, -len + 0.02, 0.06]} castShadow>
          <boxGeometry args={[r * 2 + 0.06, 0.1, 0.28]} />
          {std(footColor ?? '#333')}
        </mesh>
      )}
      {foot === 'web' && (
        <mesh position={[0, -len + 0.01, 0.1]} castShadow>
          <boxGeometry args={[0.22, 0.03, 0.3]} />
          {std(footColor ?? '#ff9f1c')}
        </mesh>
      )}
    </group>
  )
}

/**
 * 고를 수 있는 병맛 아바타. 같은 골격(다리·팔·몸통 흔들기·왕눈이)에 캐릭터마다 몸통과 치수만 다르다.
 */
export const Hiker = forwardRef<HikerHandle, { kind: AvatarKind }>(function Hiker({ kind }, ref) {
  const group = useRef<THREE.Group>(null!)
  const upper = useRef<THREE.Group>(null!)
  const legL = useRef<THREE.Group>(null)
  const legR = useRef<THREE.Group>(null)
  const armL = useRef<THREE.Group>(null)
  const armR = useRef<THREE.Group>(null)
  const pupils = useRef<THREE.Mesh[]>([])
  const state = useRef({ phase: 0, swing: 0, cheering: false, airborne: false, time: 0 })
  const potato = useMemo(() => potatoGeometry(), [])
  const rig = useMemo(() => rigOf(kind, potato), [kind, potato])

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
    s.time += dt
    s.swing = Math.max(0, s.swing - dt * 3) // 멈추면 서서히 차렷
    const a = Math.sin(s.phase) * 0.7 * s.swing
    if (!legL.current || !legR.current || !armL.current || !armR.current) return
    if (s.airborne) {
      // 점프 중: 한쪽 다리는 앞으로 접고 다른 쪽은 뒤로
      legL.current.rotation.x = -0.9
      legR.current.rotation.x = 0.4
    } else {
      legL.current.rotation.x = a
      legR.current.rotation.x = -a
    }
    if (s.cheering) {
      // 만세 + 신나서 몸을 흔든다
      armL.current.rotation.set(0, 0, 2.7 + Math.sin(s.time * 10) * 0.15)
      armR.current.rotation.set(0, 0, -2.7 - Math.sin(s.time * 10) * 0.15)
      upper.current.rotation.z = Math.sin(s.time * 6) * rig.waddle
    } else {
      armL.current.rotation.set(-a, 0, 0.12)
      armR.current.rotation.set(a, 0, -0.12)
      // 걸을 때 몸이 통통 튀고 좌우로 뒤뚱거린다
      upper.current.rotation.z = Math.sin(s.phase) * rig.waddle * s.swing
    }
    upper.current.position.y = Math.abs(Math.sin(s.phase)) * 0.06 * s.swing
    // 왕눈이 눈동자가 걸음에 맞춰 덜렁거린다
    if (rig.eyes) {
      const e = rig.eyes.size * 0.35
      pupils.current.forEach((p, i) => {
        if (!p) return
        const jiggle = 0.3 + s.swing * 0.7
        p.position.x = Math.sin(s.time * 11 + i * 2) * e * jiggle
        p.position.y = Math.cos(s.time * 13 + i) * e * jiggle
      })
    }
  })

  return (
    <group ref={group}>
      <Limb limbRef={legL} x={-rig.legX} y={rig.hipY} len={rig.legLen} r={rig.legR} color={rig.legColor} foot={rig.foot} footColor={rig.footColor} />
      <Limb limbRef={legR} x={rig.legX} y={rig.hipY} len={rig.legLen} r={rig.legR} color={rig.legColor} foot={rig.foot} footColor={rig.footColor} />
      <group ref={upper}>
        {rig.body}
        <Limb limbRef={armL} x={-rig.shoulderX} y={rig.shoulderY} len={rig.armLen} r={rig.armR} color={rig.armColor} />
        <Limb limbRef={armR} x={rig.shoulderX} y={rig.shoulderY} len={rig.armLen} r={rig.armR} color={rig.armColor} />
        {rig.eyes &&
          [-1, 1].map((side, i) => (
            <group key={side} position={[side * rig.eyes!.x, rig.eyes!.y, rig.eyes!.z]}>
              <mesh>
                <sphereGeometry args={[rig.eyes!.size, 16, 12]} />
                {std('#ffffff', { roughness: 0.3 })}
              </mesh>
              <group position={[0, 0, rig.eyes!.size * 0.75]}>
                <mesh
                  ref={(m) => {
                    if (m) pupils.current[i] = m
                  }}
                >
                  <sphereGeometry args={[rig.eyes!.size * 0.45, 12, 10]} />
                  {std('#111111', { roughness: 0.2 })}
                </mesh>
              </group>
            </group>
          ))}
      </group>
    </group>
  )
})
