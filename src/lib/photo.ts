import type { TrailData } from './data'

/** 3D 캔버스를 그대로 복사하고 기념 문구 띠를 얹어 PNG 데이터 URL 로 돌려준다 */
export function composePhoto(source: HTMLCanvasElement, trail: TrailData): string {
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
