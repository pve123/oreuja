// 같이하기 서버 시험: 상태 확인 주소, 접속 출처 확인, IP 당 접속 수 제한, 끊긴 연결 정리, 위치 나눠 주기
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
function connect({ origin = ORIGIN, ip = '10.0.0.1', autoPong = true } = {}) {
  return new Promise((resolve) => {
    const headers = ip ? { 'x-forwarded-for': ip } : {}
    const ws = new WebSocket(`ws://localhost:${port}`, { headers, autoPong, ...(origin ? { origin } : {}) })
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

  // 같은 IP 에서 셋까지만
  const same = []
  for (let i = 0; i < 3; i++) same.push(await connect({ ip: '10.0.0.9' }))
  const fourth = await connect({ ip: '10.0.0.9' })
  check('같은 IP 에서 셋까지는 붙는다', same.every((c) => c.welcome))
  check('같은 IP 넷째 접속은 거절한다', fourth.status === 429, `상태 ${fourth.status}`)
  same[0].ws.close()
  await wait(100)
  const again = await connect({ ip: '10.0.0.9' })
  check('하나가 나가면 다시 붙을 수 있다', again.welcome?.type === 'welcome')

  // 프록시 머리글이 없는 내 컴퓨터 접속은 IP 제한에서 뺀다 (개발 중 창 여러 개)
  const locals = []
  for (let i = 0; i < 4; i++) locals.push(await connect({ ip: '' }))
  check('내 컴퓨터에서는 넷 이상 붙어도 막지 않는다', locals.every((c) => c.welcome))
  for (const c of locals) c.ws.close()

  // 위치 나눠 주기: 다른 사람 상태가 오고, 서버 안쪽 값(IP 등)은 새지 않는다
  a.ws.send(JSON.stringify({ type: 'state', name: '시험<b>', avatar: 'duck', course: 'bukhansan-baegundae', distance: 123, mode: 'hiking' }))
  const peers = await new Promise((r) => preview.ws.on('message', (m) => {
    const msg = JSON.parse(String(m))
    if (msg.type === 'peers' && msg.peers.some((p) => p.id === a.welcome.id && p.distance === 123)) r(msg.peers)
  }))
  const pa = peers.find((p) => p.id === a.welcome.id)
  check('다른 사람 위치를 나눠 준다', pa.avatar === 'duck' && pa.course === 'bukhansan-baegundae')
  check('닉네임의 꺾쇠를 뺀다', pa.name === '시험b', pa.name)
  check('IP·내부 값은 보내지 않는다', !('ip' in pa) && !('alive' in pa) && !('budget' in pa))

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
