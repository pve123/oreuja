import { create } from 'zustand'
import { readStored, writeStored } from './storage'

/**
 * 효과음과 산속 소리. 음원 파일 없이 Web Audio 로 그 자리에서 만든다.
 * 브라우저는 사용자가 한 번 누르기 전에는 소리를 막으므로, 첫 키·클릭에서 소리를 켠다(unlockAudio).
 */

const MUTED_KEY = 'hiking-metaverse:muted'


export const useSound = create<{ muted: boolean; toggle: () => void }>((set, get) => ({
  muted: readStored(MUTED_KEY) === '1',
  toggle: () => {
    const muted = !get().muted
    writeStored(MUTED_KEY, muted ? '1' : '0')
    if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, ctx.currentTime, 0.05)
    set({ muted })
  },
}))

const MASTER_VOLUME = 0.7

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noise: AudioBuffer | null = null
let wind: { gain: GainNode; filter: BiquadFilterNode } | null = null
let birdsLevel = 0
let birdTimer: number | undefined

/** 첫 사용자 입력에서 부른다. 오디오 장치를 열고 바람 소리를 깔고 새소리를 시작한다 */
export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume()
    return
  }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return
  ctx = new AC()
  master = ctx.createGain()
  master.gain.value = useSound.getState().muted ? 0 : MASTER_VOLUME
  master.connect(ctx.destination)

  // 2초짜리 흰 소음. 발소리와 바람이 함께 쓴다
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const data = noise.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

  // 바람: 낮은 소리만 남긴 소음을 끝없이 돌리고, 세기와 음색을 천천히 흔든다
  const src = ctx.createBufferSource()
  src.buffer = noise
  src.loop = true
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 400
  const gain = ctx.createGain()
  gain.gain.value = 0
  src.connect(filter).connect(gain).connect(master)
  src.start()
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 0.13
  const lfoDepth = ctx.createGain()
  lfoDepth.gain.value = 180
  lfo.connect(lfoDepth).connect(filter.frequency)
  lfo.start()
  wind = { gain, filter }

  scheduleBird()
}

/**
 * 고도에 따라 산속 소리를 바꾼다.
 * @param height 0(산 아래)~1(정상). 높을수록 바람이 세지고 새소리는 줄어든다
 */
export function setAmbience(height: number) {
  if (!ctx || !wind) return
  const h = Math.min(1, Math.max(0, height))
  wind.gain.gain.setTargetAtTime(0.025 + h * 0.09, ctx.currentTime, 1.5)
  birdsLevel = 1 - h * 0.85
}

/** 새가 몇 초에 한 번씩 짧게 지저귄다 */
function scheduleBird() {
  window.clearTimeout(birdTimer)
  birdTimer = window.setTimeout(
    () => {
      if (ctx && Math.random() < birdsLevel) chirp()
      scheduleBird()
    },
    1500 + Math.random() * 4000,
  )
}

function chirp() {
  if (!ctx || !master) return
  const t0 = ctx.currentTime
  const base = 2600 + Math.random() * 1800
  const notes = 2 + Math.floor(Math.random() * 4)
  const pan = ctx.createStereoPanner()
  pan.pan.value = Math.random() * 1.6 - 0.8
  pan.connect(master)
  for (let n = 0; n < notes; n++) {
    const t = t0 + n * (0.09 + Math.random() * 0.05)
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(base, t)
    osc.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), t + 0.06)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.03 * birdsLevel, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08)
    osc.connect(g).connect(pan)
    osc.start(t)
    osc.stop(t + 0.1)
  }
}

export type Surface = 'dirt' | 'rock' | 'step'

/** 발소리 한 번. 흙길은 낮고 부드럽게, 바위·돌계단은 짧고 딱딱하게 */
export function playStep(surface: Surface, running: boolean) {
  if (!ctx || !master || !noise) return
  const t = ctx.currentTime
  const src = ctx.createBufferSource()
  src.buffer = noise
  src.playbackRate.value = 0.8 + Math.random() * 0.4
  const filter = ctx.createBiquadFilter()
  const g = ctx.createGain()
  const loud = running ? 1.3 : 1
  if (surface === 'dirt') {
    filter.type = 'lowpass'
    filter.frequency.value = 700 + Math.random() * 300
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.22 * loud, t + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13)
  } else {
    filter.type = 'bandpass'
    filter.frequency.value = (surface === 'step' ? 1800 : 2400) + Math.random() * 600
    filter.Q.value = 1.2
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.28 * loud, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
  }
  src.connect(filter).connect(g).connect(master)
  src.start(t, Math.random() * 1.5)
  src.stop(t + 0.2)
}

/** 짧은 음 하나 */
function tone(freq: number, start: number, length: number, volume: number, type: OscillatorType = 'triangle') {
  if (!ctx || !master) return
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.value = freq
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, start)
  g.gain.linearRampToValueAtTime(volume, start + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, start + length)
  osc.connect(g).connect(master)
  osc.start(start)
  osc.stop(start + length + 0.05)
}

/** 이정표 도착: 딩-동 */
export function playChime() {
  if (!ctx) return
  const t = ctx.currentTime
  tone(880, t, 0.5, 0.12)
  tone(1318.5, t + 0.14, 0.7, 0.12)
}

/** 정상 도착: 짧은 팡파르 */
export function playFanfare() {
  if (!ctx) return
  const t = ctx.currentTime
  const notes = [523.3, 659.3, 784, 1046.5]
  notes.forEach((f, i) => tone(f, t + i * 0.12, 0.35, 0.12, 'square'))
  tone(1046.5, t + 0.5, 1.1, 0.1, 'triangle')
  tone(784, t + 0.5, 1.1, 0.08, 'triangle')
  tone(659.3, t + 0.5, 1.1, 0.07, 'triangle')
}

/** 점프: 뿅 */
export function playJump() {
  if (!ctx || !master) return
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  osc.type = 'square'
  osc.frequency.setValueAtTime(320, t)
  osc.frequency.exponentialRampToValueAtTime(820, t + 0.12)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(0.06, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
  osc.connect(g).connect(master)
  osc.start(t)
  osc.stop(t + 0.2)
}

/** 찰칵 (기념사진) */
export function playShutter() {
  if (!ctx || !master || !noise) return
  const t = ctx.currentTime
  for (const dt of [0, 0.07]) {
    const src = ctx.createBufferSource()
    src.buffer = noise
    const f = ctx.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = 3000
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t + dt)
    g.gain.linearRampToValueAtTime(0.25, t + dt + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.05)
    src.connect(f).connect(g).connect(master)
    src.start(t + dt)
    src.stop(t + dt + 0.08)
  }
}
