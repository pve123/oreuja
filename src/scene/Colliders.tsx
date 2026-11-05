import { useEffect } from 'react'
import { useRapier, type RapierCollider as Collider } from '@react-three/rapier'
import { meshHeight, type Terrain, type Trail } from '../lib/data'
import { CORRIDOR, corridorMesh } from '../lib/collider-mesh'
import { allObstacles, cameraBlockers, subscribeObstacles } from '../lib/obstacles'
import { makeNearTrail } from '../lib/placement'
import { stairRampMesh } from '../lib/steps'

/** 나무 줄기 충돌 원기둥 높이(m). 줄기 높이만큼이면 충분하다 */
const TRUNK_HEIGHT = 6


/** 지형·돌계단 경사로·나무·바위·랜드마크 충돌체를 Rapier 세계에 만든다 (그림은 그리지 않는다) */
export function Colliders({ terrain, trail }: { terrain: Terrain; trail: Trail }) {
  const { world, rapier } = useRapier()

  // 지형과 계단 경사로
  useEffect(() => {
    const made: Collider[] = []
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
        const camera = key === 'landmarks'
        for (const o of list) {
          // 갈 수 없는 먼 곳의 나무·바위는 만들지 않는다
          if (!nearTrail(o.x, o.z, CORRIDOR)) continue
          const height = Math.min(o.height, TRUNK_HEIGHT)
          const base = meshHeight(terrain, o.x, o.z)
          // 바닥을 조금 묻어 비탈에서도 틈이 없게
          const desc = rapier.ColliderDesc.cylinder(height / 2 + 0.25, o.r).setTranslation(o.x, base + height / 2 - 0.25, o.z)
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
