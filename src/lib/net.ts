import { create } from 'zustand'
import type { AvatarKind } from './avatars'
import type { Mode } from './store'

/**
 * 같이하기: 같이하기 서버(server/index.mjs)와 웹소켓으로 위치를 주고받는다.
 * 내 상태는 1초에 10번 보내고, 서버는 다른 사람들 상태를 1초에 10번 나눠 준다.
 * 서버가 꺼져 있으면 혼자 오르기로 동작하고 몇 초마다 다시 붙어 본다.
 */

export type Emote = 'wave' | 'thanks' | 'yaho' | 'cheer' | 'summit' | 'cheerup' | 'fighting'
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
  /** hidden 은 혼자 오르기를 고른 사람 (화면에 그리지 않는다) */
  mode: Mode | 'hidden'
  emote: { kind: Emote; at: number } | null
}

export type NetStatus = 'connecting' | 'online' | 'offline'

const SEND_MS = 100
const RETRY_MS = 5000
const NAME_KEY = 'hiking-metaverse:nickname'

/** 산길 위에 그릴 사람인지. 베이스캠프에 있는 사람과 숨김(hidden)으로 알린 사람은 빼고 센다 */
export const isClimbing = (p: Peer) => p.mode !== 'lobby' && p.mode !== 'hidden'

// 처음 붙는 닉네임: 산 오르는 모습 + 산악회 역할. 둘을 합쳐 12자(NAME_MAX)를 넘지 않게 고른 말들이다
const MOODS = ['새벽', '숨찬', '느긋한', '씩씩한', '땀범벅', '쉬엄쉬엄', '성큼성큼', '헉헉대는', '앞서가는', '뒤처진', '길 잃은', '배고픈', '안개 속', '비 맞은', '신난', '졸린']
const ROLES = ['산꾼', '등산객', '산악회장', '총무', '선두', '후미', '길잡이', '막내', '대장', '백패커', '종주꾼', '암벽꾼', '김밥 담당', '컵라면 담당', '막걸리 담당', '물통지기', '스틱 요정', '정상 사냥꾼']

function randomName() {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
  return `${pick(MOODS)} ${pick(ROLES)}`
}

function loadName() {
  try {
    const saved = localStorage.getItem(NAME_KEY)
    if (saved) return saved
    const name = randomName()
    localStorage.setItem(NAME_KEY, name)
    return name
  } catch {
    return randomName()
  }
}

/** 화면에 보일 만큼만 바뀌는 값(React 가 다시 그린다). 위치는 useFrame 에서 peers 를 직접 읽는다 */
export const useNet = create<{
  status: NetStatus
  myId: string | null
  name: string
  peers: Peer[]
  /** 내가 마지막으로 보낸 감정 표현 (내 머리 위에도 띄운다) */
  myEmote: { kind: Emote; at: number } | null
  setName: (name: string) => void
}>((set) => ({
  status: 'connecting',
  myId: null,
  name: loadName(),
  peers: [],
  myEmote: null,
  setName: (name) => {
    // 제어 문자와 꺾쇠는 이름표에 그대로 찍히지 않게 뺀다
    // oxlint-disable-next-line no-control-regex
    const clean = name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12)
    if (!clean) return
    try {
      localStorage.setItem(NAME_KEY, clean)
    } catch {
      // 저장소를 못 쓰는 환경이면 이번 접속에만 쓴다
    }
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

/** 같이하기 서버 주소. null 이면 서버 없이 혼자 오르기로만 동작한다 */
function serverUrl(): string | null {
  const fromEnv = import.meta.env.VITE_MULTIPLAYER_URL as string | undefined
  if (fromEnv) return fromEnv
  // 개발 서버만 /ws 를 같이하기 서버로 넘겨준다(vite.config.ts).
  // Vercel 같은 정적 호스팅에는 웹소켓 서버가 없어서, 주소를 따로 주지 않은 배포본은 붙어 보지 않는다
  return import.meta.env.DEV ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws` : null
}

let socket: WebSocket | null = null
let sendTimer: number | undefined
let retryTimer: number | undefined
let started = false

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
    window.clearInterval(sendTimer)
    sendTimer = window.setInterval(sendState, SEND_MS)
  }
  ws.onmessage = (e) => {
    let msg: { type?: string; id?: string; peers?: Peer[] }
    try {
      msg = JSON.parse(String(e.data))
    } catch {
      return
    }
    if (msg.type === 'welcome' && typeof msg.id === 'string') useNet.setState({ myId: msg.id })
    else if (msg.type === 'peers' && Array.isArray(msg.peers)) useNet.setState({ peers: msg.peers })
  }
  ws.onclose = () => {
    if (socket === ws) socket = null
    window.clearInterval(sendTimer)
    useNet.setState({ status: 'offline', peers: [], myId: null })
    scheduleRetry()
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
  socket.send(
    JSON.stringify({
      type: 'state',
      name: useNet.getState().name,
      avatar: p.avatar,
      course: p.course,
      distance: Math.round(p.distance * 100) / 100,
      offset: Math.round(p.offset * 100) / 100,
      facing: Math.round(p.facing * 100) / 100,
      jump: Math.round(p.jump * 100) / 100,
      mode: p.mode,
    }),
  )
}

/** 감정 표현을 보내고 내 머리 위에도 띄운다 */
export function sendEmote(kind: Emote) {
  useNet.setState({ myEmote: { kind, at: Date.now() } })
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'emote', kind }))
}
