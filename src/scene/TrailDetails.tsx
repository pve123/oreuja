import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { meshHeight, type Terrain, type Trail } from '../lib/data'

const PATH_WIDTH = 1.6 // 흙길 폭(m)
const PATH_LIFT = 0.06 // 지면과 겹쳐 깜빡이지 않게 살짝 띄운다(m)
const STEP_EVERY = 1.3 // 계단 간격(m)
const STEP_SLOPE = 0.3 // 이보다 가파르면(30%) 돌계단을 놓는다
const STEP_WIDTH = 1.5 // 돌계단 폭(m). 길 폭보다 조금 좁다
const STEP_DEPTH = 0.42 // 디딤판 깊이(m)
const STEP_RISE = 0.1 // 디딤판 윗면이 주변 지면보다 올라오는 높이(m)
const POST_EVERY = 2.5 // 난간 기둥 간격(m)
const RAIL_SIDE = 1.0 // 난간이 길 가운데서 떨어진 거리(m)
const RAIL_HEIGHT = 0.95

type Props = { terrain: Terrain; trail: Trail }

/** 진행 방향의 오른쪽 단위 벡터 */
const rightOf = (heading: number) => new THREE.Vector3(-Math.cos(heading), 0, Math.sin(heading))

/** 흙길, 가파른 구간의 돌계단, 위문~정상 바위 구간의 철제 난간 (위문을 지나는 코스만) */
export function TrailDetails({ terrain, trail }: Props) {
  return (
    <group>
      <PathSurface terrain={terrain} trail={trail} />
      <StoneSteps terrain={terrain} trail={trail} />
      <Railings terrain={terrain} trail={trail} />
    </group>
  )
}

const DIRT = new THREE.Color('#7f6f5b') // 숲 그늘 아래 흙길 색 (사진 색과 어울리게 채도를 낮춤)
const GRANITE = new THREE.Color('#a9a49b')
const SURFACE_BLEND = 30 // 흙길에서 바위 바닥으로 바뀌는 구간 길이(m)

/** 위문 이정표 거리. 위문을 지나지 않는 코스면 null (바위 바닥·난간 없음) */
const gateDistance = (trail: Trail) => trail.data.checkpoints.find((cp) => cp.name.includes('위문'))?.distance ?? null

/** 등산로를 따라 지면에 붙인 길 띠. 위문부터 정상까지는 화강암 바닥 색 */
function PathSurface({ terrain, trail }: Props) {
  const geometry = useMemo(() => {
    const positions: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    const gate = gateDistance(trail) ?? Infinity
    const color = new THREE.Color()
    const n = Math.ceil(trail.length)
    for (let k = 0; k <= n; k++) {
      const d = Math.min(k, trail.length)
      const c = trail.positionAt(d)
      const r = rightOf(trail.headingAt(d)).multiplyScalar(PATH_WIDTH / 2)
      // 왼쪽 가장자리, 가운데, 오른쪽 가장자리 세 줄로 길 폭 안의 굴곡도 따라간다
      for (const side of [-1, 0, 1]) {
        const x = c.x + r.x * side
        const z = c.z + r.z * side
        positions.push(x, meshHeight(terrain, x, z) + PATH_LIFT, z)
        color.copy(DIRT).lerp(GRANITE, THREE.MathUtils.clamp((d - gate + SURFACE_BLEND) / SURFACE_BLEND, 0, 1))
        colors.push(color.r, color.g, color.b)
      }
      if (k > 0) {
        const a = (k - 1) * 3
        const b = k * 3
        // 위에서 볼 때 반시계 방향이 되게 (면이 위를 향해야 그려진다)
        indices.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    return geo
  }, [terrain, trail])

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial vertexColors roughness={1} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
    </mesh>
  )
}

/** 경사가 급한 곳에 일정 간격으로 놓는 돌계단 */
function StoneSteps({ terrain, trail }: Props) {
  const ref = useRef<THREE.InstancedMesh>(null!)

  const matrices = useMemo(() => {
    const out: THREE.Matrix4[] = []
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    for (let d = 2; d < trail.length - 2; d += STEP_EVERY) {
      const slope = Math.abs(trail.positionAt(d + 2).y - trail.positionAt(d - 2).y) / 4
      if (slope < STEP_SLOPE) continue
      const p = trail.positionAt(d)
      const heading = trail.headingAt(d)
      const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading))
      const right = rightOf(heading)
      // 판 네 모서리와 가운데 아래 땅 높이를 잰다. 길이 옆으로 기울어도 판이 땅에 묻히지 않게
      let low = Infinity
      let high = -Infinity
      for (const [s, f] of [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const x = p.x + right.x * s * (STEP_WIDTH / 2) + forward.x * f * (STEP_DEPTH / 2)
        const z = p.z + right.z * s * (STEP_WIDTH / 2) + forward.z * f * (STEP_DEPTH / 2)
        const h = meshHeight(terrain, x, z) + PATH_LIFT
        low = Math.min(low, h)
        high = Math.max(high, h)
      }
      // 윗면은 가장 높은 곳보다 살짝 위에 수평으로, 아래는 가장 낮은 곳보다 조금 더 내려 경사면을 깎은 계단처럼
      const top = high + STEP_RISE
      const bottom = low - 0.05
      const center = new THREE.Vector3(p.x, (top + bottom) / 2, p.z)
      q.setFromAxisAngle(up, heading)
      out.push(new THREE.Matrix4().compose(center, q, new THREE.Vector3(1, top - bottom, 1)))
    }
    return out
  }, [terrain, trail])

  // 높이 1짜리 판을 그루마다 위아래 길이에 맞춰 늘린다
  const shape = useMemo(() => new THREE.BoxGeometry(STEP_WIDTH, 1, STEP_DEPTH), [])

  useLayoutEffect(() => {
    matrices.forEach((m, i) => ref.current.setMatrixAt(i, m))
    ref.current.count = matrices.length
    ref.current.instanceMatrix.needsUpdate = true
  }, [matrices])

  return (
    <instancedMesh ref={ref} args={[shape, undefined, Math.max(1, matrices.length)]} castShadow receiveShadow>
      <meshStandardMaterial color="#8f8a82" roughness={0.95} />
    </instancedMesh>
  )
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
