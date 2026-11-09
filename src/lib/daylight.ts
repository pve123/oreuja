import * as THREE from 'three'
import { readStored, writeStored } from './storage'
import { create } from 'zustand'

/**
 * 하루 시간대. 기본은 대한민국 실제 시각(KST)의 해 위치로 하늘과 빛을 정한다.
 * 새벽에는 푸르스름한 여명, 해 뜰 때와 질 때는 주황빛, 낮에는 환한 햇빛, 밤에는 달빛과 별이다.
 * 베이스캠프에서 「새벽」「낮」「노을」「밤」을 고르면 그 시간대의 해 높이로 고정한다 (useSky).
 * World 의 Daylight 가 매 프레임 계산해 아래 공유 값들을 채우고, 조명·하늘·안개·지형이 읽어 쓴다.
 *
 * 개발 중에는 주소에 ?time=05:40 이나 ?time=12-21T17:30 을 붙여 「지금」을 그 시각으로 볼 수 있다.
 */

/** 서울 위도·경도. 해 위치 계산에 쓴다 (산마다 다르지만 몇 km 차이는 티가 나지 않는다) */
const LAT = 37.6
const LON = 127.0
/** 한국 표준시 기준 경선(°). 시계 시각과 태양시의 차이를 보정한다 */
const KST_MERIDIAN = 135
const KST_OFFSET_MS = 9 * 3600 * 1000

/** 조명(그림자) 방향에 쓰는 해 높이의 아래 한계(°). 지평선에 붙은 해로 비추면 비탈이 온통 제 그림자에 묻힌다 */
const LIGHT_MIN_ELEVATION = 7
/** 달은 늘 남쪽 하늘 이 높이에 둔다 (실제 달 위치까지는 따라가지 않는다) */
const MOON_ELEVATION = 45

/** 태양 조명 방향 (단위 벡터). Daylight 가 매 프레임 갱신한다 */
export const SUN = new THREE.Vector3(0.6, 0.55, 0.3).normalize()
/** 달빛 방향 (단위 벡터, 고정) */
export const MOON = new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(MOON_ELEVATION)), Math.cos(THREE.MathUtils.degToRad(MOON_ELEVATION))).normalize()

export type Phase = '새벽' | '아침' | '낮' | '저녁' | '밤'

/** 시간대 값 묶음. 화면에 쓰는 값(daylight)과 목표값(target)이 같은 모양이다 */
const lightState = () => ({
  /** 해 높이(°). 지평선이 0, 아래면 음수 */
  elevation: 0,
  /** 해 방위(°). 북쪽 0, 동쪽 90 */
  azimuth: 90,
  phase: '낮' as Phase,
  /** 하늘 셰이더에 넣을 해 방향 */
  skySun: new THREE.Vector3(),
  sunColor: new THREE.Color(),
  sunIntensity: 0,
  moonIntensity: 0,
  skyColor: new THREE.Color(),
  groundColor: new THREE.Color(),
  hemiIntensity: 0,
  fogColor: new THREE.Color(),
  /** 위성사진 지형의 발광 세기. 어두울수록 낮춰 사진이 스스로 빛나지 않게 한다 */
  photoEmissive: 0,
  /** 별이 보이는 정도 0~1 */
  stars: 0,
  rayleigh: 0,
  turbidity: 0,
  mie: 0,
})

/** 지금 화면에 쓰는 시간대 값. 하늘을 바꾸면 목표값(target) 쪽으로 1초쯤에 걸쳐 옮겨 간다 (settle). Daylight 가 매 프레임 갱신한다 */
export const daylight = lightState()

/** 고른 하늘의 목표값. applyDaylight 가 채우고 settle 이 daylight 를 이쪽으로 옮긴다. sun 은 조명 방향(SUN)의 목표 */
const target = { ...lightState(), sun: new THREE.Vector3() }

/** 하늘이 바뀔 때 자리 잡는 시간 상수(초). 1초쯤 지나면 거의 다 옮겨 간다 */
const BLEND_TAU = 0.35
const BLEND_NUMBERS = ['elevation', 'azimuth', 'sunIntensity', 'moonIntensity', 'hemiIntensity', 'photoEmissive', 'stars', 'rayleigh', 'turbidity', 'mie'] as const
const BLEND_COLORS = ['sunColor', 'skyColor', 'groundColor', 'fogColor'] as const

/** daylight 를 목표값 쪽으로 옮긴다. dt 는 지난 시간(초). Infinity 면 바로 맞춘다 (앱이 뜰 때) */
export function settle(dt: number) {
  const k = dt === Infinity ? 1 : 1 - Math.exp(-dt / BLEND_TAU)
  for (const f of BLEND_NUMBERS) daylight[f] += (target[f] - daylight[f]) * k
  for (const f of BLEND_COLORS) daylight[f].lerp(target[f], k)
  daylight.skySun.lerp(target.skySun, k).normalize()
  SUN.lerp(target.sun, k).normalize()
  daylight.phase = target.phase
}

/** 지금 한국 시각. 기기의 시간대와 상관없이 KST 로 본다. 반환값은 UTC 필드(getUTC*)로 읽어야 한다 */
export function kstNow(): Date {
  return new Date(Date.now() + KST_OFFSET_MS)
}

/** 개발용 ?time= 값을 KST 시각으로. 'HH:MM' 은 오늘, 'MM-DDTHH:MM' 은 올해 그 날 */
export function parseDebugTime(value: string | null): Date | null {
  if (!value) return null
  const m = /^(?:(\d{1,2})-(\d{1,2})T)?(\d{1,2}):(\d{2})$/.exec(value)
  if (!m) return null
  const d = kstNow()
  if (m[1]) d.setUTCMonth(Number(m[1]) - 1, Number(m[2]))
  d.setUTCHours(Number(m[3]), Number(m[4]), 0, 0)
  return d
}

/** KST 시각의 해 높이와 방위(°). NOAA 근사식 */
function solarPosition(kst: Date) {
  const rad = THREE.MathUtils.degToRad
  const start = Date.UTC(kst.getUTCFullYear(), 0, 1)
  const dayOfYear = Math.floor((kst.getTime() - start) / 86400000) + 1
  const B = rad((360 / 365) * (dayOfYear - 81))
  const declination = 23.44 * Math.sin(B)
  const equationOfTime = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B) // 분
  const clockMinutes = kst.getUTCHours() * 60 + kst.getUTCMinutes() + kst.getUTCSeconds() / 60
  const solarMinutes = clockMinutes + 4 * (LON - KST_MERIDIAN) + equationOfTime
  const hourAngle = (solarMinutes / 4 - 180) // 정오가 0, 오후가 +
  const sinE = Math.sin(rad(LAT)) * Math.sin(rad(declination)) + Math.cos(rad(LAT)) * Math.cos(rad(declination)) * Math.cos(rad(hourAngle))
  const elevation = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(sinE, -1, 1)))
  const cosA = (Math.sin(rad(declination)) - sinE * Math.sin(rad(LAT))) / (Math.cos(rad(elevation)) * Math.cos(rad(LAT)))
  let azimuth = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(cosA, -1, 1)))
  if (hourAngle > 0) azimuth = 360 - azimuth // 오후에는 서쪽
  return { elevation, azimuth }
}

/** 해 높이와 시각(오전·오후)으로 시간대 이름을 정한다 */
function phaseOf(elevation: number, morning: boolean): Phase {
  if (elevation < -8) return '밤'
  if (elevation < 10) return morning ? (elevation < 0 ? '새벽' : '아침') : '저녁'
  return '낮'
}

const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b)

// 밤은 달빛의 남색, 새벽·저녁은 실제 여명처럼 푸르스름하지만 게임답게 충분히 밝게, 낮은 환하게
const NIGHT_SKY = new THREE.Color('#4a5a88')
const DAWN_SKY = new THREE.Color('#a9b7dc')
const DAY_SKY = new THREE.Color('#dfefff')
const NIGHT_GROUND = new THREE.Color('#222a45')
const DAWN_GROUND = new THREE.Color('#4a5370')
const DAY_GROUND = new THREE.Color('#4a5d3a')
const NIGHT_FOG = new THREE.Color('#2a3350')
const DAWN_FOG = new THREE.Color('#95a0c0')
const DAY_FOG = new THREE.Color('#c9d6e3')
const GLOW_FOG = new THREE.Color('#e6b89a')
/** 해 뜨기 전 하늘빛(푸른 기), 지평선의 해(주황), 떠오른 해(따뜻한 흰색) */
const DAWN_SUN = new THREE.Color('#aebbe8')
const LOW_SUN = new THREE.Color('#ff9a5c')
const HIGH_SUN = new THREE.Color('#fff1dc')
export const MOON_COLOR = new THREE.Color('#8fa3d9')

/** 해 높이(°)와 방위(°)로 조명·하늘·안개 목표값을 채운다 */
function applyDaylight(elevation: number, azimuth: number, morning: boolean) {
  const d = target
  d.elevation = elevation
  d.azimuth = azimuth
  d.phase = phaseOf(elevation, morning)
  // 여명 정도 0(밤)~1(새벽), 낮 정도 0(새벽)~1(아침)
  const dawn = smooth(-10, -3, elevation)
  const day = smooth(-4, 10, elevation)
  // 지평선 가까이에서 가장 붉게 물든다
  const glow = 1 - Math.min(1, Math.abs(elevation - 0.5) / 5)

  const rad = THREE.MathUtils.degToRad
  // 방위 → 로컬 좌표 (x 동쪽, z 남쪽)
  const hx = Math.sin(rad(azimuth))
  const hz = -Math.cos(rad(azimuth))
  // 하늘 셰이더는 해가 지평선 조금 아래까지만 밝고, 더 내려가면 서서히 캄캄해진다
  const skyElev = elevation >= -1 ? elevation : -1 - (-1 - elevation) * 0.4
  d.skySun.set(Math.cos(rad(skyElev)) * hx, Math.sin(rad(skyElev)), Math.cos(rad(skyElev)) * hz)
  const lightElev = Math.max(elevation, LIGHT_MIN_ELEVATION)
  d.sun.set(Math.cos(rad(lightElev)) * hx, Math.sin(rad(lightElev)), Math.cos(rad(lightElev)) * hz)

  // 해가 뜨기 전에도 동쪽 하늘빛이 약하게 비춘다 (푸른 기). 지평선에서 주황으로, 떠오르면 따뜻한 흰색으로. 밤에는 꺼진다
  d.sunIntensity = THREE.MathUtils.lerp(0.9, 2.2, smooth(-2, 6, elevation)) * dawn
  d.sunColor.copy(DAWN_SUN).lerp(LOW_SUN, smooth(-2.5, 0.5, elevation)).lerp(HIGH_SUN, smooth(1, 12, elevation))
  // 달빛은 실제보다 훨씬 밝게 둔다. 밤에도 길과 나무가 보여야 한다
  d.moonIntensity = 1.3 * (1 - dawn)
  d.skyColor.copy(NIGHT_SKY).lerp(DAWN_SKY, dawn).lerp(DAY_SKY, day)
  d.groundColor.copy(NIGHT_GROUND).lerp(DAWN_GROUND, dawn).lerp(DAY_GROUND, day)
  // 해가 없을 때는 하늘빛으로 더 많이 비춘다
  d.hemiIntensity = THREE.MathUtils.lerp(THREE.MathUtils.lerp(1.1, 1.5, dawn), 0.6, day)
  d.fogColor.copy(NIGHT_FOG).lerp(DAWN_FOG, dawn).lerp(DAY_FOG, day).lerp(GLOW_FOG, glow * 0.55)
  d.photoEmissive = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.22, 0.3, dawn), 0.45, day)
  d.stars = 1 - smooth(-9, -3, elevation)
  d.rayleigh = THREE.MathUtils.lerp(2.6, 1.2, day)
  d.turbidity = THREE.MathUtils.lerp(9, 6, day)
  d.mie = THREE.MathUtils.lerp(0.004, 0.02, glow)
}

/** 시각으로 바로 채운다 */
function applyTime(kst: Date) {
  const { elevation, azimuth } = solarPosition(kst)
  applyDaylight(elevation, azimuth, kst.getUTCHours() < 12)
}

/** 지금 한국 시각의 시간대 이름 (고른 하늘과 상관없이) */
export function currentPhase(): Phase {
  const now = kstNow()
  return phaseOf(solarPosition(now).elevation, now.getUTCHours() < 12)
}

/** 베이스캠프에서 고르는 하늘. now 는 실제 한국 시각을 따라가고 나머지는 해 높이를 고정한다 */
export type SkyPreset = 'now' | 'dawn' | 'day' | 'sunset' | 'night'
export const SKY_PRESETS: { kind: SkyPreset; label: string }[] = [
  { kind: 'now', label: '지금' },
  { kind: 'dawn', label: '새벽' },
  { kind: 'day', label: '낮' },
  { kind: 'sunset', label: '노을' },
  { kind: 'night', label: '밤' },
]
/** 고정 하늘의 해 높이·방위(°)와 오전 여부. 시각이 아니라 해 높이로 정해서 계절이 바뀌어도 같은 하늘이 나온다 */
const FIXED_SKY: Record<Exclude<SkyPreset, 'now'>, { elevation: number; azimuth: number; morning: boolean }> = {
  // 해 뜨기 20분쯤 전. 동쪽 하늘이 푸르스름하고 지평선에 주황빛이 살짝 돈다
  dawn: { elevation: -3.5, azimuth: 105, morning: true },
  // 한낮. 남쪽에서 비춰 그림자가 또렷하다
  day: { elevation: 50, azimuth: 190, morning: false },
  // 해가 서쪽 지평선에 걸린 순간. 가장 붉다
  sunset: { elevation: 0.5, azimuth: 255, morning: false },
  // 해가 완전히 진 뒤. 달빛과 별
  night: { elevation: -20, azimuth: 300, morning: false },
}
const SKY_KEY = 'hiking-metaverse:sky'

function loadSky(): SkyPreset {
  const v = readStored(SKY_KEY)
  return SKY_PRESETS.some((p) => p.kind === v) ? (v as SkyPreset) : 'now'
}

/** 고른 하늘대로 목표값을 채운다. now 면 실제 시각(개발 중에는 ?time= 값). Daylight 가 매 프레임 부르고 이어서 settle 한다 */
export function applySky(preset: SkyPreset, now: Date = kstNow()) {
  if (preset === 'now') return applyTime(now)
  const f = FIXED_SKY[preset]
  applyDaylight(f.elevation, f.azimuth, f.morning)
}

/** 고른 하늘 (브라우저에 기억). 바꾸면 1초쯤에 걸쳐 그 하늘로 옮겨 간다 */
export const useSky = create<{ preset: SkyPreset; setPreset: (preset: SkyPreset) => void }>((set) => ({
  preset: loadSky(),
  setPreset: (preset) => {
    writeStored(SKY_KEY, preset)
    set({ preset })
  },
}))

// 앱이 뜨기 전 기본값. 처음에는 바로 맞춘다
applySky(loadSky())
settle(Infinity)
