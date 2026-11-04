import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { meshHeight, sampleHeight, type Terrain, type Trail } from '../lib/data'
import { seededRandom } from '../lib/random'

const COUNT = 5000
const NEAR_TRAIL_SHARE = 0.5 // 절반은 등산로 150m 안에 둬서 걸으며 보이게 한다
const NEAR_TRAIL_RANGE = 150
const SUMMIT_BOULDERS = 14
const TRAIL_CLEARANCE = 2.5 // 등산로 양옆 2.5m 에는 바위를 두지 않는다
const HIGH_GROUND = 620 // 이보다 높으면 화강암이 드러난 곳이 많다(m)

/** 가파른 사면과 높은 곳에 흩어진 화강암, 백운대 정상 둘레의 큰 바위 */
export function Rocks({ terrain, trail }: { terrain: Terrain; trail: Trail }) {
  const ref = useRef<THREE.InstancedMesh>(null!)

  // 정이십면체 꼭짓점을 조금씩 흔들어 둥근 바윗덩이 모양을 만든다
  const shape = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(1, 1)
    const rand = seededRandom(7)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const v = new THREE.Vector3()
    const moved = new Map<string, number>() // 같은 자리 꼭짓점은 같은 만큼 움직여 틈이 생기지 않게
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`
      if (!moved.has(key)) moved.set(key, 0.75 + rand() * 0.45)
      v.multiplyScalar(moved.get(key)!)
      v.y *= 0.65 // 납작하게
      pos.setXYZ(i, v.x, v.y, v.z)
    }
    geo.computeVertexNormals()
    return geo
  }, [])

  const instances = useMemo(() => {
    const rand = seededRandom(99)
    const cell = 20
    const grid = new Map<string, THREE.Vector3[]>()
    for (const p of trail.points) {
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`
      if (!grid.has(key)) grid.set(key, [])
      grid.get(key)!.push(p)
    }
    const nearTrail = (x: number, z: number, r: number) => {
      const cx = Math.floor(x / cell)
      const cz = Math.floor(z / cell)
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (const p of grid.get(`${cx + a},${cz + b}`) ?? []) if ((p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return true
      return false
    }

    const out: { matrix: THREE.Matrix4; shade: number }[] = []
    const add = (x: number, z: number, size: number) => {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4))
      const s = new THREE.Vector3(size * (0.8 + rand() * 0.6), size * (0.6 + rand() * 0.6), size * (0.8 + rand() * 0.6))
      // 바닥을 살짝 묻어 떠 보이지 않게
      const p = new THREE.Vector3(x, meshHeight(terrain, x, z) - size * 0.25, z)
      out.push({ matrix: new THREE.Matrix4().compose(p, q, s), shade: rand() })
    }

    // 1) 백운대 정상 둘레의 큰 바위 (길 쪽은 비운다)
    const top = trail.points[trail.points.length - 1]
    let placed = 0
    for (let tries = 0; placed < SUMMIT_BOULDERS && tries < 400; tries++) {
      const a = rand() * Math.PI * 2
      const r = 6 + rand() * 22
      const x = top.x + Math.sin(a) * r
      const z = top.z + Math.cos(a) * r
      if (nearTrail(x, z, 3.5)) continue
      add(x, z, 2.5 + rand() * 3)
      placed++
    }

    // 2) 가파르거나 높은 곳에 흩어진 바위
    for (let tries = 0; out.length < COUNT + SUMMIT_BOULDERS && tries < COUNT * 20; tries++) {
      let x: number
      let z: number
      if (rand() < NEAR_TRAIL_SHARE) {
        const p = trail.points[Math.floor(rand() * trail.points.length)]
        x = p.x + (rand() * 2 - 1) * NEAR_TRAIL_RANGE
        z = p.z + (rand() * 2 - 1) * NEAR_TRAIL_RANGE
      } else {
        x = THREE.MathUtils.lerp(terrain.minX, terrain.maxX, rand())
        z = THREE.MathUtils.lerp(terrain.minZ, terrain.maxZ, rand())
      }
      const y = sampleHeight(terrain, x, z)
      const slope = Math.hypot(sampleHeight(terrain, x + 8, z) - y, sampleHeight(terrain, x, z + 8) - y) / 8
      const rocky = y > HIGH_GROUND ? 0.5 : slope > 0.7 ? 0.35 : 0.02
      if (rand() > rocky) continue
      if (nearTrail(x, z, TRAIL_CLEARANCE)) continue
      add(x, z, 0.4 + rand() * rand() * 3)
    }
    return out
  }, [terrain, trail])

  useLayoutEffect(() => {
    const color = new THREE.Color()
    instances.forEach(({ matrix, shade }, i) => {
      ref.current.setMatrixAt(i, matrix)
      // 북한산 화강암: 밝은 회색에 약간 누런 기
      color.setHSL(0.09, 0.08 + shade * 0.06, 0.55 + shade * 0.15)
      ref.current.setColorAt(i, color)
    })
    ref.current.count = instances.length
    ref.current.instanceMatrix.needsUpdate = true
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true
  }, [instances])

  return (
    <instancedMesh ref={ref} args={[shape, undefined, COUNT + SUMMIT_BOULDERS]} castShadow receiveShadow>
      <meshStandardMaterial roughness={0.9} flatShading />
    </instancedMesh>
  )
}
