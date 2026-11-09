import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { meshHeight, type Terrain, type Trail } from '../lib/data'
import { seededRandom } from '../lib/random'
import { summitVista } from '../lib/summit'

/** 정상이 흙이 아니라 넓은 화강암 맨바위인 곳 (정상 이름). 북한산 영봉은 너럭바위 위에 서서 인수봉을 바라본다 */
const ROCKY_SUMMITS = new Set(['영봉'])

/** 맨바위 판 반지름(m)과 둘레를 나누는 수 */
const RADIUS = 7
const RINGS = 24
const SEGMENTS = 96
/** 지형 위로 띄우는 높이(m). 캐릭터 발이 묻혀 보이지 않을 만큼만 */
const LIFT = 0.2
/** 기념사진 카메라가 서는 쪽(풍경 반대쪽) 이 각도 안에는 바위를 두지 않는다 */
const CAMERA_CLEAR = THREE.MathUtils.degToRad(60)

const SHADES = ['#b4ada0', '#a59e92', '#bab3a6', '#9c958a']

/**
 * 맨바위 정상. 정상 둘레 지형 위에 들쭉날쭉한 화강암 판을 지형 높이 그대로 얇게 덮고,
 * 가장자리에 낮은 바위 몇 개를 둔다. 판은 지형을 따라가서 따로 충돌체가 없고, 바위는 등산로와 기념사진 쪽을 비켜 둔다
 */
export function SummitRock({ terrain, trail }: { terrain: Terrain; trail: Trail }) {
  const rocky = ROCKY_SUMMITS.has(trail.data.summit)
  const built = useMemo(() => (rocky ? build(terrain, trail) : null), [rocky, terrain, trail])
  useEffect(() => () => built?.slab.dispose(), [built])
  if (!built) return null

  return (
    <group>
      <mesh geometry={built.slab} receiveShadow>
        <meshStandardMaterial color={SHADES[0]} roughness={0.85} flatShading polygonOffset polygonOffsetFactor={-2} />
      </mesh>
      {built.boulders.map((b, i) => (
        <mesh key={i} position={b.pos} scale={b.scale} rotation={[0, b.rot, 0]} castShadow receiveShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={SHADES[i % SHADES.length]} roughness={0.9} flatShading />
        </mesh>
      ))}
    </group>
  )
}

function build(terrain: Terrain, trail: Trail) {
  const top = trail.positionAt(trail.length)
  const rand = seededRandom(Math.round(top.x * 7 + top.z * 13))
  // 둘레를 들쭉날쭉하게: 각도마다 반지름을 달리하고 이웃끼리 부드럽게 잇는다
  const raw = Array.from({ length: SEGMENTS }, () => 0.7 + rand() * 0.45)
  const edge = raw.map((r, i) => (raw[(i + SEGMENTS - 1) % SEGMENTS] + r * 2 + raw[(i + 1) % SEGMENTS]) / 4)

  const positions: number[] = []
  const push = (x: number, z: number) => {
    positions.push(x, meshHeight(terrain, x, z) + LIFT, z)
  }
  push(top.x, top.z)
  for (let k = 1; k <= RINGS; k++)
    for (let s = 0; s < SEGMENTS; s++) {
      const a = (s / SEGMENTS) * Math.PI * 2
      const r = RADIUS * edge[s] * (k / RINGS)
      push(top.x + Math.cos(a) * r, top.z + Math.sin(a) * r)
    }
  const index: number[] = []
  const at = (k: number, s: number) => (k === 0 ? 0 : 1 + (k - 1) * SEGMENTS + (s % SEGMENTS))
  for (let s = 0; s < SEGMENTS; s++) index.push(0, at(1, s + 1), at(1, s))
  for (let k = 1; k < RINGS; k++)
    for (let s = 0; s < SEGMENTS; s++) index.push(at(k, s), at(k, s + 1), at(k + 1, s + 1), at(k, s), at(k + 1, s + 1), at(k + 1, s))
  const slab = new THREE.BufferGeometry()
  slab.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  slab.setIndex(index)
  slab.computeVertexNormals()

  // 가장자리 바위: 정상에 오르는 마지막 등산로와 기념사진 카메라 쪽은 비킨다
  const vista = summitVista(terrain, trail)
  const cameraAngle = Math.atan2(-vista.z, -vista.x)
  const approach = Array.from({ length: 40 }, (_, i) => trail.positionAt(trail.length - i))
  const boulders: { pos: [number, number, number]; scale: [number, number, number]; rot: number }[] = []
  for (let s = 0; s < SEGMENTS; s += 10) {
    const a = (s / SEGMENTS) * Math.PI * 2 + rand() * 0.3
    if (Math.abs(Math.atan2(Math.sin(a - cameraAngle), Math.cos(a - cameraAngle))) < CAMERA_CLEAR) continue
    const r = RADIUS * edge[s] * 0.9
    const x = top.x + Math.cos(a) * r
    const z = top.z + Math.sin(a) * r
    if (approach.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 2.5 ** 2)) continue
    if (rand() < 0.35) continue
    const size = 0.6 + rand() * 0.5
    boulders.push({ pos: [x, meshHeight(terrain, x, z) - 0.15, z], scale: [size * 1.4, size * 0.7, size], rot: rand() * Math.PI })
  }
  return { slab, boulders }
}
