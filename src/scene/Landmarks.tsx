import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { Terrain, Trail } from '../lib/data'
import { LANDMARK_ICON, landmarks, type Landmark } from '../lib/landmarks'
import { setObstacles } from '../lib/obstacles'
import { seededRandom } from '../lib/random'
import { useGame } from '../lib/store'

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
      {list.map((l) => (
        <group key={l.name} position={l.position} rotation={[0, l.rotation, 0]}>
          <LandmarkBody landmark={l} />
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

function LandmarkBody({ landmark }: { landmark: Landmark }) {
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
      return <Hut />
    case 'gate':
      return <Gate />
    case 'ruins':
      return <Ruins seed={landmark.distance} />
    case 'waterfall':
      return <Waterfall />
    case 'trailhead':
      return <Trailhead />
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

/** 통나무 산장: 벽, 박공지붕, 굴뚝과 연기, 창문 불빛, 문 앞 벤치 */
function Hut() {
  // 단면이 삼각형인 기둥을 눕혀 박공지붕을 만든다 (꼭짓점 하나가 위로)
  const roof = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 3, 1, false, Math.PI / 2).rotateZ(Math.PI / 2), [])
  const smoke = useRef<THREE.Group>(null!)
  useFrame((_, dt) => {
    smoke.current.children.forEach((c, i) => {
      c.position.y += dt * 0.5
      c.scale.multiplyScalar(1 + dt * 0.3)
      if (c.position.y > 2.4) {
        c.position.y = 0
        c.scale.setScalar(0.25 + i * 0.02)
      }
      const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial
      m.opacity = 0.55 * (1 - c.position.y / 2.4)
    })
  })

  return (
    <group>
      <mesh position={[0, -0.6, 0]} receiveShadow>
        <boxGeometry args={[5.6, 1.4, 4.6]} />
        <Std color="#8e877c" />
      </mesh>
      <mesh position={[0, 1.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[5, 2.8, 4]} />
        <Std color="#8b5a3c" />
      </mesh>
      {/* 통나무 결 */}
      {[0.4, 0.95, 1.5, 2.05, 2.6].map((y) => (
        <mesh key={y} position={[0, y, 2.01]}>
          <boxGeometry args={[5.02, 0.05, 0.02]} />
          <Std color="#6b4329" />
        </mesh>
      ))}
      <mesh geometry={roof} position={[0, 3.35, 0]} scale={[5.8, 1.1, 2.75]} castShadow>
        <Std color="#5a3d2b" flatShading />
      </mesh>
      {/* 문과 창문 */}
      <mesh position={[-1.2, 1.05, 2.03]}>
        <boxGeometry args={[0.9, 1.8, 0.05]} />
        <Std color="#4a2f1f" />
      </mesh>
      {[0.6, 1.8].map((x) => (
        <mesh key={x} position={[x, 1.6, 2.03]}>
          <boxGeometry args={[0.8, 0.65, 0.05]} />
          <Std color="#ffd27a" emissive="#ffb347" emissiveIntensity={0.6} />
        </mesh>
      ))}
      {/* 굴뚝과 연기 */}
      <mesh position={[1.6, 4, -0.8]} castShadow>
        <boxGeometry args={[0.5, 1.4, 0.5]} />
        <Std color="#6e6a64" />
      </mesh>
      <group ref={smoke} position={[1.6, 4.8, -0.8]}>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[0, i * 0.6, 0]} scale={0.25 + i * 0.08}>
            <sphereGeometry args={[1, 10, 8]} />
            <meshStandardMaterial color="#e8e8e8" transparent opacity={0.4} depthWrite={false} />
          </mesh>
        ))}
      </group>
      <Bench position={[1.2, 0, 2.7]} />
    </group>
  )
}

/** 성문 단면: 아치 구멍이 뚫린 벽 (가운데가 등산로) */
function gateShape() {
  const s = new THREE.Shape()
  s.moveTo(-3.5, -2)
  s.lineTo(-1.3, -2)
  s.lineTo(-1.3, 2)
  s.absarc(0, 2, 1.3, Math.PI, 0, true)
  s.lineTo(1.3, -2)
  s.lineTo(3.5, -2)
  s.lineTo(3.5, 4.6)
  s.lineTo(-3.5, 4.6)
  s.closePath()
  return new THREE.ExtrudeGeometry(s, { depth: 2.6, bevelEnabled: false, curveSegments: 16 }).translate(0, 0, -1.3)
}

/** 돌 성문 (암문). 등산로가 아치 사이로 지나가고, 위에는 여장(성가퀴)이 늘어선다 */
function Gate() {
  const wall = useMemo(() => gateShape(), [])
  return (
    <group>
      <mesh geometry={wall} castShadow receiveShadow>
        <Std color="#b7b0a3" flatShading />
      </mesh>
      {[-3.15, -2.25, -1.35, -0.45, 0.45, 1.35, 2.25, 3.15].flatMap((x) =>
        [-1.05, 1.05].map((z) => (
          <mesh key={`${x},${z}`} position={[x, 4.9, z]} castShadow>
            <boxGeometry args={[0.55, 0.6, 0.45]} />
            <Std color="#a9a296" flatShading />
          </mesh>
        )),
      )}
    </group>
  )
}

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

/** 바위 절벽에서 떨어지는 물줄기와 물웅덩이 */
function Waterfall() {
  const tex = useMemo(() => waterTexture(), [])
  useEffect(() => () => tex.dispose(), [tex])
  const water = useRef<THREE.Mesh>(null!)
  useFrame((_, dt) => {
    // 물결 무늬를 아래로 흘린다
    const map = (water.current.material as THREE.MeshStandardMaterial).map
    if (map) map.offset.y += dt * 1.2
  })
  const cliff = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(1, 1)
    const rand = seededRandom(17)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).multiplyScalar(0.85 + rand() * 0.25)
      pos.setXYZ(i, v.x, v.y, v.z)
    }
    geo.computeVertexNormals()
    return geo
  }, [])

  return (
    <group>
      <mesh geometry={cliff} position={[0, 3, -3.8]} scale={[4.4, 6, 2.4]} castShadow receiveShadow>
        <Std color="#8f8a82" flatShading />
      </mesh>
      {/* 물줄기 */}
      <mesh ref={water} position={[0, 3.4, -1.25]} rotation={[-0.12, 0, 0]}>
        <planeGeometry args={[1.3, 6.8]} />
        <meshStandardMaterial map={tex} transparent opacity={0.85} roughness={0.2} side={THREE.DoubleSide} />
      </mesh>
      {/* 물웅덩이와 물보라 */}
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[2, 28]} />
        <meshStandardMaterial color="#5fa8c9" roughness={0.1} metalness={0.2} transparent opacity={0.85} />
      </mesh>
      {[-0.4, 0.3, 0].map((x, i) => (
        <mesh key={i} position={[x, 0.25 + i * 0.1, -1 + i * 0.15]}>
          <sphereGeometry args={[0.35 + i * 0.08, 10, 8]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.35} depthWrite={false} />
        </mesh>
      ))}
      {/* 웅덩이 둘레 돌 */}
      {Array.from({ length: 9 }, (_, i) => {
        const a = (i / 9) * Math.PI * 2
        return (
          <mesh key={i} position={[Math.cos(a) * 2.1, 0.1, Math.sin(a) * 2.1]} scale={[0.35, 0.25, 0.3]}>
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
function plaqueTexture() {
  return canvasTexture(512, 128, (g) => {
    g.fillStyle = '#4a3322'
    g.fillRect(0, 0, 512, 128)
    g.strokeStyle = '#c9a46a'
    g.lineWidth = 6
    g.strokeRect(8, 8, 496, 112)
    g.fillStyle = '#f6efe2'
    g.font = 'bold 64px "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('북한산국립공원', 256, 68)
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
function Trailhead() {
  const plaque = useMemo(() => plaqueTexture(), [])
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
