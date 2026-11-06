import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { bakeGeometry } from '../lib/geometry'
import { occlusionUniforms, withOcclusionFade } from '../lib/occlusion'
import type { Tree } from './Forest'

/**
 * Quaternius Stylized Nature MegaKit 나무 (CC0, public/models/trees).
 * 모델 하나가 삼각형 수천 개라 숲 전체에 쓰지 않고, 아바타 둘레 DETAIL_RADIUS 안의 나무만 이 모델로 바꿔 그린다.
 */
const BROADLEAF = ['CommonTree_3', 'CommonTree_4', 'CommonTree_5']
const PINE = ['Pine_2', 'Pine_4', 'Pine_5']
const URLS = [...BROADLEAF, ...PINE].map((name) => `/models/trees/${name}.glb`)
/** 활엽수·소나무마다 고를 수 있는 모델 수 */
export const DETAIL_VARIANTS = BROADLEAF.length

const DETAIL_RADIUS = 70 // 정밀 모델로 그리는 반경(m)
const BUFFER = 12 // 반경보다 이만큼 넉넉히 담아 두고, 바깥은 재질이 숨긴다
const REBUILD_MOVE = 6 // 아바타가 이만큼 움직이면 담을 나무를 다시 고른다(m)
const CAPACITY = 1500 // 모델 하나에 담을 수 있는 최대 그루 수

type Part = { mesh: THREE.InstancedMesh }

/** 모델마다 껍질·잎 부분을 InstancedMesh 로 만든다 */
function useModelParts() {
  const gltfs = useGLTF(URLS)
  const models = useMemo(
    () =>
      gltfs.map((gltf) => {
        const parts: Part[] = []
        gltf.scene.updateMatrixWorld(true)
        gltf.scene.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return
          const geometry = bakeGeometry(o)
          // 아바타 가까이만 보이게(반경 밖은 숨김) + 카메라 가림 숨기기. 판정 중심은 수관 가운데
          const material = withOcclusionFade((o.material as THREE.Material).clone(), 4, { ring: 'near' })
          const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY)
          mesh.count = 0
          mesh.castShadow = true
          mesh.receiveShadow = true
          parts.push({ mesh })
        })
        return parts
      }),
    [gltfs],
  )
  useEffect(
    () => () => {
      for (const parts of models)
        for (const { mesh } of parts) {
          mesh.geometry.dispose()
          ;(mesh.material as THREE.Material).dispose()
          mesh.dispose()
        }
    },
    [models],
  )
  return models
}

/** 아바타 가까운 나무를 정밀 모델로 그린다. 같은 나무의 도형 버전은 Forest 재질이 숨긴다 */
export function DetailTrees({ trees }: { trees: Tree[] }) {
  const models = useModelParts()
  const lastCenter = useRef(new THREE.Vector2(Infinity, Infinity))

  // 모델이 준비된 동안만 정밀 반경을 켠다 (그 전에는 도형 나무가 전부 그린다)
  useEffect(() => {
    occlusionUniforms.uDetailRadius.value = DETAIL_RADIUS
    return () => {
      occlusionUniforms.uDetailRadius.value = 0
    }
  }, [])

  // 나무 목록이 바뀌면(코스 변경, 위성사진 도착) 바로 다시 고른다
  useEffect(() => {
    lastCenter.current.set(Infinity, Infinity)
  }, [trees])

  useFrame(() => {
    const center = occlusionUniforms.uOccTarget.value
    const cx = center.x
    const cz = center.z
    if (Math.hypot(cx - lastCenter.current.x, cz - lastCenter.current.y) < REBUILD_MOVE) return
    lastCenter.current.set(cx, cz)

    const reach = (DETAIL_RADIUS + BUFFER) ** 2
    const counts = models.map(() => 0)
    for (const tree of trees) {
      const e = tree.matrix.elements // 12, 14 번이 위치 x, z
      if ((e[12] - cx) ** 2 + (e[14] - cz) ** 2 > reach) continue
      const m = (tree.pine ? BROADLEAF.length : 0) + tree.variant
      const k = counts[m]
      if (k >= CAPACITY) continue
      for (const { mesh } of models[m]) mesh.setMatrixAt(k, tree.matrix)
      counts[m] = k + 1
    }
    models.forEach((parts, m) => {
      for (const { mesh } of parts) {
        mesh.count = counts[m]
        mesh.instanceMatrix.needsUpdate = true
        mesh.computeBoundingSphere()
      }
    })
  })

  return (
    <group>
      {models.flat().map(({ mesh }) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </group>
  )
}

useGLTF.preload(URLS)
