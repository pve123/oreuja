import { create } from 'zustand'
import { readStored, writeStored } from './storage'
import type { AvatarKind } from './avatars'
import type { Mode } from './store'

/**
 * 같이하기: 같이하기 서버(server/index.mjs)와 웹소켓으로 위치를 주고받는다.
 * 내 상태는 1초에 5번(바뀌었을 때만) 보내고, 서버는 같은 코스를 오르는 사람 위치를 1초에 5번 나눠 준다.
 * 이름·아바타는 처음 볼 때와 바뀔 때만, 코스별 인원은 1초에 한 번 따로 온다(server/index.mjs 맨 위 설명).
 * 서버가 꺼져 있으면 혼자 오르기로 동작하고 몇 초마다 다시 붙어 본다.
 */

type Emote = 'wave' | 'thanks' | 'yaho' | 'cheer' | 'summit' | 'cheerup' | 'fighting'
/** 감정 표현. 버튼에는 그림(icon)을, 머리 위 말풍선에는 그림과 말(label)을 띄운다. 숫자 키(key)로도 보낸다 */
export const EMOTES: { kind: Emote; icon: string; label: string; key: string }[] = [
  { kind: 'wave', icon: '👋', label: '안녕하세요', key: '1' },
  { kind: 'thanks', icon: '🙏', label: '감사합니다', key: '2' },
  { kind: 'yaho', icon: '📣', label: '야호', key: '3' },
  { kind: 'cheer', icon: '🙌', label: '만세', key: '4' },
  { kind: 'summit', icon: '⛰️🚩', label: '정상이다', key: '5' },
  { kind: 'cheerup', icon: '💪', label: '힘내세요', key: '6' },
  { kind: 'fighting', icon: '🔥', label: '파이팅', key: '7' },
]
/** 머리 위 말풍선에 띄울 글 */
export const emoteBubble = (kind: string) => {
  const e = EMOTES.find((x) => x.kind === kind)
  return e ? `${e.icon} ${e.label}` : ''
}
/** 감정 표현 말풍선이 떠 있는 시간(ms) */
export const EMOTE_MS = 3000

export type Peer = {
  id: string
  name: string
  avatar: AvatarKind
  course: string
  distance: number
  offset: number
  facing: number
  jump: number
  mode: Mode
  /** at 은 받은 순간의 내 시계 */
  emote: { kind: Emote; at: number } | null
}

// 순서가 곧 위치 메시지의 모드 번호다. 서버(server/index.mjs)의 MODE_LIST 와 같아야 한다
const MODES: Mode[] = ['lobby', 'hiking', 'summit', 'photo', 'photoResult']

/** replaced 는 같은 브라우저의 다른 창이 같이하기를 넘겨받은 상태 (이 창은 다시 붙지 않는다) */
type NetStatus = 'connecting' | 'online' | 'offline' | 'replaced'

const SEND_MS = 200
const RETRY_MS = 5000
const NAME_KEY = 'hiking-metaverse:nickname'
const CLIENT_KEY = 'hiking-metaverse:client-id'
/** 서버가 같은 브라우저 다른 창이 붙었다며 닫을 때 쓰는 코드 (server/index.mjs 의 REPLACED) */
const REPLACED = 4001

/** 산길 위에 그릴 사람인지. 베이스캠프에 있는 사람은 빼고 센다 */
export const isClimbing = (p: Pick<Peer, 'mode'>) => p.mode !== 'lobby'

/**
 * 나를 뺀, 산을 오르는 사람 수. course 를 주면 그 코스만 센다.
 * 서버가 주는 인원에는 나도 들어 있어서, 내가 오르는 중이면 내 코스에서 하나 뺀다
 */
export function othersClimbing(counts: Record<string, number>, course?: string) {
  const all = course === undefined ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[course] ?? 0)
  const mine = isClimbing(localPlayer) && (course === undefined || course === localPlayer.course) ? 1 : 0
  return Math.max(0, all - mine)
}

// 처음 붙는 닉네임: 산 오르는 모습 + 산악회 역할. 둘을 합쳐 12자(NAME_MAX)를 넘지 않게 고른 말들이다
const MOODS = ['새벽', '숨찬', '느긋한', '씩씩한', '땀범벅', '쉬엄쉬엄', '성큼성큼', '헉헉대는', '앞서가는', '뒤처진', '길 잃은', '배고픈', '안개 속', '비 맞은', '신난', '졸린']
const ROLES = ['산꾼', '등산객', '산악회장', '총무', '선두', '후미', '길잡이', '막내', '대장', '백패커', '종주꾼', '암벽꾼', '김밥 담당', '컵라면 담당', '막걸리 담당', '물통지기', '스틱 요정', '정상 사냥꾼']

function randomName() {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
  return `${pick(MOODS)} ${pick(ROLES)}`
}

function loadName() {
  const saved = readStored(NAME_KEY)
  if (saved) return saved
  const name = randomName()
  writeStored(NAME_KEY, name)
  return name
}

/** 화면에 보일 만큼만 바뀌는 값(React 가 다시 그린다). 위치는 useFrame 에서 peers 를 직접 읽는다 */
export const useNet = create<{
  status: NetStatus
  myId: string | null
  name: string
  /** 같은 코스를 오르는 다른 사람들 (서버가 같은 코스 사람만 보낸다) */
  peers: Peer[]
  /** 코스별 오르는 인원 (나도 들어 있다. othersClimbing 으로 센다) */
  counts: Record<string, number>
  /** 내가 마지막으로 보낸 감정 표현 (내 머리 위에도 띄운다) */
  myEmote: { kind: Emote; at: number } | null
  setName: (name: string) => void
}>((set) => ({
  status: 'connecting',
  myId: null,
  name: loadName(),
  peers: [],
  counts: {},
  myEmote: null,
  setName: (name) => {
    // 제어 문자와 꺾쇠는 이름표에 그대로 찍히지 않게 뺀다
    // oxlint-disable-next-line no-control-regex
    const clean = name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12)
    if (!clean) return
    writeStored(NAME_KEY, clean)
    set({ name: clean })
  },
}))

/** World 가 매 프레임 채우는 내 상태 (보낼 때 읽는다) */
export const localPlayer = {
  course: '',
  avatar: 'hiker' as AvatarKind,
  distance: 0,
  offset: 0,
  facing: 0,
  jump: 0,
  mode: 'hiking' as Mode,
}

/**
 * 브라우저마다 한 번 정해 두는 번호. 서버는 같은 번호로 붙은 창을 한 사람으로 보고 마지막 창 하나만 남긴다.
 * 비밀이 아니라 창을 묶는 데만 쓴다. localStorage 를 못 쓰면 창마다 새 번호가 된다
 */
function clientId() {
  const saved = readStored(CLIENT_KEY)
  if (saved && /^[A-Za-z0-9-]{8,64}$/.test(saved)) return saved
  // randomUUID 는 https·localhost 에서만 있다. 폰으로 내부 IP(http) 에 붙을 때를 위해 대신할 값을 둔다
  const id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  writeStored(CLIENT_KEY, id)
  return id
}

/** 같이하기 서버 주소. null 이면 서버 없이 혼자 오르기로만 동작한다 */
function serverUrl(): string | null {
  const fromEnv = import.meta.env.VITE_MULTIPLAYER_URL as string | undefined
  // 개발 서버만 /ws 를 같이하기 서버로 넘겨준다(vite.config.ts).
  // Vercel 같은 정적 호스팅에는 웹소켓 서버가 없어서, 주소를 따로 주지 않은 배포본은 붙어 보지 않는다
  const base = fromEnv || (import.meta.env.DEV ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws` : null)
  if (!base) return null
  const url = new URL(base)
  url.searchParams.set('cid', clientId())
  return url.toString()
}

let socket: WebSocket | null = null
let sendTimer: number | undefined
let retryTimer: number | undefined
let started = false
/** 마지막으로 보낸 내 상태. 같으면 다시 보내지 않는다 */
let lastSent = ''
/** 서버가 알려 준 다른 사람 이름·아바타 */
const profiles = new Map<string, { name: string; avatar: AvatarKind }>()
/** 다른 사람이 보낸 감정 표현 (위치 메시지가 새로 와도 남긴다) */
const emotes = new Map<string, { kind: Emote; at: number }>()

/** 앱이 뜰 때 한 번 부른다. 끊기면 알아서 다시 붙는다 */
export function startNet() {
  if (started) return
  started = true
  const url = serverUrl()
  if (!url) {
    useNet.setState({ status: 'offline' })
    return
  }
  connect(url)
}

function connect(url: string) {
  useNet.setState({ status: 'connecting' })
  let ws: WebSocket
  try {
    ws = new WebSocket(url)
  } catch {
    scheduleRetry()
    return
  }
  socket = ws
  ws.onopen = () => {
    useNet.setState({ status: 'online' })
    lastSent = ''
    window.clearInterval(sendTimer)
    sendTimer = window.setInterval(sendState, SEND_MS)
  }
  ws.onmessage = (e) => {
    let msg: ServerMessage
    try {
      msg = JSON.parse(String(e.data))
    } catch {
      return
    }
    receive(msg)
  }
  ws.onclose = (e) => {
    if (socket === ws) socket = null
    window.clearInterval(sendTimer)
    profiles.clear()
    emotes.clear()
    // 다른 창이 넘겨받았으면 다시 붙지 않는다 (붙으면 그 창을 밀어내 서로 번갈아 끊긴다)
    const replaced = e.code === REPLACED
    useNet.setState({ status: replaced ? 'replaced' : 'offline', peers: [], counts: {}, myId: null })
    if (!replaced) scheduleRetry()
  }
}

/** 다른 창에 넘겨준 같이하기를 이 창으로 다시 가져온다 */
export function reclaimNet() {
  const url = serverUrl()
  if (url && useNet.getState().status === 'replaced') connect(url)
}

type ServerMessage =
  | { type: 'welcome'; id: string }
  | { t: 'p'; c: string; p: [string, number, number, number, number, number][] }
  | { t: 'i'; i: [string, string, AvatarKind][] }
  | { t: 'e'; id: string; k: Emote }
  | { t: 'c'; c: Record<string, number> }

function receive(msg: ServerMessage) {
  if ('type' in msg) {
    if (msg.type === 'welcome' && typeof msg.id === 'string') useNet.setState({ myId: msg.id })
    return
  }
  if (msg.t === 'i' && Array.isArray(msg.i)) {
    for (const [id, name, avatar] of msg.i) profiles.set(id, { name, avatar })
  } else if (msg.t === 'p' && Array.isArray(msg.p)) {
    const peers: Peer[] = []
    for (const [id, distance, offset, facing, jump, mode] of msg.p) {
      const profile = profiles.get(id)
      if (!profile) continue // 이름·아바타가 먼저 온다. 없으면 다음 메시지를 기다린다
      peers.push({
        id,
        ...profile,
        course: msg.c,
        distance,
        offset,
        facing,
        jump,
        mode: MODES[mode] ?? 'hiking',
        emote: emotes.get(id) ?? null,
      })
    }
    useNet.setState({ peers })
  } else if (msg.t === 'e') {
    const emote = { kind: msg.k, at: Date.now() }
    emotes.set(msg.id, emote)
    useNet.setState((s) => ({
      peers: s.peers.map((p) => (p.id === msg.id ? { ...p, emote } : p)),
    }))
  } else if (msg.t === 'c' && msg.c && typeof msg.c === 'object') {
    useNet.setState({ counts: msg.c })
  }
}

function scheduleRetry() {
  window.clearTimeout(retryTimer)
  const url = serverUrl()
  if (url) retryTimer = window.setTimeout(() => connect(url), RETRY_MS)
}

function sendState() {
  if (!socket || socket.readyState !== WebSocket.OPEN || !localPlayer.course) return
  const p = localPlayer
  const state = JSON.stringify({
    type: 'state',
    name: useNet.getState().name,
    avatar: p.avatar,
    course: p.course,
    distance: Math.round(p.distance * 100) / 100,
    offset: Math.round(p.offset * 100) / 100,
    facing: Math.round(p.facing * 100) / 100,
    jump: Math.round(p.jump * 100) / 100,
    mode: p.mode,
  })
  // 멈춰 서 있으면 보내지 않는다 (서버는 마지막 상태를 들고 있다)
  if (state === lastSent) return
  lastSent = state
  socket.send(state)
}

/** 감정 표현을 보내고 내 머리 위에도 띄운다 */
export function sendEmote(kind: Emote) {
  useNet.setState({ myEmote: { kind, at: Date.now() } })
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'emote', kind }))
}
