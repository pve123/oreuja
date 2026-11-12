import { useEffect } from 'react'
import { useRapier, type RapierCollider as Collider } from '@react-three/rapier'
import { meshHeight, type Terrain, type Trail } from '../lib/data'
import { CORRIDOR, corridorMesh } from '../lib/collider-mesh'
import { allObstacles, cameraBlockers, subscribeObstacles } from '../lib/obstacles'
import { makeNearTrail } from '../lib/placement'
import { stairRampMesh } from '../lib/steps'

/** 장애물 원기둥 높이 상한(m). 캐릭터가 뛰어도(약 1m) 넘지 못할 만큼이면 충분하다 */
const MAX_OBSTACLE_HEIGHT = 6
/** 원기둥 바닥을 땅속에 묻는 깊이(m). 비탈에서도 바닥과 땅 사이에 틈이 생기지 않게 한다 */
const BURY_DEPTH = 0.25

/** 지형·돌계단 경사로·나무·바위·랜드마크 충돌체를 Rapier 세계에 만든다 (그림은 그리지 않는다) */
export function Colliders({ terrain, trail }: { terrain: Terrain; trail: Trail }) {
  const { world, rapier } = useRapier()

  // 지형과 계단 경사로
  useEffect(() => {
    const made: Collider[] = []
    // 카메라 스프링 암도 지형과 경사로에 막힌다
    const ground = corridorMesh(terrain, trail)
    made.push(world.createCollider(rapier.ColliderDesc.trimesh(ground.vertices, ground.indices)))
    const ramp = stairRampMesh(terrain, trail)
    if (ramp && ramp.indices.length) made.push(world.createCollider(rapier.ColliderDesc.trimesh(ramp.vertices, ramp.indices)))
    for (const c of made) cameraBlockers.add(c.handle)
    return () => {
      for (const c of made) {
        cameraBlockers.delete(c.handle)
        world.removeCollider(c, false)
      }
    }
  }, [world, rapier, terrain, trail])

  // 나무 줄기·바위·랜드마크: 목록이 바뀔 때마다 다시 만든다
  useEffect(() => {
    let made: { collider: Collider; camera: boolean }[] = []
    const clear = () => {
      for (const m of made) {
        if (m.camera) cameraBlockers.delete(m.collider.handle)
        world.removeCollider(m.collider, false)
      }
      made = []
    }
    const nearTrail = makeNearTrail(trail)
    const sync = () => {
      clear()
      for (const [key, list] of allObstacles()) {
        // 나무·바위는 가림 셰이더가 줄여 주므로 랜드마크만 카메라를 막는다
        const camera = key === 'landmarks'
        for (const o of list) {
          // 갈 수 없는 먼 곳의 장애물은 만들지 않는다
          if (!nearTrail(o.x, o.z, CORRIDOR)) continue
          const height = Math.min(o.height, MAX_OBSTACLE_HEIGHT)
          const base = meshHeight(terrain, o.x, o.z)
          const desc = rapier.ColliderDesc.cylinder(height / 2 + BURY_DEPTH, o.r).setTranslation(o.x, base + height / 2 - BURY_DEPTH, o.z)
          const collider = world.createCollider(desc)
          if (camera) cameraBlockers.add(collider.handle)
          made.push({ collider, camera })
        }
      }
    }
    sync()
    const off = subscribeObstacles(sync)
    return () => {
      off()
      clear()
    }
  }, [world, rapier, terrain, trail])

  return null
}
