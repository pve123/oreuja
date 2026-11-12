// 같이하기 서버: 접속한 사람의 코스·위치·아바타를 모아 같은 코스를 오르는 사람끼리 나눠 준다.
//
// 보내는 데이터를 줄이려고 이렇게 나눠 보낸다 (호스팅 요금은 나가는 데이터에 붙는다)
//   p  위치: 1초에 5번, 같은 코스를 오르는 사람에게만. 그 코스에서 바뀐 게 없으면 보내지 않는다
//      { t:'p', c:코스, p:[[id, 거리, 옆, 방향, 점프, 모드 번호], ...] }
//   i  이름·아바타: 처음 보는 사람이거나 바뀌었을 때만  { t:'i', i:[[id, 이름, 아바타], ...] }
//   e  감정 표현: 보낸 순간 같은 코스 사람에게 한 번  { t:'e', id, k }
//   c  코스별 오르는 인원: 1초에 한 번, 바뀌었을 때만. 베이스캠프 사람도 받는다  { t:'c', c:{ 코스: 인원 } }
// 실행: npm run server   (기본 포트 5200, PORT 환경변수로 바꿀 수 있다)
// 개발 중에는 Vite 가 /ws 를 이 서버로 넘겨준다(vite.config.ts).
// 저장하는 것은 없다. 접속이 끊기면 그 사람 정보는 바로 지운다.
//
// 환경변수
//   PORT              듣는 포트 (기본 5200). 호스팅 서비스가 정해 주면 그 값을 쓴다
//   ALLOWED_ORIGINS   접속을 받을 페이지 주소, 쉼표로 여럿 (기본: 운영 주소 www.oreuja.com, oreuja.com). localhost 는 늘 받는다
//   TRUST_PROXY       1 이면 X-Forwarded-For 첫 주소를 접속한 사람 IP 로 본다. 호스팅의 프록시 뒤에 둘 때만 켠다
//                     (프록시 없이 켜면 누구나 머리글을 꾸며 IP 제한을 피한다)
//   HEARTBEAT_MS      끊긴 연결을 찾는 간격 (기본 15000). 시험에서만 줄인다
//
// 브라우저 하나에 접속 하나: 클라이언트는 브라우저마다 정한 번호를 주소에 붙여 온다(?cid=…).
// 같은 번호로 새 창이 붙으면 이전 창 연결을 4001(replaced) 로 닫는다. 한 사람이 창을 여러 개 열어도 마지막 창 하나만 센다.
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT) || 5200
const TICK_MS = 200 // 위치를 나눠 주는 간격. 받는 쪽이 사이를 부드럽게 채운다
const COUNT_MS = 1000 // 코스별 인원을 나눠 주는 간격
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS) || 15000
const MAX_PLAYERS = 50
// 같은 IP 에서 동시에 붙을 수 있는 수. 집·학교처럼 한 IP 를 나눠 쓰는 경우를 생각해 넉넉히 둔다
// (한 브라우저는 창을 여러 개 열어도 하나로 세니, 이 수는 거의 사람 수다)
const MAX_PER_IP = 6
const REPLACED = 4001 // 같은 브라우저 다른 창이 붙어서 닫는 연결의 닫힘 코드
const MAX_MESSAGE = 512 // 한 메시지 최대 크기(바이트). 위치 메시지는 200바이트 안팎이다
const MAX_MESSAGES_PER_SEC = 30
const NAME_MAX = 12
const EMOTE_GAP_MS = 500 // 감정 표현 사이 최소 간격
const AVATARS = new Set(['hiker', 'uncle', 'potato', 'duck', 'tofu', 'mini-beard', 'mini-girl', 'mini-kid', 'barbarian', 'ranger', 'knight'])
// lobby 는 베이스캠프(출발 전 고르는 화면). 다른 사람 화면에 그리지 않는다
// 순서가 곧 위치 메시지의 모드 번호다. 클라이언트(src/lib/net.ts)의 MODES 와 같아야 한다
const MODE_LIST = ['lobby', 'hiking', 'summit', 'photo', 'photoResult']
const MODES = new Set(MODE_LIST)
/** 산길 위에 그릴 사람인지 */
const climbing = (p) => p.mode !== 'lobby'
const EMOTES = new Set(['wave', 'thanks', 'yaho', 'cheer', 'summit', 'cheerup', 'fighting'])

const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? 'https://www.oreuja.com,https://oreuja.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)
const TRUST_PROXY = process.env.TRUST_PROXY === '1'

/**
 * 이 페이지에서 온 접속인지. 다른 사이트가 이 서버를 가져다 쓰지 못하게 브라우저가 붙이는 Origin 을 본다.
 * 운영 주소(ALLOWED_ORIGINS)와 Vercel 미리보기 주소, 개발용 localhost 를 받는다.
 * Vercel 프로젝트 이름이 아직 trailverse 라서 미리보기 주소는 trailverse-…-hsl-labs.vercel.app 꼴이다
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

/** 주소에 붙어 온 브라우저 번호. 모양이 틀리면 없는 것으로 본다 */
function clientId(req) {
  // req.url 은 /?cid=… 처럼 뒷부분만 오니 아무 앞부분을 붙여 읽는다
  const cid = new URL(req.url ?? '/', 'http://x').searchParams.get('cid') ?? ''
  return /^[A-Za-z0-9-]{8,64}$/.test(cid) ? cid : ''
}

/** 같은 브라우저에서 이미 붙어 있는 연결 */
function sameBrowser(cid) {
  if (!cid) return null
  for (const [ws, p] of players) if (p.cid === cid) return ws
  return null
}

/** 내 컴퓨터에서 온 접속. 개발 중 창을 여러 개 띄워도 막히지 않게 IP 제한에서 뺀다 */
const isLoopback = (ip) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'

/** @type {Map<import('ws').WebSocket, { id: string, name: string, avatar: string, course: string, distance: number, offset: number, facing: number, jump: number, mode: string, budget: number, ip: string, cid: string, alive: boolean, emoteAt: number, info: number, known: Map<string, number>, sentCourse: string, sentPeers: string, sentCounts: string }>} */
const players = new Map()
/** IP 마다 붙어 있는 연결 수 */
const perIp = new Map()
let nextId = 1
/** 위치나 오르는 사람이 바뀐 코스. 다음 위치 메시지에서 그 코스 사람에게만 보낸다 */
const dirty = new Set()

const round = (v, k) => Math.round(v * k) / k
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
    // 같은 브라우저의 다른 창이 붙어 있으면 그 자리를 넘겨받으니 인원 제한에 걸리지 않는다
    const prev = sameBrowser(clientId(req))
    if (players.size >= MAX_PLAYERS && !prev) return done(false, 503, 'full')
    const ip = clientIp(req)
    if (!isLoopback(ip) && (perIp.get(ip) ?? 0) >= MAX_PER_IP && players.get(prev)?.ip !== ip) return done(false, 429, 'too many')
    done(true)
  },
})

/** 연결 하나를 목록과 IP 별 접속 수에서 뺀다. 그 사람이 있던 코스에는 바뀌었다고 표시한다 */
function drop(ws) {
  const me = players.get(ws)
  if (!me) return
  players.delete(ws)
  dirty.add(me.course)
  const n = (perIp.get(me.ip) ?? 1) - 1
  if (n > 0) perIp.set(me.ip, n)
  else perIp.delete(me.ip)
}

wss.on('connection', (ws, req) => {
  const ip = clientIp(req)
  const cid = clientId(req)
  const prev = sameBrowser(cid)
  if (prev) {
    drop(prev)
    prev.close(REPLACED, 'replaced')
  }
  perIp.set(ip, (perIp.get(ip) ?? 0) + 1)
  const me = {
    id: String(nextId++),
    name: '등산객',
    avatar: 'hiker',
    course: '',
    distance: 0,
    offset: 0,
    facing: 0,
    jump: 0,
    mode: 'lobby',
    budget: MAX_MESSAGES_PER_SEC,
    ip,
    cid,
    alive: true,
    emoteAt: 0,
    info: 0, // 이름·아바타가 바뀔 때마다 늘린다
    known: new Map(), // 이 사람에게 보낸 다른 사람의 info 번호
    sentCourse: '', // 마지막으로 보낸 위치 메시지의 코스와 내용 (같으면 다시 보내지 않는다)
    sentPeers: '',
    sentCounts: '',
  }
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
      const avatar = AVATARS.has(msg.avatar) ? msg.avatar : me.avatar
      if ((name && name !== me.name) || avatar !== me.avatar) {
        me.name = name || me.name
        me.avatar = avatar
        me.info++
      }
      const course = str(msg.course, 40) // 코스 id 는 40자를 넘지 않는다
      if (course && course !== me.course) {
        dirty.add(me.course)
        me.course = course
      }
      // 보낼 때 쓰는 자릿수로 줄여 둔다. 눈에 띄지 않는 떨림으로 코스가 바뀐 것처럼 보이지 않게 한다
      me.distance = round(num(msg.distance, 0, 20000) ?? me.distance, 10)
      me.offset = round(num(msg.offset, -50, 50) ?? me.offset, 100)
      me.facing = round(num(msg.facing, -10, 10) ?? me.facing, 100)
      me.jump = round(num(msg.jump, 0, 5) ?? me.jump, 100)
      if (MODES.has(msg.mode)) me.mode = msg.mode
      dirty.add(me.course)
    } else if (msg.type === 'emote' && EMOTES.has(msg.kind) && climbing(me)) {
      // 한 사람이 보낸 것을 여럿에게 나눠 주니, 너무 자주 누르면 버린다
      const now = Date.now()
      if (now - me.emoteAt < EMOTE_GAP_MS) return
      me.emoteAt = now
      const out = JSON.stringify({ t: 'e', id: me.id, k: msg.kind })
      for (const [other, p] of players) {
        if (p !== me && p.course === me.course && climbing(p) && other.readyState === other.OPEN) other.send(out)
      }
    }
  })

  ws.on('close', () => drop(ws))
  ws.on('error', () => drop(ws))
})

/** 위치 나눠 주기: 바뀐 코스의 오르는 사람에게 같은 코스 다른 사람 위치를 보낸다 */
setInterval(() => {
  // 코스마다 오르는 사람을 모은다
  const byCourse = new Map()
  for (const p of players.values()) {
    p.budget = Math.min(MAX_MESSAGES_PER_SEC, p.budget + MAX_MESSAGES_PER_SEC * (TICK_MS / 1000))
    if (!climbing(p)) continue
    const list = byCourse.get(p.course)
    if (list) list.push(p)
    else byCourse.set(p.course, [p])
  }
  for (const [ws, me] of players) {
    if (ws.readyState !== ws.OPEN) continue
    if (!climbing(me)) {
      // 베이스캠프로 나가면 남은 사람을 지우라고 한 번 알린다
      if (me.sentPeers) sendPeers(ws, me, me.sentCourse, [])
      continue
    }
    if (!dirty.has(me.course) && me.sentCourse === me.course) continue
    const others = (byCourse.get(me.course) ?? []).filter((p) => p !== me)
    // 처음 보거나 이름·아바타가 바뀐 사람만 따로 알린다
    const info = others.filter((p) => me.known.get(p.id) !== p.info)
    if (info.length) {
      for (const p of info) me.known.set(p.id, p.info)
      ws.send(JSON.stringify({ t: 'i', i: info.map((p) => [p.id, p.name, p.avatar]) }))
    }
    sendPeers(ws, me, me.course, others)
  }
  dirty.clear()
}, TICK_MS)

/** 위치 메시지. 지난번과 똑같으면 보내지 않는다 */
function sendPeers(ws, me, course, others) {
  const peers = JSON.stringify(others.map((p) => [p.id, p.distance, p.offset, p.facing, p.jump, MODE_LIST.indexOf(p.mode)]))
  const key = others.length ? peers : ''
  if (course === me.sentCourse && key === me.sentPeers) return
  me.sentCourse = course
  me.sentPeers = key
  ws.send(`{"t":"p","c":${JSON.stringify(course)},"p":${peers}}`)
}

/** 코스별 오르는 인원: 베이스캠프 코스 카드와 같이하기 패널에 쓴다. 바뀐 사람에게만 보낸다 */
setInterval(() => {
  const counts = {}
  for (const p of players.values()) if (climbing(p)) counts[p.course] = (counts[p.course] ?? 0) + 1
  const out = JSON.stringify({ t: 'c', c: counts })
  for (const [ws, me] of players) {
    if (ws.readyState !== ws.OPEN || me.sentCounts === out) continue
    me.sentCounts = out
    ws.send(out)
  }
  // 나간 사람의 info 번호는 지운다 (오래 켜 둔 연결에서 쌓이지 않게)
  const ids = new Set([...players.values()].map((p) => p.id))
  for (const me of players.values()) for (const id of me.known.keys()) if (!ids.has(id)) me.known.delete(id)
}, COUNT_MS)

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
