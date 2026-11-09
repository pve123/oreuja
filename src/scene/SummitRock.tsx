import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { meshHeight, type Terrain, type Trail } from '../lib/data'
import { setObstacles, type Obstacle } from '../lib/obstacles'
import { seededRandom } from '../lib/random'
import { summitVista } from '../lib/summit'
import { FORTRESS_COLLIDERS } from '../lib/landmarks'
import { DRAW_RANGE, FortressGate } from './Landmarks'
import { useGame } from '../lib/store'
import { Blobs, Flagpole, Rope, type Blob } from './NamedRocks'

/**
 * 정상마다 실제 사진을 보고 고른 꾸밈.
 * - rock: 정상 둘레에 화강암 맨바위 판을 깐다
 * - flag: 태극기 게양대 (백운대)
 * - railing: 풍경 쪽 반원에 쇠난간 (백운대, 신선대)
 * - marker: 이름을 세로로 쓴 나무 표지목 (신선대)
 * - spire: 옆에 우뚝 솟은 바위 기둥 (우이암)
 * - hermitage: 풍경 쪽 절벽 위 붉은 암자 (연주대)
 * - fortress: 도착 10m 앞 등산로에 걸친 산성 대문과 문루 (대동문). 정상에 서면 성문을 막 지나온 자리다
 */
type Decor = { rock?: boolean; flag?: boolean; railing?: boolean; marker?: string; spire?: boolean; hermitage?: boolean; fortress?: boolean }
const SUMMITS: Record<string, Decor> = {
  영봉: { rock: true },
  백운대: { rock: true, flag: true, railing: true },
  신선대: { rock: true, railing: true, marker: '신선대정상' },
  우이암: { spire: true },
  연주대: { rock: true, hermitage: true },
  대동문: { fortress: true },
}

/** 맨바위 판 반지름(m)과 둘레를 나누는 수 */
const RADIUS = 7
const RINGS = 24
const SEGMENTS = 96
/** 지형 위로 띄우는 높이(m). 캐릭터 발이 묻혀 보이지 않을 만큼만 */
const LIFT = 0.2
/** 기념사진 카메라가 서는 쪽(풍경 반대쪽) 이 각도 안에는 바위를 두지 않는다 */
const CAMERA_CLEAR = THREE.MathUtils.degToRad(60)

const SHADES = ['#b4ada0', '#a59e92', '#bab3a6', '#9c958a']

/** 정상 둘레 꾸밈. 이름이 SUMMITS 에 없는 정상은 깃발만 둔다 (src/scene/SummitFlag.tsx) */
export function SummitRock({ terrain, trail }: { terrain: Terrain; trail: Trail }) {
  const decor = SUMMITS[trail.data.summit]
  const frame = useMemo(() => {
    const top = trail.positionAt(trail.length)
    const vista = summitVista(terrain, trail)
    const side = new THREE.Vector3(-vista.z, 0, vista.x)
    const ground = (p: THREE.Vector3) => p.setY(meshHeight(terrain, p.x, p.z))
    return { top, vista, side, ground }
  }, [terrain, trail])
  const built = useMemo(() => (decor?.rock ? build(terrain, trail) : null), [decor, terrain, trail])
  useEffect(() => () => built?.slab.dispose(), [built])
  const { top, vista, side, ground } = frame

  // 바위 기둥·암자·성벽은 지나가지 못하게 막는다
  const obstacles = useMemo(() => {
    const list: Obstacle[] = []
    if (decor?.spire) {
      const p = top.clone().addScaledVector(side, -12).addScaledVector(vista, 6)
      list.push({ x: p.x, z: p.z, r: 2.6, height: 14 })
    }
    if (decor?.fortress) {
      const { pos, heading } = gateFrame(trail)
      const [cos, sin] = [Math.cos(heading), Math.sin(heading)]
      for (const c of FORTRESS_COLLIDERS) list.push({ ...c, x: pos.x + c.x * cos + c.z * sin, z: pos.z - c.x * sin + c.z * cos })
    }
    return list
  }, [decor, top, side, vista, trail])
  useEffect(() => {
    setObstacles('summit', obstacles)
    return () => setObstacles('summit', [])
  }, [obstacles])

  // 정상에서 멀면 꾸밈을 그리지 않는다 (충돌은 그대로). 50m 단위로만 다시 그린다
  const near = useGame((s) => Math.floor(s.distance / 50)) * 50
  const far = useMemo(() => trail.positionAt(near).distanceTo(top) > DRAW_RANGE + 50, [trail, near, top])
  if (!decor || far) return null
  const at = (v: number, s: number) => ground(top.clone().addScaledVector(vista, v).addScaledVector(side, s))
  const facing = Math.atan2(-vista.x, -vista.z) // 카메라 쪽을 본다

  return (
    <group>
      {built && (
        <>
          <mesh geometry={built.slab} receiveShadow>
            <meshStandardMaterial color={SHADES[0]} roughness={0.85} flatShading polygonOffset polygonOffsetFactor={-2} />
          </mesh>
          {built.boulders.map((b, i) => (
            <mesh key={i} position={b.pos} scale={b.scale} rotation={[0, b.rot, 0]} castShadow receiveShadow>
              <dodecahedronGeometry args={[1, 0]} />
              <meshStandardMaterial color={SHADES[i % SHADES.length]} roughness={0.9} flatShading />
            </mesh>
          ))}
        </>
      )}
      {decor.flag && (
        <group position={at(2.5, -2.2)} rotation={[0, facing, 0]}>
          <Flagpole height={4.5} />
        </group>
      )}
      {decor.railing && <Railing terrain={terrain} trail={trail} top={top} vista={vista} />}
      {decor.marker && (
        <group position={at(1.6, -1)} rotation={[0, facing, 0]}>
          <MarkerPost text={decor.marker} />
        </group>
      )}
      {decor.spire && (
        <group position={at(6, -12).add(new THREE.Vector3(0, -1, 0))}>
          {SPIRE.map((p, i) => (
            <mesh key={i} position={p.pos} scale={p.scale} rotation={[p.tilt, i * 0.8, -p.tilt]} castShadow receiveShadow>
              <dodecahedronGeometry args={[1, 0]} />
              <meshStandardMaterial color={p.color} roughness={0.95} flatShading />
            </mesh>
          ))}
        </group>
      )}
      {decor.hermitage && <Hermitage base={at(16, -3)} top={top} facing={facing} />}
      {decor.fortress && (
        <group position={gateFrame(trail).pos} rotation={[0, gateFrame(trail).heading, 0]}>
          <FortressGate />
        </group>
      )}
    </group>
  )
}

/** 산성 대문을 세울 자리: 도착 10m 앞 등산로와 그곳 진행 방향 */
const GATE_BEFORE = 10
function gateFrame(trail: Trail) {
  const d = Math.max(0, trail.length - GATE_BEFORE)
  return { pos: trail.positionAt(d), heading: trail.headingAt(d) }
}

/** 우이암: 세로로 갈라진 모난 바위 덩어리를 층층이 쌓은 바위 기둥. 아래에 작은 바위가 기대 선다 [위치, 크기, 기울기, 색] */
const SPIRE: { pos: [number, number, number]; scale: [number, number, number]; tilt: number; color: string }[] = [
  { pos: [0, 2.5, 0], scale: [2.6, 3.2, 2.2], tilt: 0.05, color: '#ada493' },
  { pos: [0.4, 6.8, -0.2], scale: [2.1, 2.8, 1.8], tilt: -0.08, color: '#b5ac9b' },
  { pos: [0.1, 10.4, 0], scale: [1.7, 2, 1.5], tilt: 0.12, color: '#bdb4a3' },
  { pos: [1.4, 4.8, 0.9], scale: [1, 2.6, 0.9], tilt: 0.1, color: '#a49b8b' },
  { pos: [-2.4, 1.6, 0.8], scale: [1.3, 1.9, 1.2], tilt: -0.15, color: '#aaa192' },
  { pos: [2.3, 1.2, -0.6], scale: [1.2, 1.5, 1.1], tilt: 0.2, color: '#a59c8d' },
  { pos: [-3.3, 0.6, 1.4], scale: [0.8, 0.9, 0.8], tilt: 0, color: '#b7ae9e' },
]

/** 풍경 쪽 반원(반지름 5m)에 선 쇠난간. 마지막 등산로를 지나는 칸은 비운다 */
function Railing({ terrain, trail, top, vista }: { terrain: Terrain; trail: Trail; top: THREE.Vector3; vista: THREE.Vector3 }) {
  const { posts, rails } = useMemo(() => {
    const approach = Array.from({ length: 30 }, (_, i) => trail.positionAt(trail.length - i))
    const base = Math.atan2(vista.z, vista.x)
    const posts: (THREE.Vector3 | null)[] = []
    for (let k = -5; k <= 5; k++) {
      const a = base + k * THREE.MathUtils.degToRad(16)
      const x = top.x + Math.cos(a) * 5
      const z = top.z + Math.sin(a) * 5
      const blocked = approach.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 1.6 ** 2)
      posts.push(blocked ? null : new THREE.Vector3(x, meshHeight(terrain, x, z) + LIFT, z))
    }
    const rails: { a: THREE.Vector3; b: THREE.Vector3 }[] = []
    for (let i = 1; i < posts.length; i++) {
      const [p, q] = [posts[i - 1], posts[i]]
      if (!p || !q) continue
      for (const h of [0.55, 1.05]) rails.push({ a: p.clone().setY(p.y + h), b: q.clone().setY(q.y + h) })
    }
    return { posts: posts.filter((p): p is THREE.Vector3 => !!p), rails }
  }, [terrain, trail, top, vista])
  return (
    <group>
      {posts.map((p, i) => (
        <mesh key={i} position={[p.x, p.y + 0.55, p.z]} castShadow>
          <cylinderGeometry args={[0.04, 0.04, 1.1, 6]} />
          <meshStandardMaterial color="#5d6166" metalness={0.4} roughness={0.5} />
        </mesh>
      ))}
      {rails.map((r, i) => (
        <Rope key={i} a={r.a} b={r.b} color="#5d6166" />
      ))}
    </group>
  )
}

/** 이름을 세로로 쓴 짙은 나무 표지목 (신선대 정상). 쇠 받침에 세운다 */
function MarkerPost({ text }: { text: string }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 320
    const g = c.getContext('2d')!
    g.fillStyle = '#2f2a25'
    g.fillRect(0, 0, 64, 320)
    g.fillStyle = '#f1ede6'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = 'bold 40px sans-serif'
    ;[...text].slice(0, 6).forEach((ch, i) => g.fillText(ch, 32, 40 + i * 48))
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [text])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <group>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[0.36, 0.4, 0.3]} />
        <meshStandardMaterial color="#4a3f36" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.15, 0]} castShadow>
        <boxGeometry args={[0.28, 1.9, 0.22]} />
        <meshStandardMaterial color="#2f2a25" roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.2, 0.112]}>
        <planeGeometry args={[0.24, 1.5]} />
        <meshStandardMaterial map={tex} roughness={0.8} />
      </mesh>
    </group>
  )
}

/**
 * 연주대 암자. 풍경 쪽 절벽 끝에 바위 기둥을 세우고, 그 위 축대에 붉은 벽과 기와지붕을 얹은 작은 암자와 연등 줄을 놓는다.
 * 절벽 아래 땅이 낮으면 바위 기둥이 그만큼 길어진다
 */
function Hermitage({ base, top, facing }: { base: THREE.Vector3; top: THREE.Vector3; facing: number }) {
  // 정상보다 몇 m 낮은 절벽 끝에 앉혀, 정상에서 내려다보이게 한다
  const floor = Math.max(base.y + 0.3, top.y - 7)
  const drop = floor - base.y + 3
  const roof = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 3, 1, false, Math.PI / 2).rotateZ(Math.PI / 2), [])
  const columns: Blob[] = [
    { pos: [-1, -drop / 2, 0], scale: [1.4, drop / 2 + 0.3, 1.3], color: '#a79e8f' },
    { pos: [0.9, -drop / 2 - 0.5, 0.3], scale: [1.2, drop / 2, 1.2], color: '#b2a998' },
    { pos: [-2.3, -drop / 2 + 0.4, 0.6], scale: [0.8, drop / 2 + 1.3, 0.8], color: '#bcb3a3' },
    { pos: [0, -drop / 2, -1.1], scale: [1.6, drop / 2 + 0.2, 1], color: '#a59c8d' },
  ]
  return (
    <group position={[base.x, floor, base.z]} rotation={[0, facing, 0]}>
      <Blobs blobs={columns} seed={63} />
      {/* 축대 */}
      <mesh position={[0, -0.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.2, 0.8, 2.6]} />
        <meshStandardMaterial color="#9f988b" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1, 0]} castShadow>
        <boxGeometry args={[2.6, 1.8, 2]} />
        <meshStandardMaterial color="#b0332c" roughness={0.7} />
      </mesh>
      <mesh geometry={roof} position={[0, 2.25, 0]} scale={[3.2, 0.7, 1.55]} castShadow>
        <meshStandardMaterial color="#3f444a" flatShading />
      </mesh>
      {/* 처마 밑 연등 */}
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={i} position={[-1.35 + i * 0.45, 1.75, 1.15]}>
          <sphereGeometry args={[0.13, 8, 6]} />
          <meshStandardMaterial color={i % 2 ? '#ff5d73' : '#ff9f1c'} emissive={i % 2 ? '#ff5d73' : '#ff9f1c'} emissiveIntensity={0.35} />
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
