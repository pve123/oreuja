import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { meshHeight, sampleHeight, type Terrain, type Trail } from '../lib/data'
import { seededRandom } from '../lib/random'
import { classifyGround, samplePhoto } from '../lib/photo-map'
import { makeNearTrail, usePhotoLayers } from '../lib/placement'
import { withOcclusionShrink } from '../lib/occlusion'
import { makeLandmarkClear } from '../lib/landmarks'
import { setObstacles, type Obstacle } from '../lib/obstacles'
import { PHOTO_CAMERA_BACK, distanceToSegmentXZ, summitVista } from '../lib/summit'

const COUNT = 5000
const NEAR_TRAIL_SHARE = 0.5 // 절반은 등산로 150m 안에 둬서 걸으며 보이게 한다
const NEAR_TRAIL_RANGE = 150
const SUMMIT_BOULDERS = 14
const TRAIL_CLEARANCE = 2.5 // 등산로 양옆 2.5m 에는 바위를 두지 않는다
const HIGH_GROUND = 620 // 이보다 높으면 화강암이 드러난 곳이 많다(m)
/** 이보다 낮게 솟은 바위는 막지 않고 넘어간다(m). 발목 높이 돌에 걸려 멈추면 답답하다 */
const STEP_OVER = 0.4
/** 바위가 막더라도 등산로 가운데에서 이만큼은 비워 길이 막히지 않게 한다(m) */
const TRAIL_KEEP = 1.1

/** 바위가 드러난 곳의 화강암(위성사진이 있으면 사진에서 바위인 곳), 백운대 정상 둘레의 큰 바위 */
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

  const { settled, layers } = usePhotoLayers()
  // 카메라와 아바타 사이에 들어온 바위는 통째로 줄여 아바타를 가리지 않게 한다
  const material = useMemo(() => withOcclusionShrink(new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), 0), [])

  const { instances, obstacles } = useMemo(() => {
    if (!settled) return { instances: [], obstacles: [] }
    const rand = seededRandom(99)
    const nearTrail = makeNearTrail(trail)
    const nearLandmark = makeLandmarkClear(terrain, trail)
    const usePhoto = layers.length > 0

    const out: { matrix: THREE.Matrix4; color: THREE.Color }[] = []
    const obstacles: Obstacle[] = []
    const add = (x: number, z: number, size: number) => {
      if (nearLandmark(x, z)) return false
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4))
      const s = new THREE.Vector3(size * (0.8 + rand() * 0.6), size * (0.6 + rand() * 0.6), size * (0.8 + rand() * 0.6))
      // 바닥을 살짝 묻어 떠 보이지 않게
      const p = new THREE.Vector3(x, meshHeight(terrain, x, z) - size * 0.25, z)
      // 북한산 화강암: 밝은 회색에 약간 누런 기. 사진이 있으면 그 자리 색과 섞는다
      const color = new THREE.Color().setHSL(0.09, 0.08 + rand() * 0.06, 0.5 + rand() * 0.12)
      const rgb = usePhoto ? samplePhoto(layers, x, z) : null
      if (rgb && classifyGround(rgb) === 'rock') {
        color.lerp(new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace), 0.7)
      }
      out.push({ matrix: new THREE.Matrix4().compose(p, q, s), color })
      // 땅 위로 솟은 높이: 도형 꼭대기(납작하게 0.65, 꼭짓점을 최대 1.2배)에서 묻은 만큼 뺀다
      const height = s.y * 0.65 * 1.2 - size * 0.25
      if (height > STEP_OVER) {
        let r = 0.85 * Math.max(s.x, s.z)
        while (r > 0.3 && nearTrail(x, z, r + TRAIL_KEEP)) r *= 0.8
        obstacles.push({ x, z, r, height })
      }
      return true
    }

    // 1) 백운대 정상 둘레의 큰 바위. 길 쪽과 기념사진 카메라와 아바타 사이는 비운다
    const top = trail.points[trail.points.length - 1]
    const vista = summitVista(terrain, trail)
    const photoCamera = top.clone().addScaledVector(vista, -(PHOTO_CAMERA_BACK + 3))
    let placed = 0
    for (let tries = 0; placed < SUMMIT_BOULDERS && tries < 400; tries++) {
      const a = rand() * Math.PI * 2
      const r = 8 + rand() * 22
      const x = top.x + Math.sin(a) * r
      const z = top.z + Math.cos(a) * r
      if (nearTrail(x, z, 3.5)) continue
      if (distanceToSegmentXZ(x, z, top, photoCamera) < 6) continue
      if (add(x, z, 2.5 + rand() * 3)) placed++
    }

    // 2) 바위가 드러난 곳에 흩어진 바위. 사진이 있으면 사진에서 바위인 곳에만 둔다
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
      if (nearTrail(x, z, TRAIL_CLEARANCE)) continue
      if (usePhoto) {
        const rgb = samplePhoto(layers, x, z)
        if (!rgb || classifyGround(rgb) !== 'rock') continue
      } else {
        const y = sampleHeight(terrain, x, z)
        const slope = Math.hypot(sampleHeight(terrain, x + 8, z) - y, sampleHeight(terrain, x, z + 8) - y) / 8
        const rocky = y > HIGH_GROUND ? 0.5 : slope > 0.7 ? 0.35 : 0.02
        if (rand() > rocky) continue
      }
      add(x, z, 0.4 + rand() * rand() * 3)
    }
    return { instances: out, obstacles }
  }, [terrain, trail, settled, layers])

  useEffect(() => {
    setObstacles('rocks', obstacles)
    return () => setObstacles('rocks', [])
  }, [obstacles])

  useLayoutEffect(() => {
    instances.forEach(({ matrix, color }, i) => {
      ref.current.setMatrixAt(i, matrix)
      ref.current.setColorAt(i, color)
    })
    ref.current.count = instances.length
    ref.current.instanceMatrix.needsUpdate = true
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true
    ref.current.computeBoundingSphere() // 새 바위 위치로 화면 밖 판정 범위를 다시 잰다
  }, [instances])

  return (
    <instancedMesh ref={ref} args={[shape, material, COUNT + SUMMIT_BOULDERS]} castShadow receiveShadow />
  )
}
