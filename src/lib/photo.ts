import type { TrailData } from './data'

/** 사진 속 캐릭터 머리 위에 그릴 말풍선. x, y 는 화면 비율(0~1)로 준 말풍선 꼬리 끝 자리 */
export type PhotoBubble = { text: string; x: number; y: number }

/**
 * 3D 캔버스를 그대로 복사하고 기념 문구 띠를 얹어 PNG 데이터 URL 로 돌려준다.
 * 머리 위 감정 표현 말풍선은 3D 캔버스 밖(HTML)이라 복사되지 않아 bubble 을 주면 직접 그린다
 */
export function composePhoto(source: HTMLCanvasElement, trail: TrailData, bubble?: PhotoBubble): string {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(source, 0, 0) // preserveDrawingBuffer 덕분에 마지막 프레임이 남아 있다

  const w = canvas.width
  const h = canvas.height
  const bar = Math.round(h * 0.16)
  const grad = ctx.createLinearGradient(0, h - bar * 1.6, 0, h)
  grad.addColorStop(0, 'rgba(12,18,34,0)')
  grad.addColorStop(1, 'rgba(12,18,34,0.78)')
  ctx.fillStyle = grad
  ctx.fillRect(0, h - bar * 1.6, w, bar * 1.6)

  const pad = Math.round(w * 0.04)
  const font = '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'
  if (bubble) drawBubble(ctx, bubble, w, h, font)
  ctx.fillStyle = '#fff'
  ctx.font = `800 ${Math.round(bar * 0.38)}px ${font}`
  ctx.fillText(`${trail.mountain} ${trail.summit} ${trail.summitElevation}m`, pad, h - bar * 0.55)
  ctx.font = `500 ${Math.round(bar * 0.2)}px ${font}`
  const date = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
  ctx.fillText(`${trail.name} 완등 · ${date}`, pad, h - bar * 0.2)

  // 오른쪽 아래 서비스 이름: 산 모양 표시와 「방구석 등반대」
  const brand = '방구석 등반대'
  const size = Math.round(bar * 0.2)
  ctx.font = `800 ${size}px ${font}`
  const textW = ctx.measureText(brand).width
  const right = w - pad
  const base = h - bar * 0.2
  ctx.fillStyle = '#fdf6ec'
  ctx.textAlign = 'right'
  ctx.fillText(brand, right, base)
  ctx.textAlign = 'left'
  const m = size * 1.1 // 산 표시 크기
  const mx = right - textW - m - size * 0.4
  const my = base - size * 0.85
  ctx.fillStyle = '#ffd58a'
  ctx.beginPath()
  ctx.moveTo(mx, my + m)
  ctx.lineTo(mx + m * 0.38, my + m * 0.3)
  ctx.lineTo(mx + m * 0.55, my + m * 0.55)
  ctx.lineTo(mx + m * 0.72, my)
  ctx.lineTo(mx + m * 1.1, my + m)
  ctx.closePath()
  ctx.fill()

  return canvas.toDataURL('image/png')
}

/** 흰 둥근 말풍선과 아래쪽 꼬리. 화면 밖으로 나가지 않게 안쪽으로 밀어 넣는다 */
function drawBubble(ctx: CanvasRenderingContext2D, bubble: PhotoBubble, w: number, h: number, font: string) {
  const size = Math.round(Math.min(w, h) * 0.05)
  ctx.font = `800 ${size}px ${font}`
  const textW = ctx.measureText(bubble.text).width
  const padX = size * 0.6
  const boxW = textW + padX * 2
  const boxH = size * 1.7
  const tail = size * 0.5
  const tipX = bubble.x * w
  const tipY = Math.max(boxH + tail, bubble.y * h)
  const left = Math.min(Math.max(tipX - boxW / 2, size * 0.5), w - boxW - size * 0.5)
  const top = tipY - tail - boxH
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.25)'
  ctx.shadowBlur = size * 0.5
  ctx.shadowOffsetY = size * 0.12
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.roundRect(left, top, boxW, boxH, boxH / 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(tipX - tail * 0.7, top + boxH - 1)
  ctx.lineTo(tipX, tipY)
  ctx.lineTo(tipX + tail * 0.7, top + boxH - 1)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
  ctx.fillStyle = '#1c2c47'
  ctx.textBaseline = 'middle'
  ctx.fillText(bubble.text, left + padX, top + boxH / 2)
  ctx.textBaseline = 'alphabetic'
}
