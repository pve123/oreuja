// 코스 데이터 점검: public/data/<산>/courses.json 만 보고 경로가 이상하게 잡힌 코스를 찾는다 (OSM 원본 없이 GitHub 에서도 돈다).
// 실행: node tests/check-courses.mjs [데이터 폴더]   (문제가 있으면 종료 코드 1)
// 규칙은 실제로 겪은 문제에서 왔다
//  - 출발 방향: 첫 20m 와 첫 100m 방향이 크게 다르면 캐릭터가 엉뚱한 쪽을 보고 선다 (진달래능선 출발점 군더더기)
//  - 되짚기: 지나온 자리로 3m 안까지 되돌아오는 12~150m 구간이 있으면 갔다가 되짚어 온 것이다 (출발점 군더더기).
//    그 구간 안에 이정표가 있으면 들렀다 나오는 길이라 괜찮다 (망월사 코스는 등산로에서 절 마당으로 들어가 망월사 앞에 섰다 나온다)
//  - 출발 내리막: 첫 500m 안에 출발보다 25m 넘게 내려가면 등산로가 아닌 길로 돌아가는 것이다 (우이암 관리 도로)
//  - 큰 내리막: 한 번에 60m 넘게 내려갔다 오르면 다른 능선으로 돌아가는 것이다 (망월사 다락능선 우회는 61m).
//    일부러 돌아가는 코스는 DESCENT_ALLOWED 에 이유와 함께 적는다
//  - 이정표·정상: 이정표는 코스 안에서 순서대로, 도착점은 코스에서 가장 높은 곳 근처여야 한다
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
// 다른 폴더를 주면 그 데이터를 점검한다 (예전 데이터로 규칙이 문제를 잡는지 볼 때)
const DATA = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'public/data')
const HEADING_MAX_DEG = 45
const SPUR_GAP = 3
const SPUR_MIN = 12
const SPUR_MAX = 150
const START_WINDOW = 500
const START_DROP_MAX = 25
const DESCENT_MAX = 60
const SUMMIT_BELOW_MAX = 15
/** 큰 내리막을 일부러 두는 코스와 그 한도(m) */
const DESCENT_ALLOWED = {
  // 관악문에서 연주대로 바로 오르는 마지막 구간이 OSM 에 암벽(alpine_hiking)으로 올라 있어 데이터 스크립트가 빼고,
  // 연주암 쪽으로 내려갔다 돌아 오른다. 정밀 지형에서 61m 다
  'gwanaksan-sadang': 70,
}

const mountains = JSON.parse(fs.readFileSync(path.join(DATA, 'mountains.json'), 'utf8'))
const problems = []
const ids = new Set()

/** 출발에서의 거리(m). 이정표 거리와 단위를 맞추려고 prepare-data 처럼 높이까지 넣어 잰다 */
function cumulative(pts) {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]))
  return cum
}
const at = (cum, d) => {
  const i = cum.findIndex((c) => c >= d)
  return i < 0 ? cum.length - 1 : i
}
const heading = (a, b) => Math.atan2(b[0] - a[0], b[2] - a[2])

for (const m of mountains) {
  const courses = JSON.parse(fs.readFileSync(path.join(DATA, m.id, 'courses.json'), 'utf8'))
  if (courses.length !== m.courses) problems.push(`${m.name}: mountains.json 의 코스 수 ${m.courses} 와 courses.json ${courses.length} 개가 다르다`)
  for (const c of courses) {
    const name = `${m.name} ${c.name}`
    const say = (msg) => problems.push(`${name}: ${msg}`)
    if (ids.has(c.id)) say(`코스 id ${c.id} 가 겹친다`)
    ids.add(c.id)
    const pts = c.points
    const cum = cumulative(pts)
    const ys = pts.map((p) => p[1])

    // 출발 방향
    const a = heading(pts[0], pts[at(cum, 20)])
    const b = heading(pts[0], pts[at(cum, 100)])
    const diff = Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) * (180 / Math.PI)
    if (diff > HEADING_MAX_DEG) say(`출발 20m 와 100m 방향이 ${diff.toFixed(0)}° 다르다 (출발점에서 되짚어 오는 군더더기?)`)

    // 되짚기 (2m 간격 점이라 거리 대신 점 개수로 앞을 본다)
    for (let i = 0; i < pts.length; i += 2) {
      for (let j = i + 1; j < pts.length && cum[j] - cum[i] <= SPUR_MAX; j++) {
        if (cum[j] - cum[i] < SPUR_MIN) continue
        if (Math.hypot(pts[j][0] - pts[i][0], pts[j][2] - pts[i][2]) < SPUR_GAP) {
          if (c.checkpoints.some((cp) => cp.distance > cum[i] && cp.distance < cum[j])) continue
          say(`${cum[i].toFixed(0)}m 에서 ${(cum[j] - cum[i]).toFixed(0)}m 갔다가 같은 자리로 되돌아온다`)
          i = pts.length
          break
        }
      }
    }

    // 출발 내리막
    const startLow = Math.min(...ys.slice(0, at(cum, START_WINDOW) + 1))
    if (ys[0] - startLow > START_DROP_MAX) say(`출발 ${START_WINDOW}m 안에 ${(ys[0] - startLow).toFixed(0)}m 를 내려간다 (등산로가 아닌 길로 돌아간다?)`)

    // 한 번에 크게 내려갔다 오르기
    let peak = ys[0]
    let peakAt = 0
    for (let i = 1; i < ys.length; i++) {
      if (ys[i] > peak) {
        peak = ys[i]
        peakAt = i
      } else if (peak - ys[i] > (DESCENT_ALLOWED[c.id] ?? DESCENT_MAX)) {
        say(`${cum[peakAt].toFixed(0)}m 에서 ${(peak - ys[i]).toFixed(0)}m 를 내려간다 (다른 길로 돌아간다?)`)
        break
      }
    }

    // 이정표와 정상
    let last = 0
    for (const cp of c.checkpoints) {
      if (!(cp.distance > 0 && cp.distance < c.length)) say(`이정표 ${cp.name} 거리 ${cp.distance}m 가 코스 밖이다`)
      if (cp.distance < last) say(`이정표 ${cp.name} 가 앞 이정표보다 앞에 있다`)
      last = cp.distance
    }
    const top = Math.max(...ys)
    if (top - ys[ys.length - 1] > SUMMIT_BELOW_MAX) say(`도착점이 코스에서 가장 높은 곳보다 ${(top - ys[ys.length - 1]).toFixed(0)}m 낮다`)
    console.log(`  ${name}: ${(c.length / 1000).toFixed(2)}km, 이정표 ${c.checkpoints.length}개, 출발 방향 차이 ${diff.toFixed(0)}°, 출발 내리막 ${(ys[0] - startLow).toFixed(0)}m`)
  }
}

if (problems.length) {
  console.error(`\n코스 점검 실패 ${problems.length}건`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('\n코스 점검 통과')
