import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { occlusionUniforms, withOcclusionShrink } from '../lib/occlusion'

/** 정밀 모델로 그릴 물건 하나. model 은 urls 의 번호, color 는 텍스처에 곱할 색 */
export type NearItem = { matrix: THREE.Matrix4; model: number; color?: THREE.Color }

type Props = {
  urls: string[]
  items: NearItem[]
  /** 캐릭터 둘레 이 반경(m) 안만 그린다 */
  radius?: number
  /** 모델 하나에 담을 수 있는 최대 개수 */
  capacity?: number
  /** 카메라와 캐릭터 사이에 들어오면 줄여 숨긴다 (바위처럼 시야를 가리는 것). 값은 판정 중심 높이, 없으면 숨기지 않는다 */
  occlusionLift?: number
  /** 같은 물건의 가벼운 도형이 반경 밖을 그리면 'near' 로 반경 밖을 숨겨 두 번 그려지지 않게 한다 */
  ring?: boolean
  castShadow?: boolean
  receiveShadow?: boolean
  /**
   * 이 색(sRGB 16진수)으로 다시 칠한다. Quaternius 텍스처는 이끼 낀 스타일이라 어둡고 초록빛이 돌아(평균 sRGB 80 안팎),
   * 텍스처를 회색조로 바꿔 무늬(밝기)만 남기고 평균 밝기를 중간에 맞춘 뒤 이 색을 곱한다
   */
  tint?: string
}

/** 회색조로 바꾼 무늬의 평균 밝기(sRGB 128)를 선형으로 바꾼 값 */
const NEUTRAL_MEAN_LINEAR = 0.2158
const neutralCache = new WeakMap<object, THREE.Texture>()

/** 텍스처를 회색조로 바꾸고 평균 밝기를 sRGB 128 로 맞춘다 (같은 그림은 한 번만 만든다) */
function neutralMap(map: THREE.Texture) {
  const image = map.image as CanvasImageSource & { width: number; height: number }
  const hit = neutralCache.get(image)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = image.width
  c.height = image.height
  const g = c.getContext('2d')!
  g.drawImage(image, 0, 0)
  const data = g.getImageData(0, 0, c.width, c.height)
  const px = data.data
  let sum = 0
  for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
  const gain = 128 / (sum / (px.length / 4))
  for (let i = 0; i < px.length; i += 4) {
    const l = Math.min(255, (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) * gain)
    px[i] = px[i + 1] = px[i + 2] = l
  }
  g.putImageData(data, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.flipY = map.flipY
  tex.wrapS = map.wrapS
  tex.wrapT = map.wrapT
  tex.anisotropy = 8
  neutralCache.set(image, tex)
  return tex
}

const BUFFER = 12 // 반경보다 이만큼 넉넉히 담아 둔다
const REBUILD_MOVE = 6 // 캐릭터가 이만큼 움직이면 담을 물건을 다시 고른다(m)

/**
 * 캐릭터 둘레만 정밀 모델(glTF)로 그린다. 잘 만든 게임의 LOD 처럼, 모델 하나가 삼각형 수백 개라
 * 코스 전체(계단 수천 칸, 자갈 수천 개)를 다 그리지 않고 가까운 것만 InstancedMesh 에 담는다.
 */
export function NearModels({ urls, items, radius = 70, capacity = 800, occlusionLift, ring = false, castShadow = true, receiveShadow = true, tint }: Props) {
  const gltfs = useGLTF(urls)
  const lastCenter = useRef(new THREE.Vector2(Infinity, Infinity))

  const meshes = useMemo(
    () =>
      gltfs.map((gltf) => {
        const parts: THREE.InstancedMesh[] = []
        gltf.scene.updateMatrixWorld(true)
        gltf.scene.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return
          const geometry = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrixWorld)
          let material = (o.material as THREE.MeshStandardMaterial).clone()
          material.roughness = 0.95
          if (tint && material.map) {
            material.map = neutralMap(material.map)
            // 회색조 무늬의 평균(sRGB 128 = 선형 약 0.216)이 tint 색이 되도록 나눈다
            material.color.set(tint).multiplyScalar(1 / NEUTRAL_MEAN_LINEAR)
          }
          const occlusion = occlusionLift !== undefined
          if (occlusion || ring) material = withOcclusionShrink(material, occlusionLift ?? 0, { ring: ring ? 'near' : undefined, occlusion })
          const mesh = new THREE.InstancedMesh(geometry, material, capacity)
          mesh.count = 0
          mesh.castShadow = castShadow
          mesh.receiveShadow = receiveShadow
          // 처음 색을 넣어 instanceColor 를 만들어 둔다
          mesh.setColorAt(0, new THREE.Color(1, 1, 1))
          parts.push(mesh)
        })
        return parts
      }),
    [gltfs, capacity, occlusionLift, ring, castShadow, receiveShadow, tint],
  )

  useEffect(
    () => () => {
      for (const parts of meshes)
        for (const mesh of parts) {
          mesh.geometry.dispose()
          ;(mesh.material as THREE.Material).dispose()
          mesh.dispose()
        }
    },
    [meshes],
  )

  // 목록이 바뀌면(코스 변경 등) 바로 다시 고른다
  useEffect(() => {
    lastCenter.current.set(Infinity, Infinity)
  }, [items, meshes])

  const white = useMemo(() => new THREE.Color(1, 1, 1), [])

  useFrame(() => {
    const center = occlusionUniforms.uOccTarget.value
    if (Math.hypot(center.x - lastCenter.current.x, center.z - lastCenter.current.y) < REBUILD_MOVE) return
    lastCenter.current.set(center.x, center.z)
    const reach = (radius + BUFFER) ** 2
    const counts = meshes.map(() => 0)
    for (const item of items) {
      const e = item.matrix.elements // 12, 14 번이 위치 x, z
      if ((e[12] - center.x) ** 2 + (e[14] - center.z) ** 2 > reach) continue
      const k = counts[item.model]
      if (k >= capacity) continue
      for (const mesh of meshes[item.model]) {
        mesh.setMatrixAt(k, item.matrix)
        mesh.setColorAt(k, item.color ?? white)
      }
      counts[item.model] = k + 1
    }
    meshes.forEach((parts, m) => {
      for (const mesh of parts) {
        mesh.count = counts[m]
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        mesh.computeBoundingSphere()
      }
    })
  })

  return (
    <group>
      {meshes.flat().map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </group>
  )
}
