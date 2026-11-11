import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { meshHeight, type Terrain, type Trail } from '../lib/data'
import { seededRandom } from '../lib/random'
import { STEP_SLOPE, STEP_WIDTH, stoneSteps } from '../lib/steps'
import { NearModels, type NearItem } from './NearModels'

const PATH_WIDTH = 1.6 // 흙길 폭(m)
/** 길 가장자리에서 풀밭으로 투명하게 녹아드는 폭(m). 줄마다 조금씩 달라 가장자리가 자연스럽게 들쭉날쭉하다 */
const PATH_FADE = 0.45
const PATH_LIFT = 0.06 // 지면과 겹쳐 깜빡이지 않게 살짝 띄운다(m)
/** 길 질감 한 장이 덮는 길이(m) */
const PATH_TILE = 2.4
const POST_EVERY = 2.5 // 난간 기둥 간격(m)
const RAIL_SIDE = 1.0 // 난간이 길 가운데서 떨어진 거리(m)
const RAIL_HEIGHT = 0.95

/** Quaternius Stylized Nature MegaKit (CC0). scripts/prepare-nature.mjs 로 준비한다 */
const NATURE = '/models/nature/'
const SLABS = ['RockPath_Square_Small_1', 'RockPath_Square_Small_2', 'RockPath_Square_Small_3'].map((n) => `${NATURE}${n}.gltf`)
const PEBBLES = ['Pebble_Round_1', 'Pebble_Round_3', 'Pebble_Round_5', 'Pebble_Square_1', 'Pebble_Square_4'].map((n) => `${NATURE}${n}.gltf`)
/** 판석 모델 크기 약 1m × 1m × 0.15m. 한 칸에 두 장을 나란히 얹는다 */
const SLAB_THICK = 0.13
/** 계단 몸통(흙과 돌 받침) 윗면을 판석 두께만큼 낮춘다 */
const BODY_BELOW_TOP = 0.09
/** 판석·자갈 색: 북한산 화강암 (모델 텍스처는 무늬만 쓰고 이 색으로 다시 칠한다) */
const PATH_ROCK_TINT = '#aaa397'
/** 길가 자갈: 길 1m 마다 개수 */
const PEBBLES_PER_M = 1.4

type Props = { terrain: Terrain; trail: Trail }

/** 진행 방향의 오른쪽 단위 벡터 */
const rightOf = (heading: number) => new THREE.Vector3(-Math.cos(heading), 0, Math.sin(heading))

const UP = new THREE.Vector3(0, 1, 0)
const FORWARD = new THREE.Vector3(0, 0, 1)
/**
 * 디딤판 방향: 진행 방향(heading)으로 돌리고, 오른쪽이 tilt 만큼 오르게 앞뒤 축으로 기울인다.
 * 상자의 +x 는 진행 방향 왼쪽이라, 오른쪽이 오르려면 +x 쪽이 내려가게 돌린다
 */
function stepRotation(heading: number, tilt: number) {
  const yaw = new THREE.Quaternion().setFromAxisAngle(UP, heading)
  const roll = new THREE.Quaternion().setFromAxisAngle(FORWARD, -Math.atan(tilt))
  return yaw.multiply(roll)
}

/** 흙길, 가파른 구간의 돌계단, 길가 자갈, 위문~정상 바위 구간의 철제 난간 (위문을 지나는 코스만) */
export function TrailDetails({ terrain, trail }: Props) {
  return (
    <group>
      <PathSurface terrain={terrain} trail={trail} />
      <StoneSteps terrain={terrain} trail={trail} />
      <Suspense fallback={null}>
        <Pebbles terrain={terrain} trail={trail} />
      </Suspense>
      <Railings terrain={terrain} trail={trail} />
    </group>
  )
}

const DIRT = new THREE.Color('#9a8670') // 흙길 색. 질감(밝기 0.75~1)이 곱해지므로 조금 밝게
const GRANITE = new THREE.Color('#b7b1a6')
const SURFACE_BLEND = 30 // 흙길에서 바위 바닥으로 바뀌는 구간 길이(m)

/** 위문 이정표 거리. 위문을 지나지 않는 코스면 null (바위 바닥·난간 없음) */
const gateDistance = (trail: Trail) => trail.data.checkpoints.find((cp) => cp.name.includes('위문'))?.distance ?? null

/**
 * 밟아 다진 흙길 질감 (그림 파일 없이 만든다): 흙 얼룩, 잔자갈, 바퀴처럼 패인 가운데 줄.
 * 밝기만 담고 색은 길 띠의 꼭짓점 색(흙·화강암)이 정한다.
 */
function dirtTexture() {
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  g.fillStyle = '#dcdcdc'
  g.fillRect(0, 0, size, size)
  const rand = seededRandom(31)
  // 큰 얼룩
  for (let i = 0; i < 70; i++) {
    const v = 190 + Math.floor(rand() * 60)
    g.fillStyle = `rgba(${v},${v},${v},0.35)`
    g.beginPath()
    g.ellipse(rand() * size, rand() * size, 8 + rand() * 26, 6 + rand() * 18, rand() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  // 잔자갈: 밝은 알갱이와 그 아래 그늘
  for (let i = 0; i < 520; i++) {
    const x = rand() * size
    const y = rand() * size
    const r = 0.6 + rand() * rand() * 3.2
    g.fillStyle = 'rgba(90,90,90,0.35)'
    g.beginPath()
    g.arc(x + 0.6, y + 0.8, r, 0, Math.PI * 2)
    g.fill()
    const v = 215 + Math.floor(rand() * 40)
    g.fillStyle = `rgb(${v},${v},${v})`
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/**
 * 등산로를 따라 지면에 붙인 길 띠. 위문부터 정상까지는 화강암 바닥 색.
 * 가운데는 흙 질감, 가장자리는 투명하게 풀밭으로 녹아들어 띠를 붙인 티가 덜 난다.
 */
function PathSurface({ terrain, trail }: Props) {
  const geometry = useMemo(() => {
    const positions: number[] = []
    const colors: number[] = []
    const uvs: number[] = []
    const indices: number[] = []
    const gate = gateDistance(trail) ?? Infinity
    const color = new THREE.Color()
    const rand = seededRandom(17)
    const half = PATH_WIDTH / 2
    const n = Math.ceil(trail.length)
    for (let k = 0; k <= n; k++) {
      const d = Math.min(k, trail.length)
      const c = trail.positionAt(d)
      const r = rightOf(trail.headingAt(d))
      color.copy(DIRT).lerp(GRANITE, THREE.MathUtils.clamp((d - gate + SURFACE_BLEND) / SURFACE_BLEND, 0, 1))
      // 바깥(투명) · 가장자리 · 가운데 · 가장자리 · 바깥(투명) 다섯 줄. 가장자리는 줄마다 조금씩 들쭉날쭉
      const edgeL = half * (0.85 + rand() * 0.25)
      const edgeR = half * (0.85 + rand() * 0.25)
      const across: [number, number][] = [
        [-edgeL - PATH_FADE, 0],
        [-edgeL, 1],
        [0, 1],
        [edgeR, 1],
        [edgeR + PATH_FADE, 0],
      ]
      for (const [o, alpha] of across) {
        const x = c.x + r.x * o
        const z = c.z + r.z * o
        positions.push(x, meshHeight(terrain, x, z) + PATH_LIFT, z)
        colors.push(color.r, color.g, color.b, alpha)
        uvs.push((o + half + PATH_FADE) / (PATH_WIDTH + PATH_FADE * 2), d / PATH_TILE)
      }
      if (k > 0) {
        const a = (k - 1) * 5
        const b = k * 5
        // 위에서 볼 때 반시계 방향이 되게 (면이 위를 향해야 그려진다)
        for (let i = 0; i < 4; i++) indices.push(a + i, a + i + 1, b + i, a + i + 1, b + i + 1, b + i)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    return geo
  }, [terrain, trail])

  const texture = useMemo(() => dirtTexture(), [])
  useEffect(() => () => texture.dispose(), [texture])

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        map={texture}
        vertexColors
        transparent
        depthWrite={false}
        roughness={1}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  )
}

/**
 * 경사가 급한 곳의 돌계단. 칸마다 다음 칸 앞까지 꽉 차는 받침을 놓아 칸 사이로 비탈이 드러나지 않는다.
 * 멀리서는 흙빛 받침만 보이고, 캐릭터 둘레 70m 안에서는 받침 위에 화강암 판석 두 장을 나란히 얹는다 (칸마다 모양·방향·색이 조금씩 다르다).
 */
function StoneSteps({ terrain, trail }: Props) {
  const ref = useRef<THREE.InstancedMesh>(null!)
  const steps = useMemo(() => stoneSteps(terrain, trail), [terrain, trail])

  // 받침: 자리와 높이는 lib/steps 에서 계산한다 (캐릭터가 같은 디딤판 높이를 밟는다)
  const { matrices, colors } = useMemo(() => {
    const rand = seededRandom(5)
    const colors: THREE.Color[] = []
    const matrices = steps.map((st) => {
      const q = stepRotation(st.heading, st.tilt)
      const top = st.top - BODY_BELOW_TOP
      const center = new THREE.Vector3(st.x, (top + st.bottom) / 2, st.z)
      colors.push(new THREE.Color().setHSL(0.08, 0.1, 0.4 + rand() * 0.06))
      // 앞뒤로 조금 겹쳐 칸 사이에 틈이 보이지 않게 한다
      return new THREE.Matrix4().compose(center, q, new THREE.Vector3(1, Math.max(0.05, top - st.bottom), st.depth + 0.02))
    })
    return { matrices, colors }
  }, [steps])

  // 판석: 칸마다 두 장, 모델·좌우 뒤집기·살짝 비뚤어짐·밝기가 다르다
  const slabs = useMemo<NearItem[]>(() => {
    const rand = seededRandom(9)
    const out: NearItem[] = []
    const spin = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    for (const st of steps) {
      const right = rightOf(st.heading)
      const base = stepRotation(st.heading, st.tilt)
      for (const side of [-1, 1]) {
        // 디딤판 기울기 안에서 돌린다: 앞뒤 뒤집기와 살짝 비뚤어짐
        spin.setFromAxisAngle(up, (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.08)
        const q = base.clone().multiply(spin)
        const lateral = side * (STEP_WIDTH / 4 + (rand() - 0.5) * 0.04)
        const pos = new THREE.Vector3(st.x + right.x * lateral, st.top - SLAB_THICK + st.tilt * lateral, st.z + right.z * lateral)
        const scale = new THREE.Vector3(STEP_WIDTH / 2 - 0.03, SLAB_THICK / 0.15, st.depth + 0.04)
        const shade = 0.88 + rand() * 0.24
        out.push({
          matrix: new THREE.Matrix4().compose(pos, q, scale),
          model: Math.floor(rand() * SLABS.length),
          color: new THREE.Color(shade, shade, shade),
        })
      }
    }
    return out
  }, [steps])

  // 높이·깊이 1짜리 판을 칸마다 위아래 길이와 칸 깊이에 맞춰 늘린다
  const shape = useMemo(() => new THREE.BoxGeometry(STEP_WIDTH, 1, 1), [])

  useLayoutEffect(() => {
    matrices.forEach((m, i) => {
      ref.current.setMatrixAt(i, m)
      ref.current.setColorAt(i, colors[i])
    })
    ref.current.count = matrices.length
    ref.current.instanceMatrix.needsUpdate = true
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true
    ref.current.computeBoundingSphere()
  }, [matrices, colors])

  return (
    <group>
      {/* 받침은 그림자를 드리우지 않는다. 비탈에 긴 검은 쐐기가 생겨 계단이 땅에 박힌 판처럼 보였다 (판석은 그림자를 드리운다) */}
      <instancedMesh ref={ref} args={[shape, undefined, Math.max(1, matrices.length)]} receiveShadow>
        <meshStandardMaterial roughness={1} />
      </instancedMesh>
      <Suspense fallback={null}>
        <NearModels urls={SLABS} items={slabs} capacity={1200} tint={PATH_ROCK_TINT} />
      </Suspense>
    </group>
  )
}

/** 길가에 흩어진 자갈. 길 가운데는 비우고 가장자리 쪽에 많이 둔다. 돌계단 구간은 건너뛴다 */
function Pebbles({ terrain, trail }: Props) {
  const items = useMemo<NearItem[]>(() => {
    const rand = seededRandom(23)
    const out: NearItem[] = []
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const count = Math.floor(trail.length * PEBBLES_PER_M)
    for (let i = 0; i < count; i++) {
      const d = rand() * trail.length
      const slope = Math.abs(trail.positionAt(d + 2).y - trail.positionAt(d - 2).y) / 4
      if (slope >= STEP_SLOPE) continue
      const c = trail.positionAt(d)
      const r = rightOf(trail.headingAt(d))
      // 가장자리 쪽에 몰리게: 0.45~1.25m, 가끔 길 가운데에도 하나
      const o = (rand() < 0.5 ? -1 : 1) * (rand() < 0.15 ? rand() * 0.5 : 0.45 + rand() * 0.8)
      const x = c.x + r.x * o
      const z = c.z + r.z * o
      const s = 0.3 + rand() * rand() * 0.8
      q.setFromEuler(e.set((rand() - 0.5) * 0.3, rand() * Math.PI * 2, (rand() - 0.5) * 0.3))
      const shade = 0.8 + rand() * 0.35
      out.push({
        matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, meshHeight(terrain, x, z) + PATH_LIFT - 0.02, z), q, new THREE.Vector3(s, s, s)),
        model: Math.floor(rand() * PEBBLES.length),
        color: new THREE.Color(shade, shade, shade),
      })
    }
    return out
  }, [terrain, trail])

  return <NearModels urls={PEBBLES} items={items} radius={55} capacity={500} castShadow={false} tint={PATH_ROCK_TINT} />
}

/** 위문부터 정상까지 길 양쪽 철제 난간 (기둥 + 기둥 사이 가로대) */
function Railings({ terrain, trail }: Props) {
  const posts = useRef<THREE.InstancedMesh>(null!)
  const rails = useRef<THREE.InstancedMesh>(null!)

  const { postMatrices, railMatrices } = useMemo(() => {
    const from = gateDistance(trail) ?? Infinity
    const postMatrices: THREE.Matrix4[] = []
    const railMatrices: THREE.Matrix4[] = []
    const one = new THREE.Vector3(1, 1, 1)
    const noRotation = new THREE.Quaternion()
    const yAxis = new THREE.Vector3(0, 1, 0)

    for (const side of [-1, 1]) {
      let prevTop: THREE.Vector3 | null = null
      for (let d = from; d <= trail.length - 3; d += POST_EVERY) {
        const p = trail.positionAt(d).add(rightOf(trail.headingAt(d)).multiplyScalar(RAIL_SIDE * side))
        p.y = meshHeight(terrain, p.x, p.z)
        postMatrices.push(new THREE.Matrix4().compose(p.clone().setY(p.y + RAIL_HEIGHT / 2), noRotation, one))
        const top = p.clone().setY(p.y + RAIL_HEIGHT)
        if (prevTop) {
          // 앞 기둥 꼭대기에서 이 기둥 꼭대기까지 가로대를 눕혀 잇는다
          const dir = top.clone().sub(prevTop)
          const len = dir.length()
          const q = new THREE.Quaternion().setFromUnitVectors(yAxis, dir.normalize())
          const mid = prevTop.clone().add(top).multiplyScalar(0.5)
          railMatrices.push(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, len, 1)))
        }
        prevTop = top
      }
    }
    return { postMatrices, railMatrices }
  }, [terrain, trail])

  const shapes = useMemo(
    () => ({
      post: new THREE.CylinderGeometry(0.035, 0.035, RAIL_HEIGHT, 6),
      rail: new THREE.CylinderGeometry(0.02, 0.02, 1, 6), // 길이 1 → 행렬로 늘린다
    }),
    [],
  )

  useLayoutEffect(() => {
    postMatrices.forEach((m, i) => posts.current.setMatrixAt(i, m))
    railMatrices.forEach((m, i) => rails.current.setMatrixAt(i, m))
    posts.current.count = postMatrices.length
    rails.current.count = railMatrices.length
    posts.current.instanceMatrix.needsUpdate = true
    rails.current.instanceMatrix.needsUpdate = true
  }, [postMatrices, railMatrices])

  return (
    <group>
      <instancedMesh ref={posts} args={[shapes.post, undefined, Math.max(1, postMatrices.length)]} castShadow>
        <meshStandardMaterial color="#4a4f55" metalness={0.6} roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={rails} args={[shapes.rail, undefined, Math.max(1, railMatrices.length)]} castShadow>
        <meshStandardMaterial color="#5b6168" metalness={0.6} roughness={0.5} />
      </instancedMesh>
    </group>
  )
}
