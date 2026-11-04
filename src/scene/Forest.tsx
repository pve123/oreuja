import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { sampleHeight, type Terrain, type Trail } from '../lib/data'

const COUNT = 40000
const TRAIL_CLEARANCE = 5 // 등산로 양옆 5m 는 비움
const START_CLEARANCE = 30 // 출발점 둘레 30m 는 공터로 비워 첫 화면을 가리지 않게 함
const TREE_LINE = 760 // 이보다 높으면 바위 지대라 나무 없음

/** 같은 시드면 같은 수열을 내는 난수 (매번 같은 숲 배치) */
function seededRandom(seed: number) {
  const state = { seed }
  return () => {
    state.seed = (state.seed * 16807) % 2147483647
    return (state.seed - 1) / 2147483646
  }
}

/** 지형 위에 소나무를 흩뿌린다 (InstancedMesh 1개라 가볍다) */
export function Forest({ terrain, trail }: { terrain: Terrain; trail: Trail }) {
  const foliage = useRef<THREE.InstancedMesh>(null!)
  const trunks = useRef<THREE.InstancedMesh>(null!)

  const matrices = useMemo(() => {
    const rand = seededRandom(42)

    // 등산로 근처 판정용 격자
    const cell = 20
    const grid = new Map<string, THREE.Vector3[]>()
    for (const p of trail.points) {
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`
      if (!grid.has(key)) grid.set(key, [])
      grid.get(key)!.push(p)
    }
    const nearTrail = (x: number, z: number) => {
      const cx = Math.floor(x / cell)
      const cz = Math.floor(z / cell)
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (const p of grid.get(`${cx + a},${cz + b}`) ?? [])
            if ((p.x - x) ** 2 + (p.z - z) ** 2 < TRAIL_CLEARANCE ** 2) return true
      return false
    }

    const start = trail.points[0]
    const out: THREE.Matrix4[] = []
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    let tries = 0
    while (out.length < COUNT && tries++ < COUNT * 6) {
      const x = THREE.MathUtils.lerp(terrain.minX, terrain.maxX, rand())
      const z = THREE.MathUtils.lerp(terrain.minZ, terrain.maxZ, rand())
      const y = sampleHeight(terrain, x, z)
      if (y > TREE_LINE + rand() * 40) continue
      // 경사가 급하면(바위 사면) 건너뜀
      const slope = Math.hypot(sampleHeight(terrain, x + 8, z) - y, sampleHeight(terrain, x, z + 8) - y) / 8
      if (slope > 0.9 + rand() * 0.3) continue
      if (nearTrail(x, z)) continue
      if ((x - start.x) ** 2 + (z - start.z) ** 2 < START_CLEARANCE ** 2) continue
      const s = 0.7 + rand() * 0.8
      q.setFromAxisAngle(up, rand() * Math.PI * 2)
      out.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.3, z), q, new THREE.Vector3(s, s * (0.9 + rand() * 0.4), s)))
    }
    return out
  }, [terrain, trail])

  useLayoutEffect(() => {
    const color = new THREE.Color()
    matrices.forEach((m, i) => {
      foliage.current.setMatrixAt(i, m)
      trunks.current.setMatrixAt(i, m)
      color.setHSL(0.28 + (i % 7) * 0.012, 0.45, 0.2 + (i % 5) * 0.025)
      foliage.current.setColorAt(i, color)
    })
    foliage.current.count = trunks.current.count = matrices.length
    foliage.current.instanceMatrix.needsUpdate = true
    trunks.current.instanceMatrix.needsUpdate = true
    if (foliage.current.instanceColor) foliage.current.instanceColor.needsUpdate = true
  }, [matrices])

  // 밑동이 원점에 오도록 옮긴 도형
  const shapes = useMemo(
    () => ({
      cone: new THREE.ConeGeometry(2, 7, 6).translate(0, 5.5, 0),
      trunk: new THREE.CylinderGeometry(0.25, 0.35, 2.5, 5).translate(0, 1.25, 0),
    }),
    [],
  )

  return (
    <group>
      <instancedMesh ref={foliage} args={[shapes.cone, undefined, COUNT]} castShadow>
        <meshStandardMaterial roughness={1} />
      </instancedMesh>
      <instancedMesh ref={trunks} args={[shapes.trunk, undefined, COUNT]}>
        <meshStandardMaterial color="#5a4030" roughness={1} />
      </instancedMesh>
    </group>
  )
}
