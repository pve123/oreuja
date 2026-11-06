/**
 * index.html 에 박아 둔 첫 화면(새벽 산)을 다룬다.
 * 로딩 진행만큼 등산객이 등산로를 따라 정상으로 오르고, 지나온 길이 채워지며, 고도가 올라간다.
 * 진행은 실제 진행만 보여 주고 뒤로 가지 않는다. 장면이 그려지면 안개가 걷히듯 사라진다.
 */

/** 고른 산의 가장 높은 봉우리 해발(m). 진행 100% 가 정상 도착이다. 앱이 고른 산으로 정해 준다 */
let summitAltitude = 836
/** 기다리는 동안 몇 초마다 바꿔 보여 주는 조작 팁 */
const TIPS = [
  '↑ 키로 걷고 ← → 로 몸을 돌려요',
  'Shift 를 같이 누르면 빨리 걸어요',
  'Space 로 바위를 뛰어넘어요',
  '마우스로 끌면 내 캐릭터 정면도 봐요',
  '1 · 2 · 3 으로 다른 등산객에게 인사해요',
  '이정표마다 돌탑·암자·성문이 기다려요',
]
const TIP_MS = 3200
/** 화면 패널이 다 들어오는 시간(ms). src/index.css 의 hud-enter 지연과 길이를 더한 값보다 길게 */
const HUD_ENTER_MS = 1400

const $ = (id: string) => document.getElementById(id)
let shown = 0
let tipTimer: ReturnType<typeof setInterval> | null = null

function startTips() {
  if (tipTimer || !$('splash-tip')) return
  let i = 0
  tipTimer = setInterval(() => {
    const tip = $('splash-tip')
    if (!tip) return stopTips()
    i = (i + 1) % TIPS.length
    tip.style.opacity = '0'
    setTimeout(() => {
      tip.textContent = TIPS[i]
      tip.style.opacity = '1'
    }, 350)
  }, TIP_MS)
}

function stopTips() {
  if (tipTimer) clearInterval(tipTimer)
  tipTimer = null
}

/** 등산객과 지나온 길, 고도를 진행률(0~1)에 맞춘다 */
function climbTo(p: number) {
  const route = $('splash-route') as SVGPathElement | null
  const walked = $('splash-walked') as SVGPathElement | null
  const hiker = $('splash-hiker')
  const alt = $('splash-alt')
  if (route && walked && hiker) {
    // 지나온 길: 길이 len 가운데 앞에서부터 len·p 만큼만 그린다 (HTML 에서는 처음에 비워 둔다)
    const len = route.getTotalLength()
    walked.setAttribute('stroke-dasharray', `${len * p} ${len}`)
    const at = route.getPointAtLength(len * p)
    hiker.setAttribute('transform', `translate(${at.x} ${at.y})`)
  }
  if (alt) alt.textContent = String(Math.round(summitAltitude * p))
}

/** 첫 화면 고도를 오늘 오를 산의 가장 높은 봉우리에 맞춘다 */
export function setSplashAltitude(elevation: number) {
  summitAltitude = elevation
}

/** 지금 단계 문구와 진행률(0~1). 진행률은 앞으로만 간다 */
export function setSplash(text: string, progress?: number) {
  // 앱이 떴다: 실제 진행을 보여 주기 시작한다 (JS 를 받는 동안의 말줄임표를 끈다)
  $('splash')?.classList.add('live')
  startTips()
  const sub = $('splash-sub')
  if (sub && sub.textContent !== text) sub.textContent = text
  if (progress !== undefined) {
    shown = Math.max(shown, Math.min(1, progress))
    climbTo(shown)
  }
}

/** 실패: 문구를 바꾸고 다시 시도 버튼을 띄운다 */
export function failSplash(text: string) {
  stopTips()
  setSplash(text)
  $('splash')?.classList.add('failed')
}

/**
 * 화면 패널들을 차례로 들여보낸다 (src/index.css 의 hud-enter). 첫 화면이 걷힐 때와 베이스캠프를 닫고 걷기 시작할 때 부른다.
 * 끝나면 클래스를 떼어 다시 그릴 때 또 움직이지 않게 한다
 */
let hudEnterTimer: ReturnType<typeof setTimeout> | undefined
export function playHudEnter() {
  document.body.classList.remove('hud-enter')
  void document.body.offsetWidth // 클래스를 뗐다 붙여 애니메이션을 처음부터 다시 돌린다
  document.body.classList.add('hud-enter')
  clearTimeout(hudEnterTimer)
  hudEnterTimer = setTimeout(() => document.body.classList.remove('hud-enter'), HUD_ENTER_MS)
}

/** 정상까지 오르는 모습을 보여 준 뒤 안개가 걷히듯 사라지고, 다 사라지면 DOM 에서 뺀다 */
export function hideSplash() {
  const splash = $('splash')
  if (!splash || splash.classList.contains('done')) return
  stopTips()
  setSplash('정상 도착! 출발해요', 1)
  setTimeout(() => {
    splash.classList.add('done')
    playHudEnter()
    splash.addEventListener('transitionend', () => splash.remove(), { once: true })
    // 동작 줄이기 설정이면 transition 이 없어 transitionend 가 오지 않는다
    setTimeout(() => splash.remove(), 1200)
  }, 450)
}

