import { useMemo } from 'react'
import * as THREE from 'three'
import { meshHeight, type Terrain, type Trail } from '../lib/data'
import { summitVista } from '../lib/summit'

/**
 * 백운대 정상 깃발. 기념사진에서 아바타 뒤 오른쪽 배경에 보이도록
 * 정상에서 풍경 쪽으로 3m, 옆으로 2.5m 떨어진 곳에 세운다 (카메라는 풍경 반대쪽에 선다).
 */
export function SummitFlag({ terrain, trail }: { terrain: Terrain; trail: Trail }) {
  const flag = useMemo(() => {
    const top = trail.positionAt(trail.length)
    const d = summitVista(terrain, trail)
    const side = new THREE.Vector3(-d.z, 0, d.x)
    const p = top.clone().addScaledVector(d, 3).addScaledVector(side, 2.5)
    return p.setY(meshHeight(terrain, p.x, p.z) - 0.2)
  }, [terrain, trail])

  return (
    <group position={flag}>
      <mesh position={[0, 2.5, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 5]} />
        <meshStandardMaterial color="#ddd" />
      </mesh>
      <mesh position={[0.6, 4.55, 0]} castShadow>
        <boxGeometry args={[1.2, 0.75, 0.04]} />
        <meshStandardMaterial color="#e63946" />
      </mesh>
    </group>
  )
}
