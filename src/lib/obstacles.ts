/**
 * 캐릭터가 지나갈 수 없는 것들(나무 줄기, 바위, 랜드마크 건물)을 바닥 원으로 모아 둔다.
 * 나무·바위·랜드마크가 각자 key 로 원 목록을 넣고(코스가 바뀌면 같은 key 로 바꿔 넣는다),
 * scene/Colliders 가 이 목록으로 Rapier 원기둥 충돌체를 만든다. 부딪히면 캐릭터 컨트롤러가 둘레를 따라 미끄러뜨린다.
 */

/** 바닥 원 하나. height 는 땅에서 꼭대기까지 높이(m) */
export type Obstacle = { x: number; z: number; r: number; height: number }

const groups = new Map<string, Obstacle[]>()
const listeners = new Set<() => void>()

/** key 묶음의 장애물을 바꿔 넣는다. 빈 배열이면 지운다 */
export function setObstacles(key: string, list: Obstacle[]) {
  if (list.length) groups.set(key, list)
  else groups.delete(key)
  for (const fn of listeners) fn()
}

/** 모든 장애물 (key 별) */
export function allObstacles(): ReadonlyMap<string, Obstacle[]> {
  return groups
}

/** 장애물 목록이 바뀔 때마다 부른다. 돌려주는 함수로 그만 듣는다 */
export function subscribeObstacles(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 카메라 스프링 암이 부딪히는 충돌체 번호 (지형·계단 경사로·랜드마크). 나무와 바위는 가림 셰이더가 줄여 주므로 카메라를 당기지 않는다 */
export const cameraBlockers = new Set<number>()
