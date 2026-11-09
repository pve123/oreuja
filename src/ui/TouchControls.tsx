import { useEffect, useRef } from 'react'
import { input } from '../lib/store'

/** 손잡이가 움직이는 반지름(px). 이만큼 밀면 기울기 1. 작으면 엄지를 조금만 움직여도 뛰어 버려 민감하다 */
const RADIUS = 60

/**
 * 터치 조이스틱. 요즘 모바일 3D 게임처럼 화면 왼쪽 아래 빈 곳 아무 데나 엄지를 대면 그 자리에 조이스틱이 생기고,
 * 좌우로 기울이면 몸을 돌리고 위로 밀면 걷는다(조금 기울이면 천천히, 끝까지 밀면 뛴다). 카메라는 늘 등 뒤에서 앞을 본다. 오른쪽 빈 곳은 그대로 3D 화면이라 끌어서 둘러보고 두 손가락으로 확대·축소한다.
 * 기울기는 input.stick 에 넣고 World 가 매 프레임 읽는다. 마우스 기기에서는 CSS 가 숨긴다
 */
export function TouchControls() {
  const zone = useRef<HTMLDivElement>(null!)
  const base = useRef<HTMLDivElement>(null!)
  const knob = useRef<HTMLDivElement>(null!)

  useEffect(() => {
    const el = zone.current
    // 누르고 있는 손가락과 처음 댄 자리 (effect 안에서만 바뀌는 값이라 객체에 둔다)
    const touch = { id: null as number | null, ox: 0, oy: 0 }
    const set = (x: number, y: number) => {
      input.stick.x = x
      input.stick.y = y
    }
    const down = (e: PointerEvent) => {
      if (touch.id !== null) return
      touch.id = e.pointerId
      el.setPointerCapture(touch.id)
      touch.ox = e.clientX
      touch.oy = e.clientY
      base.current.style.left = `${touch.ox}px`
      base.current.style.top = `${touch.oy}px`
      base.current.style.bottom = 'auto'
      base.current.classList.add('on')
      knob.current.style.transform = 'translate(0px, 0px)'
      set(0, 0)
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== touch.id) return
      let dx = e.clientX - touch.ox
      let dy = e.clientY - touch.oy
      const len = Math.hypot(dx, dy)
      if (len > RADIUS) {
        dx *= RADIUS / len
        dy *= RADIUS / len
      }
      knob.current.style.transform = `translate(${dx}px, ${dy}px)`
      set(dx / RADIUS, -dy / RADIUS)
    }
    const up = (e: PointerEvent) => {
      if (e.pointerId !== touch.id) return
      touch.id = null
      base.current.classList.remove('on')
      base.current.style.left = ''
      base.current.style.top = ''
      base.current.style.bottom = ''
      knob.current.style.transform = 'translate(0px, 0px)'
      set(0, 0)
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      set(0, 0)
    }
  }, [])

  return (
    <div ref={zone} className="stick-zone" aria-hidden>
      {/* 손을 대기 전에는 제자리에 흐리게 떠 있어 어디에 엄지를 둘지 알려 준다 */}
      <div ref={base} className="stick">
        <div ref={knob} className="stick-knob" />
      </div>
    </div>
  )
}
