import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { Terrain, Trail } from '../lib/data'
import { groundAt, stoneSteps } from '../lib/steps'
import { emoteBubble, isClimbing, EMOTE_MS, useNet, type Peer } from '../lib/net'
import { occlusionUniforms } from '../lib/occlusion'
import { Avatar } from './Avatar'
import type { HikerHandle } from './Hiker'

/** 채운 위치로 따라가는 빠르기 (클수록 바로 붙는다) */
const FOLLOW = 15
/**
 * 위치는 1초에 5번 온다. 받은 위치로 바로 뛰지 않고 지난 위치에서 이 시간(ms) 동안 고르게 걸어가게 채운다.
 * 서버 간격(200ms)보다 조금 길게 잡아 메시지가 늦게 와도 멈칫하지 않게 한다
 */
const BLEND_MS = 240
/** 이보다 멀리 뛰면(순간이동·다시 오르기) 따라가지 않고 바로 옮긴다(m) */
const SNAP = 40
/** 이 거리(m) 안의 사람만 이름표를 띄운다. 멀리 있는 이름표가 화면을 덮지 않게 한다 */
const LABEL_RANGE = 120

/** 같은 코스를 오르는 다른 사람들 */
export function Peers({ terrain, trail }: { terrain: Terrain; trail: Trail }) {
  // 사람이 들고 나거나 아바타를 바꿀 때만 다시 그린다 (위치는 매 프레임 직접 읽는다)
  const key = useNet((s) =>
    s.peers
      .filter((p) => p.course === trail.data.id && isClimbing(p))
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

/** 다른 사람 한 명. 받은 위치를 부드럽게 따라가며 아바타·이름표·말풍선을 그린다 */
function PeerHiker({ id, terrain, trail }: { id: string; terrain: Terrain; trail: Trail }) {
  const hiker = useRef<HikerHandle>(null!)
  const label = useRef<THREE.Group>(null!)
  /** 화면에 그리는 위치와 방향 (받은 값을 부드럽게 따라간다) */
  const shown = useRef<{ distance: number; offset: number; facing: number } | null>(null)
  /** 지난 위치(from)에서 받은 위치(to)로 채워 가는 구간. at 은 구간을 시작한 시각 */
  const segment = useRef<{ fromD: number; fromO: number; toD: number; toO: number; at: number } | null>(null)
  // 아바타 종류는 처음 값으로 고정한다 (바뀌면 Peers 가 key 를 바꿔 새로 만든다)
  const [peer] = useState(() => useNet.getState().peers.find((p) => p.id === id) as Peer)
  const [view, setView] = useState({ name: peer.name, emote: null as string | null, near: true })
  /** 마지막으로 본 감정 표현의 at 과, 그것을 이 화면에서 처음 본 시각 */
  const emoteSeen = useRef<{ at: number; localAt: number } | null>(null)

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const p = useNet.getState().peers.find((q) => q.id === id)
    if (!p || !hiker.current) return

    // 받은 위치 사이를 고르게 채우고, 그 위치로 부드럽게 따라간다
    const now = performance.now()
    const seg = (segment.current ??= { fromD: p.distance, fromO: p.offset, toD: p.distance, toO: p.offset, at: now })
    const t = Math.min(1, (now - seg.at) / BLEND_MS)
    const targetD = seg.fromD + (seg.toD - seg.fromD) * t
    const targetO = seg.fromO + (seg.toO - seg.fromO) * t
    // 새 위치가 오면 지금 채운 자리에서 새 구간을 시작한다
    if (p.distance !== seg.toD || p.offset !== seg.toO) {
      Object.assign(seg, { fromD: targetD, fromO: targetO, toD: p.distance, toO: p.offset, at: now })
    }
    const pose = (shown.current ??= { distance: p.distance, offset: p.offset, facing: p.facing })
    const follow = 1 - Math.exp(-FOLLOW * dt)
    if (Math.abs(p.distance - pose.distance) > SNAP) {
      Object.assign(seg, { fromD: p.distance, fromO: p.offset, toD: p.distance, toO: p.offset })
      pose.distance = p.distance
      pose.offset = p.offset
    }
    const before = pose.distance + pose.offset
    pose.distance += (targetD - pose.distance) * follow
    pose.offset += (targetO - pose.offset) * follow
    // 방향도 짧은 쪽으로 돌며 따라간다
    pose.facing += Math.atan2(Math.sin(p.facing - pose.facing), Math.cos(p.facing - pose.facing)) * follow
    const heading = trail.headingAt(pose.distance)
    const pos = trail.positionAt(pose.distance)
    pos.x += -Math.cos(heading) * pose.offset
    pos.z += Math.sin(heading) * pose.offset
    // 내 캐릭터와 같은 높이 규칙 (등산로·돌계단·지형)
    pos.y = groundAt(terrain, trail, stoneSteps(terrain, trail), pose.distance, pose.offset, pos.x, pos.z).y
    hiker.current.stride(pose.distance + pose.offset - before)
    hiker.current.group.position.copy(pos).setY(pos.y + p.jump)
    hiker.current.group.rotation.y = heading + pose.facing
    hiker.current.setAirborne(p.jump > 0)
    hiker.current.setCheering(p.mode !== 'hiking')
    label.current.position.copy(hiker.current.group.position)

    // 말풍선은 이 화면에서 감정 표현을 처음 본 때부터 EMOTE_MS 동안 띄운다
    if (p.emote && p.emote.at !== emoteSeen.current?.at) emoteSeen.current = { at: p.emote.at, localAt: Date.now() }
    const bubble = emoteSeen.current && Date.now() - emoteSeen.current.localAt < EMOTE_MS ? emoteBubble(p.emote!.kind) : null
    const near = pos.distanceTo(occlusionUniforms.uOccTarget.value) < LABEL_RANGE
    // 이름표와 말풍선은 바뀔 때만 다시 그린다
    if (p.name !== view.name || bubble !== view.emote || near !== view.near) setView({ name: p.name, emote: bubble, near })
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
          <div className="emote-bubble mine">{emoteBubble(myEmote.kind)}</div>
        </Html>
      )}
    </group>
  )
}
