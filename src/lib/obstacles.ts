/**
 * 캐릭터가 지나갈 수 없는 것들(나무 줄기, 바위, 랜드마크 건물)을 바닥에 그린 원으로 모아 둔다.
 * 3인칭 게임의 캐릭터 이동처럼, 부딪히면 멈추지 않고 원 둘레를 따라 미끄러진다.
 *
 * 나무·바위·랜드마크가 각자 key 로 원 목록을 넣고(코스가 바뀌면 같은 key 로 바꿔 넣는다), World 가 매 프레임 밀어낸다.
 */

/** 바닥 원 하나. height 는 땅에서 꼭대기까지 높이(m): 점프해서 이보다 높이 떠 있으면 넘어간다 */
export type Obstacle = { x: number; z: number; r: number; height: number }

const CELL = 8 // 격자 한 칸(m). 가장 큰 원(랜드마크 약 3m)보다 넉넉하게
const groups = new Map<string, Obstacle[]>()
let grid = new Map<number, Obstacle[]>()

const cellKey = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768)

function rebuild() {
  grid = new Map()
  for (const list of groups.values())
    for (const o of list) {
      // 원이 걸치는 칸마다 넣어, 조회는 캐릭터가 있는 칸 둘레만 보면 되게 한다
      const x0 = Math.floor((o.x - o.r) / CELL)
      const x1 = Math.floor((o.x + o.r) / CELL)
      const z0 = Math.floor((o.z - o.r) / CELL)
      const z1 = Math.floor((o.z + o.r) / CELL)
      for (let ix = x0; ix <= x1; ix++)
        for (let iz = z0; iz <= z1; iz++) {
          const k = cellKey(ix, iz)
          const cell = grid.get(k)
          if (cell) cell.push(o)
          else grid.set(k, [o])
        }
    }
}

/** key 묶음의 장애물을 바꿔 넣는다. 빈 배열이면 지운다 */
export function setObstacles(key: string, list: Obstacle[]) {
  if (list.length) groups.set(key, list)
  else groups.delete(key)
  rebuild()
}

/**
 * (x, z) 에 반지름 radius 인 캐릭터를 놓았을 때 장애물 밖으로 밀어낸 자리.
 * lift 는 땅에서 떠 있는 높이(점프): 장애물보다 높으면 무시한다.
 * 겹친 원이 여럿이면 한 번에 다 풀리지 않아 몇 번 되풀이한다.
 */
export function resolveCollision(x: number, z: number, radius: number, lift = 0) {
  let px = x
  let pz = z
  for (let pass = 0; pass < 3; pass++) {
    let moved = false
    const ix = Math.floor(px / CELL)
    const iz = Math.floor(pz / CELL)
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        const cell = grid.get(cellKey(ix + a, iz + b))
        if (!cell) continue
        for (const o of cell) {
          if (lift > o.height) continue
          const dx = px - o.x
          const dz = pz - o.z
          const min = o.r + radius
          const d2 = dx * dx + dz * dz
          if (d2 >= min * min) continue
          const d = Math.sqrt(d2)
          // 원 가운데에 딱 겹치면 밀 방향이 없으니 +x 로 민다
          const nx = d > 1e-6 ? dx / d : 1
          const nz = d > 1e-6 ? dz / d : 0
          px = o.x + nx * min
          pz = o.z + nz * min
          moved = true
        }
      }
    if (!moved) break
  }
  return { x: px, z: pz }
}
