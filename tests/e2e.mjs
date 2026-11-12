// 화면 시험: 빌드한 앱(vite preview)과 개발 서버(vite)를 띄우고 헤드리스 크롬으로 실제로 눌러 본다.
// 실행: npm run build && npm run test:e2e   (CHROME_PATH 로 크롬 위치를 바꿀 수 있다. 실패한 시험은 tests/screenshots 에 화면을 남긴다)
// GitHub 의 시험 컴퓨터에는 그래픽 카드가 없어 3D 를 CPU(SwiftShader)로 그려서 몇 배 느리다. 기다리는 시간을 넉넉히 둔다
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const ROOT = path.resolve(import.meta.dirname, '..')
const SHOTS = path.join(ROOT, 'tests/screenshots')
const PREVIEW = 'http://127.0.0.1:4173'
const DEV = 'http://127.0.0.1:5173'
const CI = !!process.env.CI
const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome')
// 맥은 실제 그래픽 카드(Metal), 리눅스 시험 컴퓨터는 SwiftShader
// E2E_GL=swiftshader 를 주면 맥에서도 시험 컴퓨터처럼 CPU 로 그린다 (걸리는 시간을 미리 볼 때)
const SOFTWARE = process.env.E2E_GL === 'swiftshader' || process.platform !== 'darwin'
const GL = SOFTWARE ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal']
const LOAD_MS = CI || SOFTWARE ? 240000 : 90000
/** CPU 로 그리면 초당 몇 장만 그려져 걷는 데도 오래 걸린다. 걷고 기다리는 시간을 이만큼 늘린다 */
const SLOW = SOFTWARE ? 3 : 1
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data', file), 'utf8'))
const mountains = readJson('mountains.json')
/** 코스 id → 코스 데이터 */
const courses = Object.fromEntries(mountains.flatMap((m) => readJson(`${m.id}/courses.json`).map((c) => [c.id, c])))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const DESKTOP = { width: 1280, height: 800 }

function serve(args, url) {
  const child = spawn('npx', ['vite', ...args, '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' })
  return {
    child,
    ready: (async () => {
      for (let i = 0; i < 120; i++) {
        try {
          if ((await fetch(url)).ok) return
        } catch {
          // 아직 뜨는 중
        }
        await wait(500)
      }
      throw new Error(`${url} 이 뜨지 않았다`)
    })(),
  }
}

let browser
async function launch(extraArgs = []) {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--headless=new', '--ignore-gpu-blocklist', '--no-sandbox', ...GL, ...extraArgs],
  })
}

/** 새 창을 열고 첫 화면이 걷힐 때까지 기다린다. store 는 미리 넣어 둘 브라우저 저장 값 */
async function open(b, url, viewport, store = {}) {
  const ctx = await b.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport(viewport)
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.evaluateOnNewDocument((s) => {
    localStorage.setItem('hiking-metaverse:sky', 'day')
    localStorage.setItem('hiking-metaverse:touch-guide', '1')
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v)
  }, store)
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction(() => !document.getElementById('splash'), { timeout: LOAD_MS })
  await wait(1500 * SLOW)
  return { ctx, page, errors }
}

/** 화면의 「정상까지 1.23km」·「정상까지 450m」를 미터로 읽는다 */
const remaining = (page) =>
  page.$eval('.progress-row', (e) => {
    const [, value, unit] = e.textContent.match(/정상까지 ([\d.]+)(k?m)/)
    return unit === 'km' ? value * 1000 : Number(value)
  })
function assert(ok, msg) {
  if (!ok) throw new Error(msg)
}

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('컴퓨터: 베이스캠프에 산이 모두 뜨고 방향키로 걷는다', async () => {
  const { ctx, page, errors } = await open(browser, PREVIEW + '/', DESKTOP, { 'hiking-metaverse:control': 'free' })
  try {
    const tabs = await page.$$eval('.lobby button', (b) => b.filter((x) => /코스 \d+개/.test(x.textContent)).length)
    assert(tabs === mountains.length, `산 탭이 ${tabs}개 (산은 ${mountains.length}개)`)
    await page.click('.lobby-start')
    await wait(2000 * SLOW)
    const before = await remaining(page)
    // 화면의 남은 거리는 10m 단위라, 정해진 시간 대신 숫자가 줄어들 때까지 걷는다 (CPU 로 그리면 초당 한두 장이라 오래 걸린다)
    await page.keyboard.down('ArrowUp')
    const moved = await page
      .waitForFunction((b) => !document.querySelector('.progress-row')?.textContent.includes(b), { timeout: 30000 * SLOW }, `정상까지 ${(before / 1000).toFixed(2)}km`)
      .then(() => true)
      .catch(() => false)
    await page.keyboard.up('ArrowUp')
    const after = await remaining(page)
    assert(moved && after < before, `걷지 않았다 (${before}m → ${after}m)`)
    assert(!errors.length, errors.join(' | '))
  } finally {
    await snapOnFail(page, 'desktop-walk')
    await ctx.close()
  }
})

test('코스를 바꾸면 새 코스 출발점에서 시작한다', async () => {
  const { ctx, page, errors } = await open(browser, PREVIEW + '/', DESKTOP, { 'hiking-metaverse:control': 'free', 'hiking-metaverse:course': 'bukhansan-baegundae' })
  try {
    await page.click('.lobby-start')
    await wait(1500 * SLOW)
    await page.keyboard.down('ArrowUp')
    await wait(2000 * SLOW)
    await page.keyboard.up('ArrowUp')
    await page.keyboard.press('Escape')
    await wait(800 * SLOW)
    await page.evaluate(() => [...document.querySelectorAll('.course-card')].find((c) => c.textContent.includes('북한산성')).click())
    await wait(300 * SLOW)
    const start = await page.$('.lobby-start')
    if (start) await start.click()
    await wait(2500 * SLOW)
    const left = await remaining(page)
    const total = courses['bukhansan-sanseong'].length
    assert(Math.abs(left - total) <= 20, `정상까지 ${left}m 가 코스 길이 ${total}m 와 다르다 (출발점이 아닌 곳에서 시작)`)
    assert(!errors.length, errors.join(' | '))
  } finally {
    await snapOnFail(page, 'course-switch')
    await ctx.close()
  }
})

test('폰: 쉬운 조작 걷기 버튼으로 등산로를 따라 걷고 멈춘다', async () => {
  const { ctx, page, errors } = await open(browser, PREVIEW + '/', PHONE)
  try {
    await page.tap('.lobby-start')
    await wait(2000 * SLOW)
    assert(!(await page.$('.stick-zone')), '쉬운 조작인데 조이스틱이 보인다')
    const before = await remaining(page)
    const shown = await page.$eval('.progress-row', (e) => e.textContent)
    await page.tap('.walk-button')
    await wait(3000 * SLOW)
    const label = await page.$eval('.walk-button', (b) => b.textContent)
    assert(label.includes('멈추기'), `걷는 중 버튼 글이 「${label}」`)
    // 남은 거리는 10m 단위로만 바뀐다. 그래픽 카드 없는 CI 는 화면이 아주 느려 정해 둔 시간 안에 10m 를 못 갈 때가 있어,
    // 정한 시간만 기다리지 않고 표시가 바뀔 때까지 기다린다 (그래도 안 바뀌면 아래 검사가 실패한다)
    await page.waitForFunction((t) => document.querySelector('.progress-row')?.textContent !== t, { timeout: 30000 * SLOW }, shown).catch(() => {})
    await page.tap('.walk-button')
    const after = await remaining(page)
    assert(before - after > 5, `걷기 버튼으로 걷지 않았다 (${before}m → ${after}m)`)
    assert(!errors.length, errors.join(' | '))
  } finally {
    await snapOnFail(page, 'phone-easy-walk')
    await ctx.close()
  }
})

test('폰: 💬 버튼으로 감정 표현을 보낸다', async () => {
  const { ctx, page, errors } = await open(browser, PREVIEW + '/', PHONE)
  try {
    await page.tap('.lobby-start')
    await wait(1500 * SLOW)
    await page.tap('.emote-dial-toggle')
    await wait(400 * SLOW)
    const items = await page.$$('.emote-dial-item')
    assert(items.length === 7, `감정 표현이 ${items.length}개`)
    await items[4].tap()
    await wait(500 * SLOW)
    const bubble = await page.$eval('.emote-bubble', (b) => b.textContent).catch(() => '')
    assert(bubble.includes('정상이다'), `말풍선이 「${bubble}」`)
    assert(!(await page.$('.emote-dial-menu')), '고른 뒤에도 메뉴가 열려 있다')
    assert(!errors.length, errors.join(' | '))
  } finally {
    await snapOnFail(page, 'phone-emote')
    await ctx.close()
  }
})

test('삼성 인터넷처럼 hover 를 알리는 폰에서도 컴퓨터용 패널이 숨는다', async () => {
  // 크롬을 마우스 올리기 가능, 굵은 포인터인 기기로 띄운다
  const b = await launch(['--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=2,availablePointerTypes=2'])
  const { ctx, page, errors } = await open(b, PREVIEW + '/', { width: 412, height: 915, deviceScaleFactor: 2 })
  try {
    await page.click('.lobby-start')
    await wait(1500 * SLOW)
    const shown = (sel) => page.$eval(sel, (e) => getComputedStyle(e).display !== 'none').catch(() => false)
    assert(!(await shown('.together')), '같이하기 패널이 보인다')
    assert(await shown('.walk-button'), '걷기 버튼이 없다')
    assert(!errors.length, errors.join(' | '))
  } finally {
    await snapOnFail(page, 'samsung-like')
    await ctx.close()
    await b.close()
  }
})

test('정상에 닿으면 「정상이다」가 뜨고 기념사진이 만들어진다', async () => {
  const total = courses['bukhansan-baegundae'].length
  const { ctx, page, errors } = await open(browser, `${DEV}/?course=bukhansan-baegundae&d=${total}&photo`, DESKTOP)
  try {
    await page.waitForFunction(() => document.querySelector('.photo-modal img'), { timeout: LOAD_MS })
    const size = await page.$eval('.photo-modal img', (i) => [i.naturalWidth, i.naturalHeight])
    assert(size[0] > 0 && size[1] > 0, '기념사진이 비어 있다')
    assert(!errors.length, errors.join(' | '))
  } finally {
    await snapOnFail(page, 'summit-photo')
    await ctx.close()
  }
})

// E2E_ONLY=걷기 처럼 주면 이름에 그 글이 든 시험만 돈다
if (process.env.E2E_ONLY) tests.splice(0, tests.length, ...tests.filter((t) => t.name.includes(process.env.E2E_ONLY)))

const failed = new Set()
let current = ''
async function snapOnFail(page, name) {
  if (!failed.has(current)) return
  fs.mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {})
}

const preview = serve(['preview', '--port', '4173'], PREVIEW)
const dev = serve(['--port', '5173'], DEV)
let fails = 0
try {
  await Promise.all([preview.ready, dev.ready])
  browser = await launch()
  for (const t of tests) {
    current = t.name
    const t0 = Date.now()
    try {
      // 실패하면 finally 의 화면 저장이 먼저 표시를 봐야 해서, 실패를 미리 표시해 두고 성공하면 지운다
      failed.add(t.name)
      await t.fn()
      failed.delete(t.name)
      console.log(`✓ ${t.name} (${((Date.now() - t0) / 1000).toFixed(0)}초)`)
    } catch (e) {
      fails++
      console.log(`✗ ${t.name} (${((Date.now() - t0) / 1000).toFixed(0)}초)\n    ${e.message}`)
    }
  }
} finally {
  await browser?.close()
  preview.child.kill()
  dev.child.kill()
}
console.log(fails ? `\n화면 시험 ${fails}개 실패` : '\n화면 시험 모두 통과')
process.exit(fails ? 1 : 0)
