import { useEffect, useMemo, useRef } from 'react'
import type { Trail } from '../lib/data'
import { useGame } from '../lib/store'
import { usePhotos, type PhotoLayer } from '../lib/photo-map'

const SIZE = 168 // 화면에 보이는 크기(px). 좁은 화면에서는 CSS 가 줄인다
const MARGIN = 120 // 코스 둘레로 더 보여 줄 거리(m)

/** 위성사진 픽셀을 한 번만 캔버스로 옮겨 둔다 (미니맵 배경으로 잘라 쓴다) */
const photoCanvases = new WeakMap<PhotoLayer, HTMLCanvasElement>()
function photoCanvas(layer: PhotoLayer) {
  let c = photoCanvases.get(layer)
  if (!c) {
    c = document.createElement('canvas')
    c.width = layer.width
    c.height = layer.height
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(layer.data), layer.width, layer.height), 0, 0)
    photoCanvases.set(layer, c)
  }
  return c
}

/** 오른쪽 아래 미니맵. 북쪽이 위이고, 지나온 길과 지금 위치·방향을 보여 준다 */
export function MiniMap({ trail, trails }: { trail: Trail; trails: Trail[] }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const photo = usePhotos((s) => s.base)

  // 코스가 다 들어가는 정사각형 범위 (로컬 좌표 m)
  const view = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const p of trail.points) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x)
      z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z)
    }
    const size = Math.max(x1 - x0, z1 - z0) + MARGIN * 2
    return { minX: (x0 + x1) / 2 - size / 2, minZ: (z0 + z1) / 2 - size / 2, size }
  }, [trail])

  // 바뀌지 않는 바탕(사진, 코스 선, 이정표)은 따로 그려 두고 위치가 바뀔 때마다 겹쳐 그린다
  const base = useMemo(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const px = Math.round(SIZE * dpr)
    const c = document.createElement('canvas')
    c.width = c.height = px
    const ctx = c.getContext('2d')!
    const toPx = (x: number, z: number): [number, number] => [((x - view.minX) / view.size) * px, ((z - view.minZ) / view.size) * px]

    ctx.fillStyle = '#4d6b3c'
    ctx.fillRect(0, 0, px, px)
    if (photo) {
      const { rect } = photo
      const sx = ((view.minX - rect.minX) / (rect.maxX - rect.minX)) * photo.width
      const sy = ((view.minZ - rect.minZ) / (rect.maxZ - rect.minZ)) * photo.height
      const sw = (view.size / (rect.maxX - rect.minX)) * photo.width
      const sh = (view.size / (rect.maxZ - rect.minZ)) * photo.height
      ctx.drawImage(photoCanvas(photo), sx, sy, sw, sh, 0, 0, px, px)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)' // 선이 잘 보이게 사진을 살짝 어둡게
      ctx.fillRect(0, 0, px, px)
    }

    const line = (t: Trail, color: string, width: number) => {
      ctx.strokeStyle = color
      ctx.lineWidth = width * dpr
      ctx.lineJoin = ctx.lineCap = 'round'
      ctx.beginPath()
      t.points.forEach((p, i) => (i ? ctx.lineTo(...toPx(p.x, p.z)) : ctx.moveTo(...toPx(p.x, p.z))))
      ctx.stroke()
    }
    for (const t of trails) if (t !== trail) line(t, 'rgba(255, 255, 255, 0.45)', 1.5)
    line(trail, 'rgba(0, 0, 0, 0.35)', 5)
    line(trail, '#f2c14e', 3)

    for (const cp of trail.data.checkpoints) {
      const [x, y] = toPx(trail.positionAt(cp.distance).x, trail.positionAt(cp.distance).z)
      ctx.fillStyle = '#fff'
      ctx.strokeStyle = '#1d3557'
      ctx.lineWidth = 1.5 * dpr
      ctx.beginPath()
      ctx.arc(x, y, 3 * dpr, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    // 도착 지점 깃발 삼각형
    const top = trail.positionAt(trail.length)
    const [tx, ty] = toPx(top.x, top.z)
    ctx.fillStyle = '#e63946'
    ctx.beginPath()
    ctx.moveTo(tx, ty - 7 * dpr)
    ctx.lineTo(tx + 6 * dpr, ty + 4 * dpr)
    ctx.lineTo(tx - 6 * dpr, ty + 4 * dpr)
    ctx.closePath()
    ctx.fill()
    return { canvas: c, toPx, dpr, px }
  }, [trail, trails, view, photo])

  useEffect(() => {
    const el = canvas.current!
    el.width = el.height = base.px
    const ctx = el.getContext('2d')!
    const pending = { frame: 0 } // 예약해 둔 다시 그리기
    const draw = () => {
      pending.frame = 0
      const { distance, offset } = useGame.getState()
      const { toPx, dpr } = base
      ctx.drawImage(base.canvas, 0, 0)

      // 지나온 길
      ctx.strokeStyle = '#e63946'
      ctx.lineWidth = 3 * dpr
      ctx.lineJoin = ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(...toPx(trail.points[0].x, trail.points[0].z))
      for (let i = 1; i < trail.points.length && trail.cumulative[i] < distance; i++) ctx.lineTo(...toPx(trail.points[i].x, trail.points[i].z))
      const here = trail.positionAt(distance)
      ctx.lineTo(...toPx(here.x, here.z))
      ctx.stroke()

      // 지금 위치와 진행 방향 (옆으로 비킨 만큼 옮긴다)
      const h = trail.headingAt(distance)
      const x = here.x - Math.cos(h) * offset
      const z = here.z + Math.sin(h) * offset
      const [px, py] = toPx(x, z)
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(Math.PI - h) // heading 0 은 남쪽(+z, 화면 아래)
      ctx.fillStyle = '#fff'
      ctx.strokeStyle = '#1d3557'
      ctx.lineWidth = 2 * dpr
      ctx.beginPath()
      ctx.moveTo(0, -8 * dpr)
      ctx.lineTo(6 * dpr, 6 * dpr)
      ctx.lineTo(0, 3 * dpr)
      ctx.lineTo(-6 * dpr, 6 * dpr)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
    draw()
    // 걸을 때마다 다시 그리되 한 화면 갱신에 한 번만
    const off = useGame.subscribe((s, prev) => {
      if ((s.distance !== prev.distance || s.offset !== prev.offset) && !pending.frame) pending.frame = requestAnimationFrame(draw)
    })
    return () => {
      off()
      if (pending.frame) cancelAnimationFrame(pending.frame)
    }
  }, [base, trail])

  return (
    <div className="minimap" aria-label="미니맵">
      <canvas ref={canvas} style={{ width: '100%', height: '100%' }} />
      <span className="minimap-north" aria-hidden>
        N
      </span>
    </div>
  )
}
