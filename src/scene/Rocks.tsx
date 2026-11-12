import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { meshHeight, sampleHeight, type Terrain, type Trail } from '../lib/data'
import { seededRandom } from '../lib/random'
import { jitterVertices } from '../lib/geometry'
import { classifyGround, samplePhoto } from '../lib/photo-map'
import { makeNearTrail, scatterPoint, usePhotoLayers } from '../lib/placement'
import { withOcclusionFade } from '../lib/occlusion'
import { makeLandmarkClear } from '../lib/landmarks'
import { setObstacles, type Obstacle } from '../lib/obstacles'
import { NearModels, type NearItem } from './NearModels'
import { PHOTO_CAMERA_BACK, distanceToSegmentXZ, summitVista } from '../lib/summit'

/** 흩어 놓는 바위 수 */
const COUNT = 5000
/** 정상 둘레에 놓는 큰 바위 수 */
const SUMMIT_BOULDERS = 14
const CAPACITY = COUNT + SUMMIT_BOULDERS
/** 절반은 등산로 150m 안에 둬서 걸으며 보이게 한다 */
const NEAR_TRAIL_SHARE = 0.5
const NEAR_TRAIL_RANGE = 150
/** 등산로 양옆 이만큼(m)에는 바위를 두지 않는다 */
const TRAIL_CLEARANCE = 2.5
/** 이보다 높으면(m) 화강암이 드러난 곳이 많다 */
const HIGH_GROUND = 620
/** 도형 바위를 위아래로 누르는 비율. 둥근 덩이를 납작하게 해 바윗돌처럼 보이게 한다 */
const FLATTEN = 0.65
/** 바위 크기에 이 비율을 곱한 만큼 땅에 묻어 떠 보이지 않게 한다 */
const BURY = 0.25
/** 가까이 그릴 바위 모델 (Quaternius Stylized Nature MegaKit, CC0). 약 3.2m × 2.2m × 3m, 바닥이 y≈0 */
const ROCK_MODELS = ['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3'].map((n) => `/models/nature/${n}.gltf`)
/** 바위 색: 북한산 화강암 (모델 텍스처는 무늬만 쓰고 이 색으로 다시 칠한다) */
const ROCK_TINT = '#b7b1a6'
/** 모델 반폭(m). 도형 바위 반지름(크기 1)에 맞추려고 나눈다 */
const ROCK_MODEL_HALF = 1.6
/** 도형 바위 색의 평균 밝기(선형). 모델 바위 색을 이 값으로 나눠 1 안팎으로 만든다 */
const ROCK_BASE_LUMA = 0.26
/** 모델 높이(m) */
const ROCK_MODEL_HEIGHT = 2.2
/** 이보다 낮게 솟은 바위는 막지 않고 넘어간다(m). 발목 높이 돌에 걸려 멈추면 답답하다 */
const STEP_OVER = 0.4
/** 바위가 막더라도 등산로 가운데에서 이만큼은 비워 길이 막히지 않게 한다(m) */
const TRAIL_KEEP = 1.1

/** 바위가 드러난 곳의 화강암(위성사진이 있으면 사진에서 바위인 곳)과 정상 둘레의 큰 바위 */
export function Rocks({ terrain, trail }: { terrain: Terrain; trail: Trail }) {
  const ref = useRef<THREE.InstancedMesh>(null!)

  // 정이십면체 꼭짓점을 조금씩 흔들어 둥근 바윗덩이 모양을 만든다
  const shape = useMemo(() => {
    const geo = jitterVertices(new THREE.IcosahedronGeometry(1, 1), seededRandom(7), 0.75, 0.45).scale(1, FLATTEN, 1)
    geo.computeVertexNormals()
    return geo
  }, [])

  const { settled, layers } = usePhotoLayers()
  // 카메라와 아바타 사이에 들어온 바위는 통째로 줄여 아바타를 가리지 않게 한다.
  // 캐릭터 둘레(정밀 반경)는 바위 모델이 그리므로, 도형 바위는 반경 밖만 그린다
  const material = useMemo(() => withOcclusionFade(new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), 0, { ring: 'far' }), [])

  const { instances, obstacles, models } = useMemo(() => {
    if (!settled) return { instances: [], obstacles: [], models: [] }
    const rand = seededRandom(99)
    const nearTrail = makeNearTrail(trail)
    const nearLandmark = makeLandmarkClear(terrain, trail)
    const usePhoto = layers.length > 0

    const instances: { matrix: THREE.Matrix4; color: THREE.Color }[] = []
    const obstacles: Obstacle[] = []
    const models: NearItem[] = []
    /** (x, z) 에 바위 하나를 놓는다. 랜드마크 둘레라 놓지 못하면 false. rand() 부르는 순서를 바꾸면 바위 배치가 달라진다 */
    const addRock = (x: number, z: number, size: number) => {
      if (nearLandmark(x, z)) return false
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4))
      const s = new THREE.Vector3(size * (0.8 + rand() * 0.6), size * (0.6 + rand() * 0.6), size * (0.8 + rand() * 0.6))
      const p = new THREE.Vector3(x, meshHeight(terrain, x, z) - size * BURY, z)
      // 북한산 화강암: 밝은 회색에 약간 누런 기. 사진이 있으면 그 자리 색과 섞는다
      const color = new THREE.Color().setHSL(0.09, 0.08 + rand() * 0.06, 0.5 + rand() * 0.12)
      const rgb = usePhoto ? samplePhoto(layers, x, z) : null
      if (rgb && classifyGround(rgb) === 'rock') {
        color.lerp(new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace), 0.7)
      }
      instances.push({ matrix: new THREE.Matrix4().compose(p, q, s), color })
      // 같은 바위를 모델로: 가로는 도형 반지름에, 높이는 도형이 땅 위로 솟은 만큼에 맞춘다. 기울기는 줄여 땅에 앉힌다
      const visible = Math.max(0.2, s.y * FLATTEN * 1.1 - size * BURY)
      const sink = size * 0.12
      const mq = new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * 0.15, rand() * Math.PI * 2, (rand() - 0.5) * 0.15))
      models.push({
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(x, p.y + size * BURY - sink, z),
          mq,
          new THREE.Vector3(s.x / ROCK_MODEL_HALF, (visible + sink) / ROCK_MODEL_HEIGHT, s.z / ROCK_MODEL_HALF),
        ),
        model: Math.floor(rand() * ROCK_MODELS.length),
        // 재질 색(ROCK_TINT)이 화강암 색을 내므로, 바위마다 색은 도형 바위 색의 밝기 비율만큼만 흔든다 (사진 색도 살짝 섞인다)
        color: color.clone().multiplyScalar(1 / ROCK_BASE_LUMA).lerp(new THREE.Color(1, 1, 1), 0.4),
      })
      // 땅 위로 솟은 높이: 도형 꼭대기(납작하게 누르고, 꼭짓점을 최대 1.2배 흔든 곳)에서 묻은 만큼 뺀다
      const height = s.y * FLATTEN * 1.2 - size * BURY
      if (height > STEP_OVER) {
        let r = 0.85 * Math.max(s.x, s.z)
        while (r > 0.3 && nearTrail(x, z, r + TRAIL_KEEP)) r *= 0.8
        obstacles.push({ x, z, r, height })
      }
      return true
    }

    // 1) 정상 둘레의 큰 바위. 길 쪽과, 기념사진 카메라와 아바타 사이는 비운다
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
      if (addRock(x, z, 2.5 + rand() * 3)) placed++
    }

    // 2) 바위가 드러난 곳에 흩어진 바위. 사진이 있으면 사진에서 바위인 곳에만 둔다
    for (let tries = 0; instances.length < CAPACITY && tries < COUNT * 20; tries++) {
      const { x, z } = scatterPoint(rand, trail, terrain, NEAR_TRAIL_SHARE, NEAR_TRAIL_RANGE)
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
      addRock(x, z, 0.4 + rand() * rand() * 3)
    }
    return { instances, obstacles, models }
  }, [terrain, trail, settled, layers])

  useEffect(() => {
    setObstacles('rocks', obstacles)
    return () => setObstacles('rocks', [])
  }, [obstacles])

  useLayoutEffect(() => {
    const mesh = ref.current
    instances.forEach(({ matrix, color }, i) => {
      mesh.setMatrixAt(i, matrix)
      mesh.setColorAt(i, color)
    })
    mesh.count = instances.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    // 새 바위 위치로 화면 밖 판정 범위를 다시 잰다
    mesh.computeBoundingSphere()
  }, [instances])

  return (
    <group>
      <instancedMesh ref={ref} args={[shape, material, CAPACITY]} castShadow receiveShadow />
      <Suspense fallback={null}>
        <NearModels urls={ROCK_MODELS} items={models} capacity={700} occlusionLift={0} ring tint={ROCK_TINT} />
      </Suspense>
    </group>
  )
}
