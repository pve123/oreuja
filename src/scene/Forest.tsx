import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { sampleHeight, type Terrain, type Trail } from '../lib/data'
import { seededRandom } from '../lib/random'
import { classifyGround, samplePhoto } from '../lib/photo-map'
import { makeNearTrail, usePhotoLayers } from '../lib/placement'
import { withOcclusionShrink } from '../lib/occlusion'

const COUNT = 30000
const NEAR_TRAIL_SHARE = 0.45 // 절반 가까이는 등산로 250m 안에 심어 걸으며 보이게 한다
const NEAR_TRAIL_RANGE = 250
const TRAIL_CLEARANCE = 4 // 등산로 양옆 4m 는 비움
const START_CLEARANCE = 30 // 출발점 둘레 30m 는 공터로 비워 첫 화면을 가리지 않게 함
const TREE_LINE = 760 // 사진이 없을 때: 이보다 높으면 바위 지대라 나무 없음
const PINE_SHARE = 0.3 // 소나무 비율. 나머지는 참나무 같은 둥근 활엽수
/** 위성사진의 숲 색은 그늘이 섞여 어두워서 나무 색으로 쓸 때 이만큼 밝힌다 */
const PHOTO_BRIGHTEN = 1.7

type Tree = { matrix: THREE.Matrix4; color: THREE.Color; pine: boolean }

/** 꼭짓점을 조금씩 흔들어 울퉁불퉁한 둥근 수관을 만든다 */
function broadleafCanopy() {
  const geo = new THREE.IcosahedronGeometry(1, 1)
  const rand = seededRandom(11)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  const moved = new Map<string, number>()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`
    if (!moved.has(key)) moved.set(key, 0.8 + rand() * 0.35)
    v.multiplyScalar(moved.get(key)!)
    pos.setXYZ(i, v.x * 2.6, v.y * 2.1 + 5.2, v.z * 2.6)
  }
  geo.computeVertexNormals()
  return geo
}

/** 원뿔 세 층을 겹친 소나무 수관 */
function pineCanopy() {
  const layers = [
    new THREE.ConeGeometry(2.2, 3.2, 7).translate(0, 4.2, 0),
    new THREE.ConeGeometry(1.7, 2.8, 7).translate(0, 5.9, 0),
    new THREE.ConeGeometry(1.1, 2.4, 7).translate(0, 7.4, 0),
  ]
  return mergeGeometries(layers)!
}

/** 지형 위에 나무를 심는다. 위성사진이 있으면 사진에서 숲인 곳에만, 사진 색으로 심는다 */
export function Forest({ terrain, trail }: { terrain: Terrain; trail: Trail }) {
  const broadleaf = useRef<THREE.InstancedMesh>(null!)
  const pines = useRef<THREE.InstancedMesh>(null!)
  const trunks = useRef<THREE.InstancedMesh>(null!)
  const { settled, layers } = usePhotoLayers()

  const trees = useMemo<Tree[]>(() => {
    if (!settled) return []
    const rand = seededRandom(42)
    const nearTrail = makeNearTrail(trail)
    const start = trail.points[0]
    const usePhoto = layers.length > 0
    const out: Tree[] = []
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)

    for (let tries = 0; out.length < COUNT && tries < COUNT * 8; tries++) {
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
      if (x < terrain.minX || x > terrain.maxX || z < terrain.minZ || z > terrain.maxZ) continue
      const y = sampleHeight(terrain, x, z)
      // 절벽 같은 급사면은 건너뜀
      const slope = Math.hypot(sampleHeight(terrain, x + 6, z) - y, sampleHeight(terrain, x, z + 6) - y) / 6
      if (slope > 1.3) continue
      if (nearTrail(x, z, TRAIL_CLEARANCE)) continue
      if ((x - start.x) ** 2 + (z - start.z) ** 2 < START_CLEARANCE ** 2) continue

      const color = new THREE.Color()
      if (usePhoto) {
        const rgb = samplePhoto(layers, x, z)
        if (!rgb || classifyGround(rgb) !== 'forest') continue
        color.setRGB((rgb[0] / 255) * PHOTO_BRIGHTEN, (rgb[1] / 255) * PHOTO_BRIGHTEN, (rgb[2] / 255) * PHOTO_BRIGHTEN, THREE.SRGBColorSpace)
      } else {
        if (y > TREE_LINE + rand() * 40) continue
        color.setHSL(0.28 + rand() * 0.06, 0.45, 0.2 + rand() * 0.1)
      }
      const pine = rand() < PINE_SHARE
      // 같은 사진 색이라도 그루마다 살짝 다르게
      color.offsetHSL((rand() - 0.5) * 0.03, (rand() - 0.5) * 0.1, (rand() - 0.5) * 0.06)
      const s = 0.7 + rand() * 0.7
      q.setFromAxisAngle(up, rand() * Math.PI * 2)
      const scale = new THREE.Vector3(s * (0.85 + rand() * 0.3), s * (0.85 + rand() * 0.4), s * (0.85 + rand() * 0.3))
      out.push({ matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.3, z), q, scale), color, pine })
    }
    return out
  }, [terrain, trail, settled, layers])

  const shapes = useMemo(
    () => ({
      broadleaf: broadleafCanopy(),
      pine: pineCanopy(),
      trunk: new THREE.CylinderGeometry(0.22, 0.32, 3.4, 5).translate(0, 1.7, 0),
    }),
    [],
  )

  // 카메라와 아바타 사이에 들어온 나무는 통째로 줄여 아바타를 가리지 않게 한다 (판정 중심은 수관 가운데)
  const materials = useMemo(
    () => ({
      canopy: withOcclusionShrink(new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), 4),
      trunk: withOcclusionShrink(new THREE.MeshStandardMaterial({ color: '#4f3a2a', roughness: 1 }), 4),
    }),
    [],
  )

  useLayoutEffect(() => {
    let nb = 0
    let np = 0
    trees.forEach((t, i) => {
      const mesh = t.pine ? pines.current : broadleaf.current
      const k = t.pine ? np++ : nb++
      mesh.setMatrixAt(k, t.matrix)
      mesh.setColorAt(k, t.color)
      trunks.current.setMatrixAt(i, t.matrix)
    })
    broadleaf.current.count = nb
    pines.current.count = np
    trunks.current.count = trees.length
    for (const mesh of [broadleaf.current, pines.current, trunks.current]) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      // 화면 밖 판정 범위를 새 나무 위치로 다시 잰다 (처음 0그루일 때 잰 범위가 남아 숲이 통째로 안 보이는 것을 막는다)
      mesh.computeBoundingSphere()
    }
  }, [trees])

  return (
    <group>
      <instancedMesh ref={broadleaf} args={[shapes.broadleaf, materials.canopy, COUNT]} castShadow />
      <instancedMesh ref={pines} args={[shapes.pine, materials.canopy, COUNT]} castShadow />
      <instancedMesh ref={trunks} args={[shapes.trunk, materials.trunk, COUNT]} />
    </group>
  )
}
