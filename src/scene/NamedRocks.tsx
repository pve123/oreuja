import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { meshHeight, type Terrain, type Trail } from '../lib/data'
import { seededRandom } from '../lib/random'

/**
 * 이름 붙은 바위·봉우리·정자 모형 (src/lib/landmarks.ts 의 boulder, peak, slab, ropes, pavilion).
 * 실제 사진을 보고 생김새를 저폴리로 옮겼다. 둥근 화강암은 모두 blob() 하나를 늘이고 눌러 만든다
 */

const ROCK = ['#b3ab9f', '#a9a195', '#bcb4a7', '#a0988c']
/** 비탈에 묻힌 바닥이 떠 보이지 않게 모든 바위 밑에 까는 받침 */
const FOOTING: Blob = { pos: [0, -0.4, 0], scale: [2.6, 0.9, 2.2], color: '#9d958a' }

export type Blob = {
  pos: [number, number, number]
  scale: [number, number, number]
  rot?: [number, number, number]
  color?: string
  /** 아래(-)·위(+)를 이 높이에서 평평하게 자른다 (단위 구 기준) */
  flatBottom?: number
  flatTop?: number
}

const blobCache = new Map<string, THREE.BufferGeometry>()

/** 둥근 화강암 덩어리. 단위 구를 부드러운 물결로 울퉁불퉁하게 하고, 필요하면 위아래를 평평하게 자른다 */
function blob(seed: number, flatBottom = -2, flatTop = 2) {
  const key = `${seed}:${flatBottom}:${flatTop}`
  const hit = blobCache.get(key)
  if (hit) return hit
  const base = new THREE.IcosahedronGeometry(1, 3)
  base.deleteAttribute('normal')
  base.deleteAttribute('uv')
  const geo = mergeVertices(base)
  const rand = seededRandom(seed)
  const [a, b, c, d] = [rand() * 6, rand() * 6, rand() * 6, rand() * 6]
  const pos = geo.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const n = Math.sin(2.3 * v.x + a) * Math.sin(2.1 * v.y + b) * Math.sin(2.5 * v.z + c) * 0.1 + Math.sin(5.1 * v.x + 4.3 * v.z + d) * 0.035
    v.multiplyScalar(1 + n)
    v.y = THREE.MathUtils.clamp(v.y, flatBottom, flatTop)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  blobCache.set(key, geo)
  return geo
}

export function Blobs({ blobs, seed }: { blobs: Blob[]; seed: number }) {
  return (
    <>
      {blobs.map((b, i) => (
        <mesh key={i} geometry={blob(seed + i, b.flatBottom, b.flatTop)} position={b.pos} scale={b.scale} rotation={b.rot ?? [0, 0, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={b.color ?? ROCK[i % ROCK.length]} roughness={0.95} />
        </mesh>
      ))}
    </>
  )
}

/** 바위 겉에 팬 짙은 구멍·틈 */
const HOLLOW = '#45403a'

/** 사진을 보고 짜 맞춘 이름 붙은 바위. +z 가 등산로 쪽 정면 */
const BOULDERS: Record<string, Blob[]> = {
  // 큰 덩어리 앞면에 코가 아래로 늘어지고, 위쪽에 눈 구멍, 옆에 귀처럼 접힌 바위가 붙는다
  코끼리: [
    FOOTING,
    { pos: [0, 1.6, 0], scale: [2.6, 2.4, 2.2] },
    { pos: [-1.1, 1.9, 1.5], scale: [1, 1.5, 0.7], rot: [0, 0.3, 0.1], color: '#aaa296' },
    { pos: [0.7, 1.9, 1.95], scale: [0.55, 1.1, 0.55], color: '#b0a89c' },
    { pos: [0.85, 0.75, 2.15], scale: [0.45, 0.8, 0.45], rot: [0.3, 0, -0.15], color: '#ada599' },
    { pos: [0.2, 3, 1.85], scale: [0.16, 0.3, 0.12], color: HOLLOW },
  ],
  // 받침돌 위에 둥근 몸통이 얹히고, 오른쪽으로 머리가 쑥 나온다. 누런 빛이 돈다
  하마: [
    FOOTING,
    { pos: [-1.4, 0.35, 0.9], scale: [0.8, 0.5, 0.7], color: '#a39b8f' },
    { pos: [0.4, 0.3, 1.1], scale: [0.9, 0.45, 0.6], color: '#9d958a' },
    { pos: [1.6, 0.35, 0.4], scale: [0.7, 0.5, 0.7], color: '#a39b8f' },
    { pos: [-0.5, 1.55, 0], scale: [2.3, 1.35, 1.85], color: '#c0aa8a' },
    { pos: [1.9, 1.7, 0.2], scale: [1.25, 0.85, 1.15], rot: [0, 0, -0.1], color: '#baa485' },
    { pos: [2.7, 1.55, 0.55], scale: [0.5, 0.18, 0.4], color: HOLLOW },
  ],
  // 위가 평평한 받침 바위 위에 납작한 돌 두 개, 그 위에 밑면이 평평한 철모 바위가 앞으로 쏠려 얹힌다
  철모: [
    FOOTING,
    { pos: [0, 0.85, 0], scale: [2.8, 1.3, 2], flatTop: 0.5 },
    { pos: [-0.4, 1.62, 0.5], scale: [0.65, 0.18, 0.5], color: '#a9a195' },
    { pos: [0.7, 1.62, 0.6], scale: [0.55, 0.2, 0.45], color: '#b3ab9f' },
    { pos: [0.35, 2.3, 0], scale: [2.5, 1.5, 2], rot: [0, 0, -0.12], flatBottom: -0.35, color: '#a9a296' },
    { pos: [1.85, 2.5, 0.9], scale: [0.45, 0.38, 0.3], color: HOLLOW },
  ],
  // 위가 둥글고 넓은 거대한 바위. 앞면 아래쪽은 물때로 짙고, 뒤쪽 위에 둥근 바위가 하나 더 얹힌다
  치마: [
    { pos: [0, 0.2, -0.4], scale: [4.6, 1.3, 3.3], color: '#7f786d' },
    { pos: [0, 1.05, -0.5], scale: [4.5, 2.4, 3.2], flatTop: 0.55, color: '#bdb5a8' },
    { pos: [0.4, 3, -1.4], scale: [1.4, 1.3, 1.3], color: '#b3ab9f' },
  ],
}

/** 이름 붙은 바위. 이름에 든 낱말로 모양을 고르고, 없으면 둥근 바위 하나를 세운다 */
export function Boulder({ name, seed }: { name: string; seed: number }) {
  const key = Object.keys(BOULDERS).find((k) => name.includes(k))
  const blobs = key ? BOULDERS[key] : [FOOTING, { pos: [0, 1.4, 0], scale: [2.2, 1.9, 1.9] } satisfies Blob]
  return <Blobs blobs={blobs} seed={Math.round(seed)} />
}

/** 세로로 쓴 정상석 글씨 */
function markerTexture(name: string) {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#1d1d1f'
  g.fillRect(0, 0, 64, 256)
  g.fillStyle = '#f2f2f2'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const chars = [...name.replace(/\s.*$/, '')].slice(0, 4)
  g.font = 'bold 44px sans-serif'
  chars.forEach((ch, i) => g.fillText(ch, 32, 56 + i * 56))
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 봉우리 (수락산 도솔봉). 둥근 바위 무더기 앞에 검은 정상석을 세운다. 정상석 앞면에 봉우리 이름을 세로로 쓴다 */
export function Peak({ name, seed }: { name: string; seed: number }) {
  const label = useMemo(() => markerTexture(name.split(' ').pop() ?? name), [name])
  useEffect(() => () => label.dispose(), [label])
  return (
    <group>
      <Blobs
        seed={Math.round(seed) + 50}
        blobs={[
          { pos: [-1.5, 1.1, -0.6], scale: [1.9, 1.7, 1.7] },
          { pos: [1.7, 1.3, -0.4], scale: [1.5, 1.4, 1.4] },
          { pos: [1.85, 1.35, 0.85], scale: [1.2, 0.08, 0.3], color: HOLLOW },
          { pos: [-1.7, 0.2, 1.3], scale: [1.3, 0.5, 0.9] },
          { pos: [1.2, 0.15, 1.9], scale: [0.5, 0.25, 0.4] },
        ]}
      />
      {name.includes('국기봉') ? (
        // 관음사 국기봉: 큰 바위 꼭대기에 태극기 게양대
        <group position={[-1.4, 2.5, -0.6]}>
          <Flagpole height={4.5} />
        </group>
      ) : (
        <PeakMarker label={label} />
      )}
    </group>
  )
}

/** 봉우리 앞 검은 정상석 */
function PeakMarker({ label }: { label: THREE.Texture }) {
  return (
    <group>
      <mesh position={[0.2, 0.06, 1.3]} receiveShadow>
        <boxGeometry args={[0.7, 0.12, 0.55]} />
        <meshStandardMaterial color="#cfc9be" roughness={0.9} />
      </mesh>
      <mesh position={[0.2, 0.67, 1.3]} castShadow>
        <boxGeometry args={[0.32, 1.1, 0.22]} />
        <meshStandardMaterial color="#1d1d1f" roughness={0.5} />
      </mesh>
      <mesh position={[0.2, 0.7, 1.412]}>
        <planeGeometry args={[0.26, 1]} />
        <meshStandardMaterial map={label} roughness={0.5} />
      </mesh>
    </group>
  )
}

/** 태극기: 흰 바탕 가운데 빨강·파랑 태극, 네 귀에 검은 괘 */
function taegeukTexture() {
  const c = document.createElement('canvas')
  c.width = 192
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 192, 128)
  g.save()
  g.translate(96, 64)
  g.rotate(Math.atan2(2, 3))
  g.fillStyle = '#cd2e3a'
  g.beginPath()
  g.arc(0, 0, 32, Math.PI, 0)
  g.fill()
  g.fillStyle = '#0047a0'
  g.beginPath()
  g.arc(0, 0, 32, 0, Math.PI)
  g.fill()
  g.beginPath()
  g.arc(-16, 0, 16, 0, Math.PI * 2)
  g.fillStyle = '#cd2e3a'
  g.fill()
  g.beginPath()
  g.arc(16, 0, 16, 0, Math.PI * 2)
  g.fillStyle = '#0047a0'
  g.fill()
  g.restore()
  g.fillStyle = '#111111'
  for (const [x, y, r] of [[34, 26, -0.6], [158, 26, 0.6], [34, 102, 0.6], [158, 102, -0.6]] as const) {
    g.save()
    g.translate(x, y)
    g.rotate(r)
    for (let k = -1; k <= 1; k++) g.fillRect(-14, k * 8 - 2.5, 28, 5)
    g.restore()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 태극기를 단 게양대. 깃대 꼭대기에 금색 꼭지 */
export function Flagpole({ height }: { height: number }) {
  const tex = useMemo(() => taegeukTexture(), [])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <group>
      <mesh position={[0, height / 2, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.06, height, 8]} />
        <meshStandardMaterial color="#d9dadc" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, height + 0.08, 0]}>
        <sphereGeometry args={[0.1, 10, 8]} />
        <meshStandardMaterial color="#d4a72c" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0.68, height - 0.5, 0]} castShadow>
        <planeGeometry args={[1.3, 0.87]} />
        <meshStandardMaterial map={tex} side={THREE.DoubleSide} roughness={0.8} />
      </mesh>
    </group>
  )
}

/**
 * 바위 문 (관악산 관악문). 큰 바위 기둥 둘 위에 커다란 바위가 얹혀 그 사이로 등산로가 지나간다.
 * 왼쪽 기둥 위에는 납작한 바위가 한 장 더 얹힌다. 충돌 원은 src/lib/landmarks.ts 의 rockgate 와 맞춘다
 */
export function RockGate({ seed }: { seed: number }) {
  return (
    <Blobs
      seed={Math.round(seed) + 80}
      blobs={[
        { pos: [-2.5, 1.5, 0], scale: [1.4, 2.7, 1.7], color: '#b9ad9b' },
        { pos: [2.5, 1.3, 0.1], scale: [1.35, 2.5, 1.6], color: '#b3a796' },
        { pos: [0.2, 4.6, -0.1], scale: [3.6, 1.7, 2.1], flatBottom: -0.45, color: '#c0b29e' },
        { pos: [-2.4, 4.1, 0.6], scale: [1.6, 0.45, 1.2], color: '#bdb1a0' },
        { pos: [-3.6, 0.2, 1.2], scale: [1, 0.6, 0.9] },
        { pos: [3.5, 0.1, -1], scale: [0.9, 0.5, 0.8] },
      ]}
    />
  )
}

/** 단청 띠: 초록 바탕에 붉은 꽃무늬와 흰·파랑 줄 */
function dancheongTexture() {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 32
  const g = c.getContext('2d')!
  g.fillStyle = '#2f8f6a'
  g.fillRect(0, 0, 256, 32)
  g.fillStyle = '#e9eef0'
  g.fillRect(0, 3, 256, 2)
  g.fillRect(0, 27, 256, 2)
  g.fillStyle = '#3a6fb0'
  g.fillRect(0, 7, 256, 2)
  g.fillRect(0, 23, 256, 2)
  for (let x = 16; x < 256; x += 32) {
    g.fillStyle = '#d6453d'
    g.beginPath()
    g.arc(x, 16, 6, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#f2c14e'
    g.beginPath()
    g.arc(x, 16, 2.5, 0, Math.PI * 2)
    g.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.repeat.set(3, 1)
  return tex
}

const PAVILION_R = 1.85
/** 육각형 꼭짓점 각도 (CylinderGeometry 6각과 같은 자리) */
const HEX = Array.from({ length: 6 }, (_, i) => (i / 6) * Math.PI * 2)

/** 육각 정자 (수락산 매월정). 돌 기단 위에 붉은 기둥 여섯, 낮은 난간, 단청 띠, 귀가 들린 기와지붕과 꼭지 */
export function Pavilion() {
  const band = useMemo(() => dancheongTexture(), [])
  useEffect(() => () => band.dispose(), [band])
  const red = '#b5332e'
  const tile = '#41474e'
  return (
    <group>
      <mesh position={[0, -0.25, 0]} receiveShadow>
        <cylinderGeometry args={[2.3, 2.5, 1, 6]} />
        <meshStandardMaterial color="#b9b2a6" roughness={0.9} flatShading />
      </mesh>
      {HEX.map((a) => {
        const [x, z] = [Math.sin(a) * PAVILION_R, Math.cos(a) * PAVILION_R]
        const next = a + Math.PI / 3
        const [nx, nz] = [Math.sin(next) * PAVILION_R, Math.cos(next) * PAVILION_R]
        const len = Math.hypot(nx - x, nz - z)
        const mid: [number, number, number] = [(x + nx) / 2, 0.85, (z + nz) / 2]
        const yaw = Math.atan2(nx - x, nz - z) + Math.PI / 2
        return (
          <group key={a}>
            <mesh position={[x, 0.32, z]}>
              <cylinderGeometry args={[0.2, 0.22, 0.14, 8]} />
              <meshStandardMaterial color="#e8e6e0" />
            </mesh>
            <mesh position={[x, 1.55, z]} castShadow>
              <cylinderGeometry args={[0.12, 0.13, 2.3, 10]} />
              <meshStandardMaterial color={red} roughness={0.7} />
            </mesh>
            {/* 앞쪽 한 칸은 드나들게 비운다 */}
            {Math.abs(Math.sin(a + Math.PI / 6)) > 0.01 || Math.cos(a + Math.PI / 6) < 0 ? (
              <mesh position={mid} rotation={[0, yaw, 0]}>
                <boxGeometry args={[len - 0.2, 0.08, 0.08]} />
                <meshStandardMaterial color="#2f8f6a" />
              </mesh>
            ) : null}
          </group>
        )
      })}
      {/* 단청 띠 */}
      <mesh position={[0, 2.85, 0]}>
        <cylinderGeometry args={[1.98, 1.98, 0.4, 6, 1, true]} />
        <meshStandardMaterial map={band} side={THREE.DoubleSide} roughness={0.8} />
      </mesh>
      {/* 기와지붕: 넓고 낮은 처마 위에 가파른 지붕, 꼭대기 꼭지. 처마 귀마다 들린 끝 */}
      <mesh position={[0, 3.3, 0]} castShadow>
        <cylinderGeometry args={[2.05, 3.05, 0.5, 6]} />
        <meshStandardMaterial color={tile} roughness={0.8} flatShading />
      </mesh>
      <mesh position={[0, 4.2, 0]} castShadow>
        <coneGeometry args={[2.1, 1.3, 6]} />
        <meshStandardMaterial color={tile} roughness={0.8} flatShading />
      </mesh>
      <mesh position={[0, 4.95, 0]}>
        <sphereGeometry args={[0.16, 10, 8]} />
        <meshStandardMaterial color="#6b6f73" />
      </mesh>
      {HEX.map((a) => (
        <mesh key={a} position={[Math.sin(a) * 3.1, 3.2, Math.cos(a) * 3.1]} rotation={[Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6]}>
          <coneGeometry args={[0.12, 0.5, 5]} />
          <meshStandardMaterial color={tile} flatShading />
        </mesh>
      ))}
    </group>
  )
}

/** 지형 위로 띄우는 높이(m). 볼록한 비탈에서도 지형에 묻히지 않을 만큼 */
const SLAB_LIFT = 0.2
const SLAB_STEP = 0.6

/** 등산로를 따라 지형 위에 덮는 판. along 은 이정표 앞뒤 거리, width(s) 는 그 자리의 반폭 */
function drapeAlong(terrain: Terrain, trail: Trail, at: number, along: number, width: (s: number) => number, offset = 0, lift = SLAB_LIFT) {
  const rows = Math.round((along * 2) / SLAB_STEP)
  const cols = 8
  const positions: number[] = []
  for (let r = 0; r <= rows; r++) {
    const s = -along + (r * along * 2) / rows
    const d = THREE.MathUtils.clamp(at + s, 0, trail.length)
    const p = trail.positionAt(d)
    const h = trail.headingAt(d)
    const right = new THREE.Vector3(-Math.cos(h), 0, Math.sin(h))
    const w = width(s)
    for (let c = 0; c <= cols; c++) {
      const t = offset + (c / cols - 0.5) * 2 * w
      const x = p.x + right.x * t
      const z = p.z + right.z * t
      positions.push(x, meshHeight(terrain, x, z) + lift, z)
    }
  }
  const index: number[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c
      const b = a + cols + 1
      index.push(a, a + 1, b, a + 1, b + 1, b)
    }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

/** 등산로 at 둘레에서 왼쪽(-1)·오른쪽(1) 가운데 땅이 더 낮은 쪽 */
function lowerSide(terrain: Terrain, trail: Trail, at: number) {
  const drop = (side: number) => {
    let sum = 0
    for (let s = -10; s <= 10; s += 5) sum += beside(terrain, trail, at + s, side * 6).pos.y
    return sum
  }
  return drop(1) < drop(-1) ? 1 : -1
}

/** 등산로 위 at 에서 옆으로 t 만큼 비킨 곳 (지형 높이) */
function beside(terrain: Terrain, trail: Trail, d: number, t: number) {
  const p = trail.positionAt(d)
  const h = trail.headingAt(d)
  const x = p.x - Math.cos(h) * t
  const z = p.z + Math.sin(h) * t
  return { pos: new THREE.Vector3(x, meshHeight(terrain, x, z), z), heading: h }
}

/**
 * 등산로를 따라 까는 맨바위.
 * - 마당바위: 앞뒤 14m 를 너른 화강암 판으로 덮고, 길옆에 이름 표지판과 낮은 바위를 둔다
 * - 기차바위: 앞뒤 18m 를 좁고 밝은 바위 비탈로 덮고, 길 오른쪽에 바위 틈, 양쪽에 쇠기둥과 밧줄을 놓는다
 */
export type SlabMode = 'yard' | 'ropes' | 'ridge'

export function TrailSlab({ terrain, trail, at, name, mode }: { terrain: Terrain; trail: Trail; at: number; name: string; mode: SlabMode }) {
  const ropes = mode === 'ropes'
  const ridge = mode === 'ridge'
  const built = useMemo(() => {
    const rand = seededRandom(Math.round(at))
    const along = ropes ? 18 : ridge ? 20 : 14
    const wobble = Array.from({ length: 8 }, () => rand())
    const width = (s: number) => {
      const k = Math.min(7, Math.max(0, Math.floor(((s + along) / (along * 2)) * 8)))
      const edge = 1 - Math.max(0, Math.abs(s) / along - 0.75) * 2 // 양 끝으로 좁아진다
      return (ropes ? 2.6 : ridge ? 2.2 : 5) * (0.8 + wobble[k] * 0.35) * edge
    }
    const slab = drapeAlong(terrain, trail, at, along, width)
    const crack = ropes ? drapeAlong(terrain, trail, at, along - 2, () => 0.07, 0.8, SLAB_LIFT + 0.02) : null
    const posts: { pos: THREE.Vector3 }[] = []
    const lines: { a: THREE.Vector3; b: THREE.Vector3 }[] = []
    // 기차바위는 양쪽 밧줄, 능선은 낭떠러지 쪽(더 낮은 쪽) 한쪽에 쇠줄 난간
    const ropeSides = ropes ? [-1.5, 1.5] : ridge ? [lowerSide(terrain, trail, at) * 1.4] : []
    {
      for (const side of ropeSides) {
        let prev: THREE.Vector3 | null = null
        for (let s = -along + 2; s <= along - 2; s += 3) {
          const top = beside(terrain, trail, at + s, side).pos.add(new THREE.Vector3(0, SLAB_LIFT + 0.9, 0))
          posts.push({ pos: top.clone().add(new THREE.Vector3(0, -0.45, 0)) })
          if (prev) lines.push({ a: prev, b: top })
          prev = top
        }
      }
    }
    const sign = mode !== 'yard' ? null : beside(terrain, trail, at, width(0) * 0.7 + 0.8)
    const stones = mode !== 'yard'
      ? []
      : [-8, -3, 5, 9].map((s, i) => {
          const b = beside(terrain, trail, at + s, (i % 2 ? -1 : 1) * (width(s) - 0.4))
          return { pos: b.pos, size: 0.5 + rand() * 0.5, rot: rand() * 3 }
        })
    return { slab, crack, posts, lines, sign, stones }
  }, [terrain, trail, at, ropes, ridge, mode])
  useEffect(
    () => () => {
      built.slab.dispose()
      built.crack?.dispose()
    },
    [built],
  )

  return (
    <group>
      <mesh geometry={built.slab} receiveShadow>
        <meshStandardMaterial color={ropes ? '#bab3a6' : ridge ? '#aaa397' : '#b4ada0'} roughness={0.85} flatShading polygonOffset polygonOffsetFactor={-2} />
      </mesh>
      {built.crack && (
        <mesh geometry={built.crack}>
          <meshStandardMaterial color={HOLLOW} roughness={1} polygonOffset polygonOffsetFactor={-4} />
        </mesh>
      )}
      {built.posts.map((p, i) => (
        <mesh key={i} position={p.pos} castShadow>
          <cylinderGeometry args={[0.035, 0.035, 0.9, 6]} />
          <meshStandardMaterial color="#8a8f94" metalness={0.4} roughness={0.5} />
        </mesh>
      ))}
      {built.lines.map((l, i) => (
        <Rope key={i} a={l.a} b={l.b} />
      ))}
      {built.stones.map((s, i) => (
        <mesh key={i} geometry={blob(Math.round(at) + i)} position={s.pos} scale={[s.size * 1.4, s.size * 0.6, s.size]} rotation={[0, s.rot, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={ROCK[i % ROCK.length]} roughness={0.95} />
        </mesh>
      ))}
      {built.sign && (
        <group position={built.sign.pos} rotation={[0, built.sign.heading + Math.PI / 2, 0]}>
          <SlabSign name={name} />
        </group>
      )}
    </group>
  )
}

/** 두 기둥 꼭대기를 잇는 밧줄 */
export function Rope({ a, b, color = '#e8e4da' }: { a: THREE.Vector3; b: THREE.Vector3; color?: string }) {
  const { mid, len, quat } = useMemo(() => {
    const dir = b.clone().sub(a)
    return {
      mid: a.clone().add(b).multiplyScalar(0.5),
      len: dir.length(),
      quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()),
    }
  }, [a, b])
  return (
    <mesh position={mid} quaternion={quat}>
      <cylinderGeometry args={[0.025, 0.025, len, 5]} />
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
  )
}

/** 마당바위 길옆 이름 표지판: 기둥에 짙은 판, 흰 글씨 */
function SlabSign({ name }: { name: string }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 192
    const g = c.getContext('2d')!
    g.fillStyle = '#3b2f26'
    g.fillRect(0, 0, 64, 192)
    g.fillStyle = '#f4efe6'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = 'bold 38px sans-serif'
    ;[...name].slice(0, 4).forEach((ch, i) => g.fillText(ch, 32, 30 + i * 44))
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [name])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <group>
      <mesh position={[0, 0.9, 0]} castShadow>
        <boxGeometry args={[0.14, 1.8, 0.14]} />
        <meshStandardMaterial color="#4a3a2c" />
      </mesh>
      <mesh position={[0, 1.15, 0.08]}>
        <planeGeometry args={[0.36, 1.08]} />
        <meshStandardMaterial map={tex} />
      </mesh>
    </group>
  )
}
