// 같이하기 서버: 접속한 사람의 코스·위치·아바타를 모아 1초에 10번 모두에게 나눠 준다.
// 실행: npm run server   (기본 포트 5200, PORT 환경변수로 바꿀 수 있다)
// 개발 중에는 Vite 가 /ws 를 이 서버로 넘겨준다(vite.config.ts).
// 저장하는 것은 없다. 접속이 끊기면 그 사람 정보는 바로 지운다.
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT) || 5200
const TICK_MS = 100 // 위치를 나눠 주는 간격
const MAX_PLAYERS = 50
const MAX_MESSAGE = 512 // 한 메시지 최대 크기(바이트). 위치 메시지는 200바이트 안팎이다
const MAX_MESSAGES_PER_SEC = 30
const NAME_MAX = 12
const AVATARS = new Set(['hiker', 'uncle', 'potato', 'duck', 'tofu'])
const MODES = new Set(['hiking', 'summit', 'photo', 'photoResult'])
const EMOTES = new Set(['wave', 'cheer', 'heart'])

/** @type {Map<import('ws').WebSocket, { id: string, name: string, avatar: string, course: string, distance: number, offset: number, facing: number, jump: number, mode: string, emote: { kind: string, at: number } | null, budget: number }>} */
const players = new Map()
let nextId = 1

const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null)
// 제어 문자와 꺾쇠는 빼고 받는다
// oxlint-disable-next-line no-control-regex
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : null)

const wss = new WebSocketServer({ port: PORT, maxPayload: MAX_MESSAGE })

wss.on('connection', (ws) => {
  if (players.size >= MAX_PLAYERS) {
    ws.close(1013, 'full')
    return
  }
  const me = { id: String(nextId++), name: '등산객', avatar: 'hiker', course: '', distance: 0, offset: 0, facing: 0, jump: 0, mode: 'hiking', emote: null, budget: MAX_MESSAGES_PER_SEC }
  players.set(ws, me)
  ws.send(JSON.stringify({ type: 'welcome', id: me.id }))

  ws.on('message', (raw) => {
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

  ws.on('close', () => players.delete(ws))
  ws.on('error', () => players.delete(ws))
})

setInterval(() => {
  const all = [...players.values()]
  const peers = all.map(({ budget: _budget, ...p }) => p)
  for (const [ws, me] of players) {
    me.budget = Math.min(MAX_MESSAGES_PER_SEC, me.budget + MAX_MESSAGES_PER_SEC * (TICK_MS / 1000))
    if (ws.readyState !== ws.OPEN) continue
    ws.send(JSON.stringify({ type: 'peers', peers: peers.filter((p) => p.id !== me.id) }))
  }
}, TICK_MS)

console.log(`같이하기 서버: ws://localhost:${PORT}`)
