// 같이하기 서버: 접속한 사람의 코스·위치·아바타를 모아 1초에 10번 모두에게 나눠 준다.
// 실행: npm run server   (기본 포트 5200, PORT 환경변수로 바꿀 수 있다)
// 개발 중에는 Vite 가 /ws 를 이 서버로 넘겨준다(vite.config.ts).
// 저장하는 것은 없다. 접속이 끊기면 그 사람 정보는 바로 지운다.
//
// 환경변수
//   PORT              듣는 포트 (기본 5200). 호스팅 서비스가 정해 주면 그 값을 쓴다
//   ALLOWED_ORIGINS   접속을 받을 페이지 주소, 쉼표로 여럿 (기본: 배포 주소). localhost 는 늘 받는다
//   TRUST_PROXY       1 이면 X-Forwarded-For 첫 주소를 접속한 사람 IP 로 본다. 호스팅의 프록시 뒤에 둘 때만 켠다
//                     (프록시 없이 켜면 누구나 머리글을 꾸며 IP 제한을 피한다)
//   HEARTBEAT_MS      끊긴 연결을 찾는 간격 (기본 15000). 시험에서만 줄인다
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT) || 5200
const TICK_MS = 100 // 위치를 나눠 주는 간격
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS) || 15000
const MAX_PLAYERS = 50
const MAX_PER_IP = 3 // 같은 IP 에서 동시에 붙을 수 있는 수. 집·학교처럼 한 IP 를 나눠 쓰는 경우를 생각해 1 보다 넉넉히 둔다
const MAX_MESSAGE = 512 // 한 메시지 최대 크기(바이트). 위치 메시지는 200바이트 안팎이다
const MAX_MESSAGES_PER_SEC = 30
const NAME_MAX = 12
const AVATARS = new Set(['hiker', 'uncle', 'potato', 'duck', 'tofu', 'mini-beard', 'mini-girl', 'mini-kid', 'barbarian', 'ranger', 'knight'])
// lobby 는 베이스캠프(출발 전 고르는 화면), hidden 은 혼자 오르기. 둘 다 다른 사람 화면에 그리지 않는다
const MODES = new Set(['lobby', 'hidden', 'hiking', 'summit', 'photo', 'photoResult'])
const EMOTES = new Set(['wave', 'thanks', 'yaho', 'cheer', 'summit', 'cheerup', 'fighting'])

const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? 'https://trailverse-seven.vercel.app')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)
const TRUST_PROXY = process.env.TRUST_PROXY === '1'

/**
 * 이 페이지에서 온 접속인지. 다른 사이트가 이 서버를 가져다 쓰지 못하게 브라우저가 붙이는 Origin 을 본다.
 * 배포 주소와 Vercel 미리보기 주소(trailverse-…-hsl-labs.vercel.app), 개발용 localhost 를 받는다
 */
function originAllowed(origin) {
  if (!origin) return false
  if (ALLOWED_ORIGINS.has(origin)) return true
  try {
    const { protocol, hostname } = new URL(origin)
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true
    return protocol === 'https:' && /^trailverse-[a-z0-9-]+-hsl-labs\.vercel\.app$/.test(hostname)
  } catch {
    return false
  }
}

let warnedProxy = false
/** 접속한 사람 IP. 프록시 뒤에서는 X-Forwarded-For 첫 주소를 쓴다 */
function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
  if (TRUST_PROXY && forwarded) return forwarded
  // 프록시 뒤인데 TRUST_PROXY 를 안 켜면 모든 사람이 프록시 IP 하나로 보여 전체가 MAX_PER_IP 명으로 막힌다
  if (forwarded && !warnedProxy) {
    warnedProxy = true
    console.warn('X-Forwarded-For 머리글이 왔는데 TRUST_PROXY 가 꺼져 있다. 호스팅 프록시 뒤라면 TRUST_PROXY=1 을 켜야 IP 제한이 사람마다 걸린다')
  }
  return req.socket.remoteAddress ?? ''
}

/** 내 컴퓨터에서 온 접속. 개발 중 창을 여러 개 띄워도 막히지 않게 IP 제한에서 뺀다 */
const isLoopback = (ip) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'

/** @type {Map<import('ws').WebSocket, { id: string, name: string, avatar: string, course: string, distance: number, offset: number, facing: number, jump: number, mode: string, emote: { kind: string, at: number } | null, budget: number, ip: string, alive: boolean }>} */
const players = new Map()
/** IP 마다 붙어 있는 연결 수 */
const perIp = new Map()
let nextId = 1

const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null)
// 제어 문자와 꺾쇠는 빼고 받는다
// oxlint-disable-next-line no-control-regex
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : null)

// 호스팅 서비스가 살아 있는지 확인하는 주소. 접속 인원만 알려 준다
const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, players: players.size }))
    return
  }
  res.writeHead(404).end()
})

const wss = new WebSocketServer({
  server: http,
  maxPayload: MAX_MESSAGE,
  // 연결을 맺기 전에 거른다: 다른 사이트, 자리 없음, 같은 IP 에서 너무 많이
  verifyClient: ({ origin, req }, done) => {
    if (!originAllowed(origin)) return done(false, 403, 'origin')
    if (players.size >= MAX_PLAYERS) return done(false, 503, 'full')
    const ip = clientIp(req)
    if (!isLoopback(ip) && (perIp.get(ip) ?? 0) >= MAX_PER_IP) return done(false, 429, 'too many')
    done(true)
  },
})

function drop(ws) {
  const me = players.get(ws)
  if (!me) return
  players.delete(ws)
  const n = (perIp.get(me.ip) ?? 1) - 1
  if (n > 0) perIp.set(me.ip, n)
  else perIp.delete(me.ip)
}

wss.on('connection', (ws, req) => {
  const ip = clientIp(req)
  perIp.set(ip, (perIp.get(ip) ?? 0) + 1)
  const me = { id: String(nextId++), name: '등산객', avatar: 'hiker', course: '', distance: 0, offset: 0, facing: 0, jump: 0, mode: 'lobby', emote: null, budget: MAX_MESSAGES_PER_SEC, ip, alive: true }
  players.set(ws, me)
  ws.send(JSON.stringify({ type: 'welcome', id: me.id }))

  // 브라우저는 ping 을 받으면 pong 을 저절로 돌려준다. 돌아오지 않으면 끊긴 연결로 본다
  ws.on('pong', () => {
    me.alive = true
  })

  ws.on('message', (raw) => {
    me.alive = true
    // 너무 자주 보내면 그 메시지는 버린다
    if (me.budget-- <= 0) return
    let msg
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'state') {
      const name = str(msg.name, NAME_MAX)
      if (name) me.name = name
      if (AVATARS.has(msg.avatar)) me.avatar = msg.avatar
      const course = str(msg.course, 40)
      if (course) me.course = course
      me.distance = num(msg.distance, 0, 20000) ?? me.distance
      me.offset = num(msg.offset, -50, 50) ?? me.offset
      me.facing = num(msg.facing, -10, 10) ?? me.facing
      me.jump = num(msg.jump, 0, 5) ?? me.jump
      if (MODES.has(msg.mode)) me.mode = msg.mode
    } else if (msg.type === 'emote' && EMOTES.has(msg.kind)) {
      me.emote = { kind: msg.kind, at: Date.now() }
    }
  })

  ws.on('close', () => drop(ws))
  ws.on('error', () => drop(ws))
})

setInterval(() => {
  const all = [...players.values()]
  const peers = all.map(({ budget: _budget, ip: _ip, alive: _alive, ...p }) => p)
  for (const [ws, me] of players) {
    me.budget = Math.min(MAX_MESSAGES_PER_SEC, me.budget + MAX_MESSAGES_PER_SEC * (TICK_MS / 1000))
    if (ws.readyState !== ws.OPEN) continue
    ws.send(JSON.stringify({ type: 'peers', peers: peers.filter((p) => p.id !== me.id) }))
  }
}, TICK_MS)

// 끊긴 연결 정리: 폰이 잠들거나 와이파이가 끊겨 닫힘 신호 없이 사라진 사람이 화면에 남고 자리를 차지하지 않게 한다
setInterval(() => {
  for (const [ws, me] of players) {
    if (!me.alive) {
      ws.terminate()
      drop(ws)
      continue
    }
    me.alive = false
    ws.ping()
  }
}, HEARTBEAT_MS)

http.listen(PORT, () => console.log(`같이하기 서버: ws://localhost:${PORT} (상태 확인 /health)`))
