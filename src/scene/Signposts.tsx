import { useMemo } from 'react'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { Trail } from '../lib/data'
import { useGame } from '../lib/store'

const SIDE_OFFSET = 2.5 // 등산로 오른쪽으로 비켜 세운다 (m)
const LABEL_RANGE = 300 // 이 거리 안의 이정표만 이름을 띄운다 (m)

/** 이정표마다 나무 표지판을 세우고, 가까운 것만 이름을 띄운다 */
export function Signposts({ trail }: { trail: Trail }) {
  // 50m 단위로만 다시 그려서 걸을 때마다 렌더링하지 않게 한다
  const bucket = useGame((s) => Math.floor(s.distance / 50))
  const near = bucket * 50

  const posts = useMemo(
    () =>
      trail.data.checkpoints.map((cp) => {
        const p = trail.positionAt(cp.distance)
        const h = trail.headingAt(cp.distance)
        const right = new THREE.Vector3(-Math.cos(h), 0, Math.sin(h))
        const pos = p.clone().addScaledVector(right, SIDE_OFFSET)
        return { ...cp, pos, rotation: h }
      }),
    [trail],
  )

  return (
    <group>
      {posts.map((post) => (
        <group key={post.name} position={post.pos} rotation={[0, post.rotation, 0]}>
          <mesh position={[0, 1.1, 0]} castShadow>
            <boxGeometry args={[0.14, 2.2, 0.14]} />
            <meshStandardMaterial color="#6b4a2f" roughness={1} />
          </mesh>
          <mesh position={[0, 1.95, 0]} castShadow>
            <boxGeometry args={[1.3, 0.38, 0.06]} />
            <meshStandardMaterial color="#a0794f" roughness={1} />
          </mesh>
          {Math.abs(post.distance - near) < LABEL_RANGE && (
            <Html position={[0, 2.7, 0]} center distanceFactor={14} zIndexRange={[10, 0]}>
              <div className="signpost-label">{post.name}</div>
            </Html>
          )}
        </group>
      ))}
    </group>
  )
}
