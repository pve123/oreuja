import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import type { Trail } from '../lib/data'

/** 등산로 선과 정상 깃발 */
export function TrailPath({ trail }: { trail: Trail }) {
  const points = useMemo(() => trail.points.map((p) => p.clone().setY(p.y + 0.6)), [trail])
  // 깃발은 정상 지점에서 진행 방향 오른쪽으로 3m 비켜 세운다 (아바타와 겹치지 않게)
  const flag = useMemo(() => {
    const end = trail.points[trail.points.length - 1]
    const h = trail.headingAt(trail.length)
    return end.clone().add(new THREE.Vector3(-Math.cos(h), -0.3, Math.sin(h)).multiplyScalar(3))
  }, [trail])

  return (
    <group>
      <Line points={points} color="#f2c14e" lineWidth={3} />
      <group position={flag}>
        <mesh position={[0, 4, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 8]} />
          <meshStandardMaterial color="#ddd" />
        </mesh>
        <mesh position={[0.9, 7.2, 0]} castShadow>
          <boxGeometry args={[1.8, 1.1, 0.05]} />
          <meshStandardMaterial color="#e63946" />
        </mesh>
      </group>
    </group>
  )
}
