import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { Terrain, Trail } from '../lib/data'
import { groundAt, stoneSteps } from '../lib/steps'
import { EMOTES, EMOTE_MS, useNet, type Peer } from '../lib/net'
import { occlusionUniforms } from '../lib/occlusion'
import { Avatar } from './Avatar'
import type { HikerHandle } from './Hiker'

const FOLLOW = 10 // 받은 위치로 따라가는 빠르기 (클수록 바로 붙는다)
const SNAP = 40 // 이보다 멀리 뛰면(순간이동·코스 재시작) 따라가지 않고 바로 옮긴다(m)
const LABEL_RANGE = 120 // 이 거리 안의 사람만 이름표를 띄운다(m)

const emoteIcon = (kind: string) => EMOTES.find((e) => e.kind === kind)?.icon ?? ''

/** 같은 코스를 오르는 다른 사람들 */
export function Peers({ terrain, trail }: { terrain: Terrain; trail: Trail }) {
  // 사람이 들고 나거나 아바타를 바꿀 때만 다시 그린다 (위치는 매 프레임 직접 읽는다)
  const key = useNet((s) =>
    s.peers
      .filter((p) => p.course === trail.data.id)
      .map((p) => `${p.id}:${p.avatar}`)
      .join(','),
  )
  const peers = key ? key.split(',').map((k) => k.split(':')) : []

  return (
    <group>
      {peers.map(([id, avatar]) => (
        <PeerHiker key={`${id}-${avatar}`} id={id} terrain={terrain} trail={trail} />
      ))}
      <MyEmote />
    </group>
  )
}

function PeerHiker({ id, terrain, trail }: { id: string; terrain: Terrain; trail: Trail }) {
  const hiker = useRef<HikerHandle>(null!)
  const label = useRef<THREE.Group>(null!)
  const shown = useRef<{ distance: number; offset: number } | null>(null)
  const [peer] = useState(() => useNet.getState().peers.find((p) => p.id === id) as Peer)
  const [view, setView] = useState({ name: peer.name, emote: null as string | null, near: true })
  const emoteSeen = useRef<{ at: number; localAt: number } | null>(null)

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const p = useNet.getState().peers.find((q) => q.id === id)
    if (!p || !hiker.current) return

    // 받은 위치로 부드럽게 따라간다
    const s = (shown.current ??= { distance: p.distance, offset: p.offset })
    const k = 1 - Math.exp(-FOLLOW * dt)
    if (Math.abs(p.distance - s.distance) > SNAP) {
      s.distance = p.distance
      s.offset = p.offset
    }
    const before = s.distance + s.offset
    s.distance += (p.distance - s.distance) * k
    s.offset += (p.offset - s.offset) * k
    const heading = trail.headingAt(s.distance)
    const pos = trail.positionAt(s.distance)
    pos.x += -Math.cos(heading) * s.offset
    pos.z += Math.sin(heading) * s.offset
    // 내 캐릭터와 같은 높이 규칙 (등산로·돌계단·지형)
    pos.y = groundAt(terrain, trail, stoneSteps(terrain, trail), s.distance, s.offset, pos.x, pos.z).y
    hiker.current.stride(s.distance + s.offset - before)
    hiker.current.group.position.copy(pos).setY(pos.y + p.jump)
    hiker.current.group.rotation.y = heading + p.facing
    hiker.current.setAirborne(p.jump > 0)
    hiker.current.setCheering(p.mode !== 'hiking')
    label.current.position.copy(hiker.current.group.position)

    // 이름표와 말풍선은 바뀔 때만 다시 그린다. 감정 표현 시각은 서버 시계라 받은 순간 기준으로 잰다
    if (p.emote && p.emote.at !== emoteSeen.current?.at) emoteSeen.current = { at: p.emote.at, localAt: Date.now() }
    const emoting = emoteSeen.current && Date.now() - emoteSeen.current.localAt < EMOTE_MS ? emoteIcon(p.emote!.kind) : null
    const near = pos.distanceTo(occlusionUniforms.uOccTarget.value) < LABEL_RANGE
    if (p.name !== view.name || emoting !== view.emote || near !== view.near) setView({ name: p.name, emote: emoting, near })
  })

  return (
    <>
      <Avatar ref={hiker} kind={peer.avatar} />
      <group ref={label}>
        {view.near && (
          <Html position={[0, 2.6, 0]} center distanceFactor={14} zIndexRange={[10, 0]}>
            <div className="peer-label">
              {view.emote && <div className="emote-bubble">{view.emote}</div>}
              {view.name}
            </div>
          </Html>
        )}
      </group>
    </>
  )
}

/** 내가 보낸 감정 표현을 내 머리 위에도 띄운다 */
function MyEmote() {
  const myEmote = useNet((s) => s.myEmote)
  const group = useRef<THREE.Group>(null!)
  // 시간이 지나 숨긴 감정 표현의 at. 새로 보내면(at 이 다름) 바로 보인다
  const [hiddenAt, setHiddenAt] = useState<number | null>(null)

  useEffect(() => {
    if (!myEmote) return
    const t = setTimeout(() => setHiddenAt(myEmote.at), EMOTE_MS)
    return () => clearTimeout(t)
  }, [myEmote])

  // 아바타 가슴 높이 기준점(World 가 매 프레임 넣는다)을 따라간다
  useFrame(() => group.current.position.copy(occlusionUniforms.uOccTarget.value))

  return (
    <group ref={group}>
      {myEmote && hiddenAt !== myEmote.at && (
        <Html key={myEmote.at} position={[0, 1.6, 0]} center distanceFactor={14} zIndexRange={[10, 0]}>
          <div className="emote-bubble mine">{emoteIcon(myEmote.kind)}</div>
        </Html>
      )}
    </group>
  )
}
