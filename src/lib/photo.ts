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
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, 'rgba(0,0,0,0.7)')
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

  return canvas.toDataURL('image/png')
}
