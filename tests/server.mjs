// 같이하기 서버 시험: 상태 확인 주소, 접속 출처 확인, IP 당 접속 수 제한, 위치·인원·감정 표현 나눠 주기, 끊긴 연결 정리
// 실행: npm run test:server   (빈 포트에 서버를 따로 띄워 시험하고 끈다)
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import WebSocket from 'ws'

const port = await new Promise((r) => {
  const s = createServer().listen(0, () => {
    const p = s.address().port
    s.close(() => r(p))
  })
})
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, PORT: String(port), TRUST_PROXY: '1', HEARTBEAT_MS: '300' },
  stdio: ['ignore', 'pipe', 'inherit'],
})
await new Promise((r) => server.stdout.once('data', r))

const ORIGIN = 'https://trailverse-seven.vercel.app'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const health = async () => (await fetch(`http://localhost:${port}/health`)).json()

/** 접속해서 welcome 을 받으면 소켓을, 거절되면 상태 코드를 돌려준다 */
function connect({ origin = ORIGIN, ip = '10.0.0.1', autoPong = true, cid = '' } = {}) {
  return new Promise((resolve) => {
    const headers = ip ? { 'x-forwarded-for': ip } : {}
    const ws = new WebSocket(`ws://localhost:${port}${cid ? `?cid=${cid}` : ''}`, { headers, autoPong, ...(origin ? { origin } : {}) })
    ws.once('message', (m) => resolve({ ws, welcome: JSON.parse(String(m)) }))
    ws.once('unexpected-response', (_req, res) => resolve({ status: res.statusCode }))
    ws.once('error', () => {})
  })
}

let failed = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!ok) failed++
}

try {
  const h = await health()
  check('상태 확인 주소가 접속 인원을 알려 준다', h.ok === true && h.players === 0, JSON.stringify(h))

  const a = await connect()
  check('배포 주소에서 붙으면 welcome 을 받는다', a.welcome?.type === 'welcome')
  const preview = await connect({ origin: 'https://trailverse-git-feature-x-hsl-labs.vercel.app', ip: '10.0.0.2' })
  check('Vercel 미리보기 주소도 받는다', preview.welcome?.type === 'welcome')
  const local = await connect({ origin: 'http://localhost:5173', ip: '10.0.0.3' })
  check('개발용 localhost 도 받는다', local.welcome?.type === 'welcome')
  const evil = await connect({ origin: 'https://evil.example', ip: '10.0.0.4' })
  check('다른 사이트에서 붙으면 거절한다', evil.status === 403, `상태 ${evil.status}`)
  const lookalike = await connect({ origin: 'https://trailverse-x-hsl-labs.vercel.app.evil.example', ip: '10.0.0.4' })
  check('비슷하게 꾸민 주소도 거절한다', lookalike.status === 403, `상태 ${lookalike.status}`)
  const none = await connect({ origin: null, ip: '10.0.0.4' })
  check('출처가 없는 접속은 거절한다', none.status === 403, `상태 ${none.status}`)

  // 같은 IP 에서 여섯까지만
  const same = []
  for (let i = 0; i < 6; i++) same.push(await connect({ ip: '10.0.0.9', cid: `browser-${i}` }))
  const seventh = await connect({ ip: '10.0.0.9' })
  check('같은 IP 에서 여섯까지는 붙는다', same.every((c) => c.welcome))
  check('같은 IP 일곱째 접속은 거절한다', seventh.status === 429, `상태 ${seventh.status}`)
  // 자리가 꽉 찬 IP 에서도 이미 붙은 브라우저의 새 창은 그 자리를 넘겨받는다
  const oldClosed = new Promise((r) => same[5].ws.once('close', (code) => r(code)))
  const newTab = await connect({ ip: '10.0.0.9', cid: 'browser-5' })
  check('같은 브라우저 새 창은 IP 제한에 걸리지 않고 붙는다', newTab.welcome?.type === 'welcome')
  check('같은 브라우저 이전 창은 4001 로 닫는다', (await Promise.race([oldClosed, wait(1000)])) === 4001)
  check('같은 브라우저는 한 명으로 센다', (await health()).players === h.players + 3 + 6, JSON.stringify(await health()))
  newTab.ws.close()
  same[0].ws.close()
  await wait(100)
  const again = await connect({ ip: '10.0.0.9' })
  check('하나가 나가면 다시 붙을 수 있다', again.welcome?.type === 'welcome')

  // 프록시 머리글이 없는 내 컴퓨터 접속은 IP 제한에서 뺀다 (개발 중 창 여러 개)
  const locals = []
  for (let i = 0; i < 4; i++) locals.push(await connect({ ip: '' }))
  check('내 컴퓨터에서는 넷 이상 붙어도 막지 않는다', locals.every((c) => c.welcome))
  for (const c of locals) c.ws.close()

  // 위치 나눠 주기: 같은 코스를 오르는 사람끼리만, 서버 안쪽 값(IP 등)은 새지 않는다
  const C = 'bukhansan-baegundae'
  const inbox = (ws) => {
    const box = []
    ws.on('message', (m) => box.push(JSON.parse(String(m))))
    return box
  }
  const until = async (box, pred, ms = 1500) => {
    for (let t = 0; t < ms; t += 20) {
      const hit = box.find(pred)
      if (hit) return hit
      await wait(20)
    }
    return null
  }
  const boxA = inbox(a.ws)
  const boxB = inbox(preview.ws)
  const boxL = inbox(local.ws)
  a.ws.send(JSON.stringify({ type: 'state', name: '시험<b>', avatar: 'duck', course: C, distance: 123.456, mode: 'hiking' }))
  preview.ws.send(JSON.stringify({ type: 'state', name: '비', avatar: 'hiker', course: C, distance: 50, mode: 'summit' }))
  local.ws.send(JSON.stringify({ type: 'state', name: '로비', avatar: 'hiker', course: C, distance: 0, mode: 'lobby' }))
  const info = await until(boxB, (m) => m.t === 'i' && m.i.some(([id]) => id === a.welcome.id))
  const pos = await until(boxB, (m) => m.t === 'p' && m.p.some(([id]) => id === a.welcome.id))
  const ia = info?.i.find(([id]) => id === a.welcome.id)
  const pa = pos?.p.find(([id]) => id === a.welcome.id)
  check('같은 코스 사람의 이름·아바타를 알려 준다', ia?.[2] === 'duck' && pos?.c === C)
  check('닉네임의 꺾쇠를 뺀다', ia?.[1] === '시험b', ia?.[1])
  check('위치는 짧은 배열로, 거리는 0.1m 단위로 보낸다', pa?.length === 6 && pa[1] === 123.5 && pa[5] === 1, JSON.stringify(pa))
  check('IP·내부 값은 보내지 않는다', !JSON.stringify(boxB).includes('10.0.0'))
  const ib = (await until(boxA, (m) => m.t === 'p' && m.p.length))?.p[0]
  check('정상에 있는 사람 모드도 알려 준다', ib?.[5] === 2, JSON.stringify(ib))

  const counts = await until(boxL, (m) => m.t === 'c' && m.c[C] === 2)
  check('베이스캠프에는 코스별 오르는 인원을 보낸다', !!counts, JSON.stringify(boxL.at(-1)))
  check('베이스캠프에는 위치를 보내지 않는다', !boxL.some((m) => m.t === 'p' || m.t === 'i'))

  // 멈춰 있으면 같은 위치를 다시 보내지 않는다
  await wait(300)
  const quiet = boxB.length
  await wait(600)
  check('바뀐 게 없으면 위치를 다시 보내지 않는다', boxB.length === quiet, `${boxB.length - quiet}개 더 옴`)
  a.ws.send(JSON.stringify({ type: 'state', course: C, distance: 130, mode: 'hiking' }))
  const moved = await until(boxB, (m) => m.t === 'p' && m.p.some(([id, d]) => id === a.welcome.id && d === 130))
  check('움직이면 다시 보낸다', !!moved)
  check('이름·아바타는 한 번만 보낸다', boxB.filter((m) => m.t === 'i').length === 1)

  // 감정 표현은 같은 코스에만 한 번, 너무 자주 누르면 버린다
  a.ws.send(JSON.stringify({ type: 'emote', kind: 'wave' }))
  a.ws.send(JSON.stringify({ type: 'emote', kind: 'yaho' }))
  await wait(200)
  const emotes = boxB.filter((m) => m.t === 'e')
  check('감정 표현을 같은 코스 사람에게 보낸다', emotes.length === 1 && emotes[0].k === 'wave' && emotes[0].id === a.welcome.id)
  check('베이스캠프에는 감정 표현을 보내지 않는다', !boxL.some((m) => m.t === 'e'))

  // 한 사람이 베이스캠프로 나가면 남은 사람 화면에서 지운다
  a.ws.send(JSON.stringify({ type: 'state', course: C, mode: 'lobby' }))
  const gone = await until(boxB, (m) => m.t === 'p' && m.p.length === 0)
  check('베이스캠프로 나간 사람은 위치 목록에서 뺀다', !!gone)

  // 끊긴 연결 정리: ping 에 답하지 않는 연결은 두 번 안에 끊는다
  const before = (await health()).players
  const silent = await connect({ ip: '10.0.0.20', autoPong: false })
  const closed = new Promise((r) => silent.ws.once('close', r))
  check('답하지 않는 연결도 처음에는 붙는다', (await health()).players === before + 1)
  await Promise.race([closed, wait(2000)])
  check('ping 에 답하지 않는 연결은 끊고 자리를 비운다', silent.ws.readyState === WebSocket.CLOSED && (await health()).players === before)
  await wait(700)
  check('답하는 연결은 그대로 둔다', a.ws.readyState === WebSocket.OPEN)
} finally {
  server.kill()
}

if (failed) {
  console.log(`\n서버 시험 ${failed}개 실패`)
  process.exit(1)
}
console.log('\n서버 시험 모두 통과')
process.exit(0)
