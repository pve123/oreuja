import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { Terrain, Trail } from '../lib/data'
import { FORTRESS, LANDMARK_ICON, landmarks, type Landmark } from '../lib/landmarks'
import { setObstacles } from '../lib/obstacles'
import { seededRandom } from '../lib/random'
import { useGame } from '../lib/store'
import { Boulder, Pavilion, Peak, RockGate, TrailSlab } from './NamedRocks'

const LABEL_RANGE = 300 // 이 거리 안의 랜드마크만 이름을 띄운다(m)


/** 이정표마다 이름에 맞는 랜드마크(돌탑, 암자, 산장, 성문, 폭포…)를 세우고, 가까운 것만 이름을 띄운다 */
export function Landmarks({ terrain, trail }: { terrain: Terrain; trail: Trail }) {
  const list = useMemo(() => landmarks(terrain, trail), [terrain, trail])
  // 50m 단위로만 다시 그려서 걸을 때마다 렌더링하지 않게 한다
  const near = useGame((s) => Math.floor(s.distance / 50)) * 50

  useEffect(() => {
    setObstacles(
      'landmarks',
      list.flatMap((l) => l.colliders),
    )
    return () => setObstacles('landmarks', [])
  }, [list])

  return (
    <group>
      {/* 마당바위·기차바위·능선은 등산로를 따라 지형 위에 까는 바위라 세계 좌표로 그린다 */}
      {list
        .filter((l) => l.kind === 'slab' || l.kind === 'ropes' || l.kind === 'ridge')
        .map((l) => (
          <TrailSlab
            key={`${l.name}-slab`}
            terrain={terrain}
            trail={trail}
            at={l.distance}
            name={l.name}
            mode={l.kind === 'ropes' ? 'ropes' : l.kind === 'ridge' ? 'ridge' : 'yard'}
          />
        ))}
      {list.map((l) => (
        <group key={l.name} position={l.position} rotation={[0, l.rotation, 0]}>
          <LandmarkBody landmark={l} trail={trail} />
          {Math.abs(l.distance - near) < LABEL_RANGE && (
            <Html position={[0, l.label, 0]} center distanceFactor={16} zIndexRange={[10, 0]}>
              <div className="landmark-label">
                <span className="landmark-icon" aria-hidden>
                  {LANDMARK_ICON[l.kind]}
                </span>
                {l.name}
              </div>
            </Html>
          )}
        </group>
      ))}
    </group>
  )
}

function LandmarkBody({ landmark, trail }: { landmark: Landmark; trail: Trail }) {
  switch (landmark.kind) {
    case 'cairn':
      return <Cairn seed={landmark.distance} />
    case 'pass':
      return (
        <>
          <group position={[-0.9, 0, 0]}>
            <Cairn seed={landmark.distance} />
          </group>
          <Bench position={[1.3, 0, 0.2]} />
        </>
      )
    case 'temple':
      return <Temple />
    case 'hut':
      return <Hut twoStory={landmark.name.includes('대피소')} />
    case 'gate':
      return <Gate />
    case 'ruins':
      return <Ruins seed={landmark.distance} />
    case 'waterfall':
      return <Waterfall />
    case 'boulder':
      return <Boulder name={landmark.name} seed={landmark.distance} />
    case 'peak':
      return <Peak name={landmark.name} seed={landmark.distance} />
    case 'pavilion':
      return <Pavilion />
    case 'rockgate':
      return <RockGate seed={landmark.distance} />
    case 'slab':
    case 'ropes':
    case 'ridge':
      return null
    case 'junction':
      return <Junction />
    case 'spring':
      return <Spring />
    case 'trailhead':
      return <Trailhead mountain={trail.data.mountain} park={trail.data.park} />
    default:
      return <Signpost />
  }
}

/** 색만 다른 표준 재질 */
function Std({ color, ...rest }: { color: string } & Partial<THREE.MeshStandardMaterialParameters>) {
  return <meshStandardMaterial color={color} roughness={0.9} {...rest} />
}

const GRANITE = ['#b9b2a6', '#a8a197', '#c4bdb0', '#9d978d']

/** 납작한 돌을 크기 순으로 쌓은 돌탑. 둘레에 작은 돌을 흩어 둔다 */
function Cairn({ seed }: { seed: number }) {
  const stones = useMemo(() => {
    const rand = seededRandom(Math.round(seed))
    const out: { pos: [number, number, number]; scale: [number, number, number]; rot: number; color: string }[] = []
    let y = 0
    for (let i = 0; i < 7; i++) {
      const w = 0.75 - i * 0.085
      const h = 0.18 + rand() * 0.06
      out.push({
        pos: [(rand() - 0.5) * 0.08, y + h * 0.8, (rand() - 0.5) * 0.08],
        scale: [w, h, w * (0.8 + rand() * 0.3)],
        rot: rand() * Math.PI,
        color: GRANITE[i % GRANITE.length],
      })
      y += h * 1.5
    }
    // 둘레에 작은 돌
    for (let i = 0; i < 6; i++) {
      const a = rand() * Math.PI * 2
      const r = 0.9 + rand() * 0.5
      const s = 0.12 + rand() * 0.12
      out.push({ pos: [Math.cos(a) * r, s * 0.5, Math.sin(a) * r], scale: [s, s * 0.6, s], rot: rand() * Math.PI, color: GRANITE[i % GRANITE.length] })
    }
    return out
  }, [seed])

  return (
    <group>
      {stones.map((s, i) => (
        <mesh key={i} position={s.pos} scale={s.scale} rotation={[0, s.rot, 0]} castShadow receiveShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Std color={s.color} flatShading />
        </mesh>
      ))}
    </group>
  )
}

/** 숨 고르는 나무 벤치 */
function Bench({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.4, 0.08, 0.42]} />
        <Std color="#9a6b43" />
      </mesh>
      {[-0.55, 0.55].map((x) => (
        <mesh key={x} position={[x, 0.22, 0]} castShadow>
          <boxGeometry args={[0.1, 0.44, 0.36]} />
          <Std color="#6b4a2f" />
        </mesh>
      ))}
    </group>
  )
}

const LANTERN_COLORS = ['#ff5d73', '#ffd166', '#06d6a0', '#ff9f1c', '#c77dff', '#4cc9f0']

/** 작은 암자: 돌 기단, 붉은 기둥, 단청 띠, 기와 지붕, 처마 밑 연등 */
function Temple() {
  // 사각뿔을 눕혀 늘린 우진각 지붕
  const roof = useMemo(() => new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4), [])
  const lantern = useRef<THREE.Group>(null!)
  useFrame(({ clock }) => {
    // 연등이 바람에 조금씩 흔들린다
    lantern.current.children.forEach((c, i) => {
      c.rotation.z = Math.sin(clock.elapsedTime * 1.6 + i) * 0.12
    })
  })

  return (
    <group>
      {/* 비탈에 묻히는 기단 */}
      <mesh position={[0, -0.8, 0]} castShadow receiveShadow>
        <boxGeometry args={[4.8, 2, 3.8]} />
        <Std color="#a59e92" />
      </mesh>
      <mesh position={[0, 0.25, 1.95]} receiveShadow>
        <boxGeometry args={[1.6, 0.12, 0.5]} />
        <Std color="#958e83" />
      </mesh>
      {/* 기둥 */}
      {[-1.8, -0.6, 0.6, 1.8].flatMap((x) =>
        [-1.3, 1.3].map((z) => (
          <mesh key={`${x},${z}`} position={[x, 1.3, z]} castShadow>
            <cylinderGeometry args={[0.13, 0.15, 2.2, 10]} />
            <Std color="#a33a2a" />
          </mesh>
        )),
      )}
      {/* 벽 (뒤·옆) 과 문살 */}
      <mesh position={[0, 1.3, -1.2]}>
        <boxGeometry args={[3.6, 2.2, 0.1]} />
        <Std color="#efe3c8" />
      </mesh>
      <mesh position={[0, 1.2, 1.25]}>
        <boxGeometry args={[2.2, 1.9, 0.06]} />
        <Std color="#c8a46b" />
      </mesh>
      {/* 단청 띠 */}
      <mesh position={[0, 2.5, 0]} castShadow>
        <boxGeometry args={[4.2, 0.28, 3]} />
        <Std color="#2f7d6d" />
      </mesh>
      {/* 기와 지붕 */}
      <mesh geometry={roof} position={[0, 3.3, 0]} scale={[3.8, 1.5, 3]} castShadow>
        <Std color="#3d4756" flatShading />
      </mesh>
      {/* 처마 밑 연등 */}
      <group ref={lantern}>
        {LANTERN_COLORS.map((c, i) => (
          <group key={c} position={[-1.75 + i * 0.7, 2.3, 1.75]}>
            <mesh position={[0, -0.25, 0]}>
              <sphereGeometry args={[0.16, 12, 10]} />
              <Std color={c} emissive={c} emissiveIntensity={0.35} />
            </mesh>
            <mesh position={[0, -0.05, 0]}>
              <cylinderGeometry args={[0.005, 0.005, 0.2]} />
              <Std color="#333" />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  )
}

/** 막돌을 쌓은 벽 무늬 (백운산장). 크기가 제각각인 밝은 화강암 돌 사이에 회색 줄눈이 보인다. 한 장이 2.5m */
function rubbleTexture() {
  return canvasTexture(256, 256, (g) => {
    const rand = seededRandom(29)
    g.fillStyle = '#8f897e'
    g.fillRect(0, 0, 256, 256)
    let y = 0
    while (y < 256) {
      const h = Math.min(26 + rand() * 22, 256 - y)
      let x = 0
      while (x < 256) {
        let w = 34 + rand() * 46
        if (256 - x - w < 24) w = 256 - x
        const shade = 196 + Math.round(rand() * 34)
        g.fillStyle = `rgb(${shade + 4},${shade},${shade - 12})`
        g.beginPath()
        g.roundRect(x + 2 + rand() * 2, y + 2 + rand() * 2, w - 5, h - 5, 6)
        g.fill()
        x += w
      }
      y += h
    }
  })
}

/** 대피소 2층 높이(m) */
const UPPER_FLOOR = 2.6

/**
 * 돌 산장 (북한산 백운산장). 막돌을 쌓은 벽에 처마가 넓은 낮은 박공지붕을 얹고,
 * 앞면에 나무 문틀을 댄 유리문 두 짝과 창을 낸다. 문 앞에 벤치를 둔다.
 * twoStory 면 대피소(도봉산대피소)처럼 막돌 1층 위에 흰 창이 줄지은 연두색 2층을 얹고 그 위에 지붕을 올린다
 */
function Hut({ twoStory = false }: { twoStory?: boolean }) {
  // 단면이 삼각형인 기둥을 눕혀 박공지붕을 만든다 (꼭짓점 하나가 위로)
  const roof = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 3, 1, false, Math.PI / 2).rotateZ(Math.PI / 2), [])
  const stone = useMemo(() => {
    const tex = rubbleTexture()
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(2, 1.1)
    return tex
  }, [])
  useEffect(() => () => stone.dispose(), [stone])

  return (
    <group>
      <mesh position={[0, -0.6, 0]} receiveShadow>
        <boxGeometry args={[5.6, 1.4, 4.6]} />
        <Std color="#8e877c" />
      </mesh>
      <mesh position={[0, 1.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[5, 2.8, 4]} />
        <Std color="#ffffff" map={stone} />
      </mesh>
      {twoStory && (
        <group position={[0, 2.8, 0]}>
          <mesh position={[0, UPPER_FLOOR / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[5, UPPER_FLOOR, 4]} />
            <Std color="#cfe0c4" />
          </mesh>
          {/* 층 사이 콘크리트 띠와 2층 흰 창 */}
          <mesh position={[0, 0.05, 0]}>
            <boxGeometry args={[5.2, 0.2, 4.2]} />
            <Std color="#a9a69e" />
          </mesh>
          {[-1.6, -0.55, 0.5, 1.55].map((x) => (
            <mesh key={x} position={[x, 1.2, 2.02]}>
              <boxGeometry args={[0.9, 0.8, 0.05]} />
              <Std color="#9fb6c0" roughness={0.2} metalness={0.3} />
            </mesh>
          ))}
          <mesh position={[0, 1.2, 2.04]}>
            <boxGeometry args={[4.3, 0.06, 0.03]} />
            <Std color="#f2f2f0" />
          </mesh>
        </group>
      )}
      {/* 낮은 지붕과 앞뒤로 길게 나온 처마 */}
      <group position={[0, twoStory ? UPPER_FLOOR : 0, 0]}>
        <mesh geometry={roof} position={[0, 3.12, 0]} scale={[5.9, 0.62, 3.3]} castShadow>
          <Std color="#4a3428" flatShading />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[0, 2.84, s * 2.82]} rotation={[s * 0.2, 0, 0]}>
            <boxGeometry args={[5.9, 0.16, 0.08]} />
            <Std color="#3b2a20" />
          </mesh>
        ))}
      </group>
      {/* 나무 문틀을 댄 유리문 두 짝과 창 */}
      {[-1.55, -0.55].map((x) => (
        <group key={x} position={[x, 1.05, 2.03]}>
          <mesh>
            <boxGeometry args={[0.9, 2.1, 0.06]} />
            <Std color="#6b4a2f" />
          </mesh>
          <mesh position={[0, 0.05, 0.02]}>
            <boxGeometry args={[0.68, 1.8, 0.04]} />
            <Std color="#a9c2cc" roughness={0.15} metalness={0.3} />
          </mesh>
        </group>
      ))}
      <group position={[1.4, 1.55, 2.03]}>
        <mesh>
          <boxGeometry args={[1.5, 1.1, 0.06]} />
          <Std color="#6b4a2f" />
        </mesh>
        <mesh position={[0, 0, 0.02]}>
          <boxGeometry args={[1.3, 0.9, 0.04]} />
          <Std color="#a9c2cc" roughness={0.15} metalness={0.3} />
        </mesh>
      </group>
      <Bench position={[1.2, 0, 2.9]} />
    </group>
  )
}

/** 성문 문구멍 반폭과 높이(m). 북한산성 위문처럼 위가 평평한 네모 문 */
const GATE_HALF = 1.3
const GATE_TOP = 3

/** 성문 단면: 네모 문구멍이 뚫린 벽 (가운데가 등산로). 바닥은 비탈에 묻히게 2m 내린다 */
function gateShape() {
  const s = new THREE.Shape()
  s.moveTo(-3.5, -2)
  s.lineTo(-GATE_HALF, -2)
  s.lineTo(-GATE_HALF, GATE_TOP)
  s.lineTo(GATE_HALF, GATE_TOP)
  s.lineTo(GATE_HALF, -2)
  s.lineTo(3.5, -2)
  s.lineTo(3.5, 4.6)
  s.lineTo(-3.5, 4.6)
  s.closePath()
  return new THREE.ExtrudeGeometry(s, { depth: 2.6, bevelEnabled: false }).translate(0, 0, -1.3)
}

/** 화강암 마름돌을 줄 맞춰 쌓은 벽 무늬. 한 장이 2.4m 이고, 줄마다 돌 너비와 밝기가 조금씩 다르다 */
function ashlarTexture() {
  const tex = canvasTexture(256, 256, (g) => {
    const rand = seededRandom(17)
    g.fillStyle = '#a69e8e'
    g.fillRect(0, 0, 256, 256)
    const rows = [66, 60, 68, 62]
    let y = 0
    for (const h of rows) {
      let x = 0
      while (x < 256) {
        // 남은 폭이 좁으면 마지막 돌에 합쳐 무늬 이음매에 가는 돌이 생기지 않게 한다
        let w = 70 + rand() * 60
        if (256 - x - w < 60) w = 256 - x
        const shade = 200 + Math.round(rand() * 30)
        g.fillStyle = `rgb(${shade + 8},${shade},${shade - 18})`
        g.fillRect(x + 1.5, y + 1.5, w - 3, h - 3)
        x += w
      }
      y += h
    }
  })
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(1 / 2.4, 1 / 2.4)
  return tex
}

/**
 * 돌 성문 (북한산성 백운봉암문). 마름돌 벽에 위가 평평한 네모 문이 뚫려 있고, 문 둘레에 큰 문설주와 상인방 돌을 댄다.
 * 문 안쪽에는 한 단 좁은 문틀이 한 번 더 있다. 벽 양옆은 큰 자연 바위에 기대어 있고, 문 앞에 안내판이 선다
 */
function Gate() {
  const wall = useMemo(() => gateShape(), [])
  const ashlar = useMemo(() => ashlarTexture(), [])
  return (
    <group>
      <mesh geometry={wall} castShadow receiveShadow>
        <Std color="#ffffff" map={ashlar} />
      </mesh>
      {/* 앞뒤 면의 문설주와 상인방 */}
      {[-1.33, 1.33].map((z) => (
        <group key={z}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * (GATE_HALF + 0.25), GATE_TOP / 2 - 0.5, z]} castShadow>
              <boxGeometry args={[0.5, GATE_TOP + 1, 0.08]} />
              <Std color="#c2bbae" flatShading />
            </mesh>
          ))}
          <mesh position={[0, GATE_TOP + 0.32, z]} castShadow>
            <boxGeometry args={[GATE_HALF * 2 + 1.1, 0.64, 0.1]} />
            <Std color="#bab3a6" flatShading />
          </mesh>
        </group>
      ))}
      {/* 문 안쪽의 좁은 문틀 */}
      <mesh position={[0, GATE_TOP - 0.15, 0]}>
        <boxGeometry args={[GATE_HALF * 2, 0.3, 0.8]} />
        <Std color="#9f988c" flatShading />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (GATE_HALF - 0.08), GATE_TOP / 2 - 1, 0]}>
          <boxGeometry args={[0.16, GATE_TOP + 2, 0.8]} />
          <Std color="#9f988c" flatShading />
        </mesh>
      ))}
      {/* 벽 위로 들쭉날쭉 남은 맨 윗줄 돌 */}
      {[-3.1, -2.2, -1.2, -0.3, 0.7, 1.6, 2.6].map((x, i) => (
        <mesh key={x} position={[x, 4.6 + (0.18 + (i % 3) * 0.06) / 2, 0]} castShadow>
          <boxGeometry args={[0.86, 0.18 + (i % 3) * 0.06, 2.5]} />
          <Std color={GRANITE[i % GRANITE.length]} flatShading />
        </mesh>
      ))}
      {/* 벽이 기댄 자연 바위. 비탈 아래로 깊이 묻어 떠 보이지 않게 한다 */}
      {GATE_ROCKS.map((r, i) => (
        <mesh key={i} position={r.pos} scale={r.scale} rotation={[0.2 * i, 0.9 * i, 0.1]} castShadow receiveShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Std color={GRANITE[(i + 2) % GRANITE.length]} flatShading />
        </mesh>
      ))}
      {/* 문 앞 안내판. 북한산 위문은 등산로가 벽을 따라 왼쪽에서 와서 꺾여 들어오므로 오른쪽에 세운다 */}
      <mesh position={[2.1, 0.9, -1.9]} rotation={[0, -0.35, 0]} castShadow>
        <boxGeometry args={[0.55, 1.9, 0.08]} />
        <Std color="#4a4a48" />
      </mesh>
    </group>
  )
}

const { half: FORT_HALF, spring: FORT_SPRING, wall: FORT_WALL, top: FORT_TOP, depth: FORT_DEPTH } = FORTRESS

/** 산성 대문 성벽 단면: 홍예 문구멍이 뚫린 긴 벽. 바닥은 비탈에 묻히게 2m 내린다 */
function fortressShape() {
  const s = new THREE.Shape()
  s.moveTo(-FORT_WALL, -2)
  s.lineTo(-FORT_HALF, -2)
  s.lineTo(-FORT_HALF, FORT_SPRING)
  s.absarc(0, FORT_SPRING, FORT_HALF, Math.PI, 0, true)
  s.lineTo(FORT_HALF, -2)
  s.lineTo(FORT_WALL, -2)
  s.lineTo(FORT_WALL, FORT_TOP)
  s.lineTo(-FORT_WALL, FORT_TOP)
  s.closePath()
  return new THREE.ExtrudeGeometry(s, { depth: FORT_DEPTH, bevelEnabled: false, curveSegments: 16 }).translate(0, 0, -FORT_DEPTH / 2)
}

/**
 * 산성 대문 (북한산성 대동문). 마름돌 성벽에 홍예 문이 뚫리고, 성벽 위에는 흰 여장이 늘어서며,
 * 문 위에는 붉은 기둥과 단청 띠, 우진각 기와지붕을 얹은 문루가 선다. 문루 앞에 「大東門」 현판을 단다
 */
export function FortressGate() {
  const wall = useMemo(() => fortressShape(), [])
  const ashlar = useMemo(() => ashlarTexture(), [])
  useEffect(() => () => ashlar.dispose(), [ashlar])
  const hip = useMemo(() => new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4), [])
  const board = useMemo(
    () =>
      canvasTexture(192, 64, (g) => {
        g.fillStyle = '#1f1d1b'
        g.fillRect(0, 0, 192, 64)
        g.fillStyle = '#f1e6c8'
        g.font = 'bold 40px serif'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText('大東門', 96, 34)
      }),
    [],
  )
  useEffect(() => () => board.dispose(), [board])
  const red = '#a8322c'
  const tile = '#3f444a'
  return (
    <group>
      <mesh geometry={wall} castShadow receiveShadow>
        <Std color="#ffffff" map={ashlar} />
      </mesh>
      {/* 여장: 앞뒤 가장자리에 흰 담을 늘어세우고 사이를 조금씩 띄운다. 문루 자리는 비운다 */}
      {[-1, 1].flatMap((side) =>
        Array.from({ length: 10 }, (_, i) => -FORT_WALL + 0.9 + i * 1.9)
          .filter((x) => Math.abs(x) > 3.3)
          .map((x) => (
            <mesh key={`${side}:${x}`} position={[x, FORT_TOP + 0.45, side * (FORT_DEPTH / 2 - 0.25)]} castShadow>
              <boxGeometry args={[1.6, 0.9, 0.45]} />
              <Std color="#e8e6df" />
            </mesh>
          )),
      )}
      {/* 문루 */}
      <group position={[0, FORT_TOP, 0]}>
        <mesh position={[0, 0.1, 0]} receiveShadow>
          <boxGeometry args={[6, 0.2, 3.4]} />
          <Std color="#9d968a" />
        </mesh>
        {[-2.4, -0.8, 0.8, 2.4].flatMap((x) =>
          [-1.15, 1.15].map((z) => (
            <mesh key={`${x}:${z}`} position={[x, 1.25, z]} castShadow>
              <cylinderGeometry args={[0.14, 0.15, 2.1, 10]} />
              <Std color={red} roughness={0.7} />
            </mesh>
          )),
        )}
        <mesh position={[0, 2.45, 0]}>
          <boxGeometry args={[5.4, 0.4, 2.7]} />
          <Std color="#2f8f6a" />
        </mesh>
        <mesh position={[0, 2.45, 1.37]}>
          <planeGeometry args={[1.5, 0.5]} />
          <Std color="#ffffff" map={board} />
        </mesh>
        <mesh position={[0, 2.75, 0]} castShadow>
          <boxGeometry args={[7, 0.18, 4.2]} />
          <Std color={tile} flatShading />
        </mesh>
        <mesh geometry={hip} position={[0, 3.45, 0]} scale={[4.6, 1.3, 2.9]} castShadow>
          <Std color={tile} flatShading />
        </mesh>
      </group>
    </group>
  )
}

/** 성문 양옆 바위 [위치, 크기]. src/lib/landmarks.ts 의 gate 충돌 원과 맞춘다 */
const GATE_ROCKS: { pos: [number, number, number]; scale: [number, number, number] }[] = [
  { pos: [-4.7, 1.2, 0.2], scale: [1.6, 3.4, 1.9] },
  { pos: [-3.9, 0.1, 2], scale: [1, 1.4, 1] },
  { pos: [4.8, 1.5, -0.1], scale: [1.8, 3.8, 2.1] },
  { pos: [4, 0.4, 2], scale: [1.1, 1.8, 1.1] },
]

/** 무너진 성벽 터: 길 양옆에 높이가 들쭉날쭉한 돌무더기 */
function Ruins({ seed }: { seed: number }) {
  const blocks = useMemo(() => {
    const rand = seededRandom(Math.round(seed) + 3)
    const out: { pos: [number, number, number]; size: [number, number, number]; rot: number; color: string }[] = []
    for (const side of [-1, 1])
      for (let i = 0; i < 4; i++) {
        const h = 0.4 + rand() * 0.7
        out.push({
          pos: [side * (1.7 + i * 0.75), h / 2 - 0.1, (rand() - 0.5) * 0.2],
          size: [0.72, h, 1 + rand() * 0.3],
          rot: (rand() - 0.5) * 0.15,
          color: GRANITE[Math.floor(rand() * GRANITE.length)],
        })
        // 무너져 굴러 떨어진 돌
        if (rand() < 0.6) {
          const s = 0.25 + rand() * 0.2
          out.push({ pos: [side * (1.8 + rand() * 2), s / 2 - 0.05, 0.9 + rand() * 0.6], size: [s, s, s], rot: rand() * 3, color: GRANITE[0] })
        }
      }
    return out
  }, [seed])

  return (
    <group>
      {blocks.map((b, i) => (
        <mesh key={i} position={b.pos} rotation={[0, b.rot, 0]} castShadow receiveShadow>
          <boxGeometry args={b.size} />
          <Std color={b.color} flatShading />
        </mesh>
      ))}
    </group>
  )
}

/** 흘러내리는 물결 무늬 (세로 줄무늬를 위아래로 흐린 그림) */
function waterTexture() {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#d8f1ff'
  g.fillRect(0, 0, 64, 256)
  const rand = seededRandom(5)
  for (let i = 0; i < 40; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.9)' : 'rgba(120,190,230,0.6)'
    g.fillRect(rand() * 64, rand() * 256, 2 + rand() * 4, 20 + rand() * 60)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 물줄기 면: 위는 좁고 아래로 갈수록 넓게 퍼진다 */
function fallGeometry() {
  const geo = new THREE.PlaneGeometry(1, 1, 1, 8)
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const t = 0.5 - pos.getY(i) // 위 0, 아래 1
    pos.setX(i, pos.getX(i) * (0.9 + t * 1.6))
  }
  return geo
}

/** 너럭바위 둘레를 감싸는 바위 [위치, 크기] */
const FALL_ROCKS: { pos: [number, number, number]; scale: [number, number, number] }[] = [
  { pos: [-3.4, 0.9, -2], scale: [1.9, 1.5, 1.8] },
  { pos: [3.3, 1.1, -2.4], scale: [1.8, 1.7, 1.9] },
  { pos: [-3, 3.1, -4.5], scale: [1.7, 1.6, 1.7] },
  { pos: [3.1, 3.4, -4.8], scale: [1.6, 1.5, 1.6] },
  { pos: [0, 5, -6.4], scale: [3.6, 1.1, 2] },
]

/**
 * 폭포 (북한산 개연폭포). 매끈하게 비스듬한 너른 화강암 너럭바위를 타고 물줄기가 미끄러져 내려 얕은 물웅덩이에 고인다.
 * 물이 흐르는 자리는 젖어서 짙고, 너럭바위 양옆과 위를 큰 바위가 감싸며, 웅덩이 둘레에는 납작한 바위가 깔린다
 */
function Waterfall() {
  const tex = useMemo(() => waterTexture(), [])
  useEffect(() => () => tex.dispose(), [tex])
  const fall = useMemo(() => fallGeometry(), [])
  const water = useRef<THREE.Mesh>(null!)
  useFrame((_, dt) => {
    // 물결 무늬를 아래로 흘린다
    const map = (water.current.material as THREE.MeshStandardMaterial).map
    if (map) map.offset.y += dt * 1.2
  })
  // 너럭바위 윗면: 뒤쪽 위에서 웅덩이까지 비스듬히 내려온다. 물줄기는 그 바로 위를 흐른다
  const top = new THREE.Vector3(0, 4.7, -5.6)
  const bottom = new THREE.Vector3(0, 0.1, -0.8)
  const length = top.distanceTo(bottom)
  const slope = Math.atan2(top.y - bottom.y, bottom.z - top.z)

  return (
    <group>
      <group position={[(top.x + bottom.x) / 2, (top.y + bottom.y) / 2, (top.z + bottom.z) / 2]} rotation={[-(Math.PI / 2 - slope), 0, 0]}>
        {/* 너럭바위 (아래로 깊이 묻는다) */}
        <mesh position={[0, -0.4, -0.75]} castShadow receiveShadow>
          <boxGeometry args={[6.4, length + 1.4, 1.5]} />
          <Std color="#b3a897" flatShading />
        </mesh>
        {/* 젖은 자리와 물줄기 */}
        <mesh position={[0, 0, 0.01]} scale={[1.7, length, 1]} geometry={fall}>
          <Std color="#6f675c" />
        </mesh>
        <mesh ref={water} position={[0, 0, 0.04]} scale={[1.1, length, 1]} geometry={fall}>
          <meshStandardMaterial map={tex} transparent opacity={0.85} roughness={0.2} side={THREE.DoubleSide} />
        </mesh>
      </group>
      {FALL_ROCKS.map((r, i) => (
        <mesh key={i} position={r.pos} scale={r.scale} rotation={[0.3 * i, 0.7 * i, 0.15]} castShadow receiveShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <Std color={['#a69b8a', '#b9ae9d', '#a1978a', '#ada291', '#9f9586'][i]} flatShading />
        </mesh>
      ))}
      {/* 얕은 물웅덩이와 물보라 */}
      <mesh position={[0, 0.06, 0.6]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.5, 1, 1]} receiveShadow>
        <circleGeometry args={[2, 28]} />
        <meshStandardMaterial color="#6fa9bf" roughness={0.1} metalness={0.2} transparent opacity={0.8} />
      </mesh>
      {[-0.5, 0.4, 0].map((x, i) => (
        <mesh key={i} position={[x, 0.2 + i * 0.08, -0.4 + i * 0.15]}>
          <sphereGeometry args={[0.3 + i * 0.08, 10, 8]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      ))}
      {/* 웅덩이 둘레 납작한 바위 */}
      {Array.from({ length: 7 }, (_, i) => {
        const a = Math.PI * (0.05 + (i / 6) * 0.9) // 앞쪽 반원
        return (
          <mesh key={i} position={[Math.cos(a) * 3.3, 0.08, 0.6 + Math.sin(a) * 2.3]} rotation={[0, a, 0]} scale={[0.8, 0.22, 0.55]}>
            <dodecahedronGeometry args={[1, 0]} />
            <Std color={GRANITE[i % GRANITE.length]} flatShading />
          </mesh>
        )
      })}
    </group>
  )
}

/** 이름에 맞는 랜드마크가 없을 때의 나무 표지판 */
function Signpost(): ReactNode {
  return (
    <group>
      <mesh position={[0, 1.1, 0]} castShadow>
        <boxGeometry args={[0.14, 2.2, 0.14]} />
        <Std color="#6b4a2f" />
      </mesh>
      <mesh position={[0, 1.95, 0]} castShadow>
        <boxGeometry args={[1.3, 0.38, 0.06]} />
        <Std color="#a0794f" />
      </mesh>
    </group>
  )
}

/** 갈림길 이정표: 기둥 하나에 화살표 판 세 장이 높이와 방향을 달리해 붙는다 */
function Junction() {
  return (
    <group>
      <mesh position={[0, 1.2, 0]} castShadow>
        <boxGeometry args={[0.14, 2.4, 0.14]} />
        <Std color="#6b4a2f" />
      </mesh>
      {[
        [2.05, 0.2],
        [1.7, 2.3],
        [1.35, -2],
      ].map(([y, yaw]) => (
        <group key={yaw} position={[0, y, 0]} rotation={[0, yaw, 0]}>
          <mesh position={[0.6, 0, 0]} castShadow>
            <boxGeometry args={[1, 0.26, 0.05]} />
            <Std color="#a0794f" />
          </mesh>
          {/* 화살촉 */}
          <mesh position={[1.18, 0, 0]} rotation={[Math.PI / 2, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.17, 0.2, 3]} />
            <Std color="#a0794f" flatShading />
          </mesh>
          <mesh position={[0.55, 0, 0.03]}>
            <boxGeometry args={[0.7, 0.05, 0.01]} />
            <Std color="#f1e9da" />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** 샘터: 돌을 둘러 쌓은 물받이에 물이 고이고, 뒤 돌벽의 대롱에서 물이 떨어진다. 옆 기둥에 붉은 바가지를 건다 */
function Spring() {
  return (
    <group>
      {/* 뒤 돌벽과 물 대롱, 떨어지는 물줄기 */}
      <mesh position={[0, 0.45, -0.95]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 1.2, 0.5]} />
        <Std color="#9f988c" flatShading />
      </mesh>
      <mesh position={[0, 0.7, -0.55]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.35, 8]} />
        <Std color="#8a8f94" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.42, -0.38]}>
        <cylinderGeometry args={[0.025, 0.035, 0.55, 6]} />
        <meshStandardMaterial color="#cfe9f7" transparent opacity={0.75} roughness={0.1} />
      </mesh>
      {/* 돌로 두른 물받이와 고인 물 */}
      {Array.from({ length: 9 }, (_, i) => {
        const a = (i / 9) * Math.PI * 2
        return (
          <mesh key={i} position={[Math.cos(a) * 0.62, 0.1, Math.sin(a) * 0.5]} rotation={[0, a, 0]} scale={[0.26, 0.2, 0.22]} castShadow>
            <dodecahedronGeometry args={[1, 0]} />
            <Std color={GRANITE[i % GRANITE.length]} flatShading />
          </mesh>
        )
      })}
      <mesh position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1, 0.8, 1]}>
        <circleGeometry args={[0.52, 20]} />
        <meshStandardMaterial color="#6fa9bf" roughness={0.1} metalness={0.2} />
      </mesh>
      {/* 바가지 건 기둥 */}
      <mesh position={[1.1, 0.6, -0.5]} castShadow>
        <boxGeometry args={[0.08, 1.2, 0.08]} />
        <Std color="#6b4a2f" />
      </mesh>
      <group position={[1.1, 1.02, -0.38]} rotation={[0.5, 0, 0]}>
        <mesh>
          <sphereGeometry args={[0.13, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
          <Std color="#d6453d" side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.02, -0.18]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.24, 6]} />
          <Std color="#d6453d" />
        </mesh>
      </group>
    </group>
  )
}

/** 글씨나 그림을 캔버스에 그려 텍스처로 만든다 */
function canvasTexture(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  draw(c.getContext('2d')!)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** 현판: 짙은 나무 바탕에 흰 글씨 */
/** 입구 현판: 산 이름을 크게, 그 산이 속한 국립공원을 작게 쓴다 (도봉산도 북한산국립공원에 속한다) */
function plaqueTexture(mountain: string, park?: string) {
  return canvasTexture(512, 128, (g) => {
    g.fillStyle = '#4a3322'
    g.fillRect(0, 0, 512, 128)
    g.strokeStyle = '#c9a46a'
    g.lineWidth = 6
    g.strokeRect(8, 8, 496, 112)
    g.fillStyle = '#f6efe2'
    const font = (px: number) => `bold ${px}px "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    if (park) {
      g.font = font(24)
      g.fillStyle = '#c9a46a'
      g.fillText(park, 256, 34)
      g.font = font(60)
      g.fillStyle = '#f6efe2'
      g.fillText(mountain, 256, 80)
    } else {
      g.font = font(64)
      g.fillText(mountain, 256, 68)
    }
  })
}

/** 등산 안내도: 초록 지도 위에 능선과 등산로, 정상 표시 */
function guideMapTexture() {
  return canvasTexture(320, 224, (g) => {
    g.fillStyle = '#f4f1e8'
    g.fillRect(0, 0, 320, 224)
    g.fillStyle = '#2f5d3a'
    g.fillRect(0, 0, 320, 40)
    g.fillStyle = '#ffffff'
    g.font = 'bold 24px "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('등산 안내도', 160, 21)
    // 산 모양 등고선
    g.fillStyle = '#cfe3c4'
    g.beginPath()
    g.ellipse(190, 135, 120, 72, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#a9cf98'
    g.beginPath()
    g.ellipse(205, 120, 72, 42, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#7fb56d'
    g.beginPath()
    g.ellipse(215, 110, 32, 20, 0, 0, Math.PI * 2)
    g.fill()
    // 등산로
    g.strokeStyle = '#e4572e'
    g.lineWidth = 5
    g.setLineDash([10, 6])
    g.beginPath()
    g.moveTo(30, 205)
    g.bezierCurveTo(90, 190, 110, 150, 150, 150)
    g.bezierCurveTo(185, 150, 190, 118, 215, 108)
    g.stroke()
    g.setLineDash([])
    // 지금 여기, 정상
    g.fillStyle = '#e4572e'
    g.beginPath()
    g.arc(30, 205, 8, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#1f2a36'
    g.beginPath()
    g.moveTo(215, 92)
    g.lineTo(225, 108)
    g.lineTo(205, 108)
    g.closePath()
    g.fill()
  })
}

/**
 * 출발점 입구: 등산로를 가로지르는 통나무 문과 현판, 길옆 등산 안내도.
 * 기준 좌표 +z 가 진행 방향이라 글씨는 다가오는 쪽(-z)을 본다
 */
function Trailhead({ mountain, park }: { mountain: string; park?: string }) {
  const plaque = useMemo(() => plaqueTexture(mountain, park), [mountain, park])
  const map = useMemo(() => guideMapTexture(), [])
  useEffect(
    () => () => {
      plaque.dispose()
      map.dispose()
    },
    [plaque, map],
  )
  const wood = '#7a5232'
  return (
    <group>
      {/* 기둥: 비탈에서도 뜨지 않게 땅속까지 내린다 */}
      {[-2.6, 2.6].map((x) => (
        <mesh key={x} position={[x, 1.1, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.17, 0.2, 4.6, 10]} />
          <Std color={wood} />
        </mesh>
      ))}
      {/* 가로대와 작은 지붕 */}
      <mesh position={[0, 3.35, 0]} castShadow>
        <boxGeometry args={[6.2, 0.28, 0.32]} />
        <Std color={wood} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, 3.62, side * 0.32]} rotation={[side * 0.5, 0, 0]} castShadow>
          <boxGeometry args={[6.8, 0.06, 0.75]} />
          <Std color="#4f5b4a" />
        </mesh>
      ))}
      {/* 현판 */}
      <mesh position={[0, 2.85, 0]} castShadow>
        <boxGeometry args={[3, 0.75, 0.08]} />
        <Std color="#4a3322" />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, 2.85, side * 0.045]} rotation={[0, side < 0 ? Math.PI : 0, 0]}>
          <planeGeometry args={[2.9, 0.68]} />
          <meshStandardMaterial map={plaque} roughness={0.8} />
        </mesh>
      ))}
      {/* 길옆 등산 안내도: 다가오는 쪽으로 비스듬히 */}
      <group position={[4.1, 0, -0.6]} rotation={[0, Math.PI + 0.5, 0]}>
        {[-0.75, 0.75].map((x) => (
          <mesh key={x} position={[x, 0.2, 0]} castShadow>
            <boxGeometry args={[0.1, 3, 0.1]} />
            <Std color={wood} />
          </mesh>
        ))}
        <mesh position={[0, 1.45, 0]} castShadow>
          <boxGeometry args={[1.75, 1.25, 0.08]} />
          <Std color={wood} />
        </mesh>
        <mesh position={[0, 1.45, 0.045]}>
          <planeGeometry args={[1.6, 1.12]} />
          <meshStandardMaterial map={map} roughness={0.8} />
        </mesh>
      </group>
    </group>
  )
}
