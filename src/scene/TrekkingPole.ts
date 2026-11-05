import * as THREE from 'three'

/**
 * 등산 스틱. 원점이 손잡이 윗끝이고 -y 로 length 만큼 뻗어 끝이 땅에 닿는다.
 * unit 은 1m 가 이 좌표계에서 몇인지 (GLB 캐릭터는 크기를 맞추기 전 좌표라 1 이 아니다).
 */
export function makeTrekkingPole(length: number, unit = 1) {
  const pole = new THREE.Group()
  pole.name = 'trekking-pole'
  const part = (geo: THREE.BufferGeometry, color: string, y: number, metal = false) => {
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: metal ? 0.35 : 0.8, metalness: metal ? 0.6 : 0 }))
    mesh.position.y = y
    mesh.castShadow = true
    pole.add(mesh)
  }
  const u = unit
  // 실제 스틱보다 두 배쯤 굵다. 꼬마 캐릭터는 손이 낮아 스틱이 짧아서, 실제 굵기로는 멀리서 보이지 않는다
  const grip = Math.min(0.13 * u, length * 0.35)
  // 손잡이(검정), 손목끈 고리(빨강), 몸통(주황), 눈막이 바구니, 끝 촉 순서로 내려간다
  part(new THREE.CylinderGeometry(0.05 * u, 0.045 * u, grip, 10), '#222222', -grip / 2)
  part(new THREE.TorusGeometry(0.055 * u, 0.012 * u, 6, 12), '#e63946', -0.01 * u)
  const shaft = Math.max(0.05 * u, length - grip)
  part(new THREE.CylinderGeometry(0.026 * u, 0.02 * u, shaft, 8), '#ff8c00', -grip - shaft / 2, true)
  part(new THREE.CylinderGeometry(0.06 * u, 0.06 * u, 0.012 * u, 12), '#333333', -length + Math.min(0.08 * u, length * 0.2))
  part(new THREE.ConeGeometry(0.02 * u, 0.05 * u, 6).rotateX(Math.PI), '#555555', -length + 0.025 * u, true)
  return pole
}

const _v = new THREE.Vector3()
const _top = new THREE.Vector3()
const _carried = new THREE.Vector3()
const _dir = new THREE.Vector3()
const DOWN = new THREE.Vector3(0, -1, 0)

/** 스틱 끝이 몸 바깥쪽으로 나가는 거리(m) */
const OUT = 0.25
/** 쉴 때 스틱 끝이 손보다 뒤에 놓이는 거리(m). 앞을 짚으면 뒤따르는 카메라에서 몸에 가린다 */
const REST_BACK = 0.15
/** 걸을 때 스틱을 손보다 앞에 짚는 거리 (스틱 길이에 곱한다) */
const REACH = 0.5
/** 짚은 채로 몸이 지나가도 되는 거리 (스틱 길이에 곱한다). 넘으면 스틱이 너무 눕는다 */
const PLANT_TRAVEL = 1.1
/** 스틱을 앞으로 옮기는 동안 땅에서 드는 높이 (스틱 길이에 곱한다) */
const LIFT = 0.15

/** 한 손의 스틱. 뼈 기준 좌표로 손잡이 윗끝과 쉬는 자세의 끝을 들고 있다 */
type Hand = {
  bone: THREE.Object3D
  top: THREE.Vector3
  restTip: THREE.Vector3
  side: number
  pole: THREE.Group
  length: number
  /** 걸음 주기 가운데 짚고 있는 몫 (0~0.5) */
  plant: number
  /** 땅에 짚은 자리 (세계 좌표) */
  planted: THREE.Vector3 | null
  /** 앞으로 옮기기 시작한 자리 (layer 좌표) */
  swingFrom: THREE.Vector3
  tip: THREE.Vector3
}

/**
 * GLB 캐릭터의 양손 스틱. 스틱은 손 뼈가 아니라 layer(캐릭터 바깥 group 좌표, m 단위)에 두고 매 프레임 자리를 잡는다.
 * - 쉴 때·만세·점프: 쉬는 자세에서 정한 자리를 손 뼈에 묶어 손을 따라 움직인다 (예전처럼 들고 있다).
 * - 걸을 때: 걸음 주기 가운데 plant 몫은 짚은 자리에 끝을 고정하고, 나머지는 들어서 앞으로 옮겨 다시 짚는다. 두 손은 반 주기 어긋난다.
 *   짚는 몫은 스틱 길이로 정해서, 짧은 스틱(손이 낮은 꼬마 캐릭터)이 지나치게 눕지 않는다.
 *
 * root 는 쉬는 동작을 입힌 상태에서 부모가 없고 크기가 1 이어야 한다. scale 은 root 를 화면에 그릴 때의 크기다.
 */
export function createPoleRig(
  root: THREE.Object3D,
  bones: readonly string[],
  grip: 'bone' | 'tip',
  scale: number,
  layer: THREE.Object3D,
  /** 걸은 1m 에 phase 가 늘어나는 양(rad) */
  phasePerMeter: number,
) {
  const cycle = (Math.PI * 2) / phasePerMeter // 걸음 한 주기에 가는 거리(m)
  root.updateMatrixWorld(true)
  const m = 1 / scale
  const hands: Hand[] = []
  for (const name of bones) {
    const bone = root.getObjectByName(name)
    const hand = bone && findHand(root, bone, grip)
    if (!bone || !hand) {
      console.warn(`[TrekkingPole] 스틱을 쥘 뼈 ${name} 를 찾지 못했다`)
      continue
    }
    // 손잡이 윗끝은 주먹 위로 조금 나오고, 쉴 때 끝은 몸 바깥쪽 조금 뒤 땅을 짚는다
    const side = Math.sign(hand.x || 1)
    const top = new THREE.Vector3(hand.x, hand.y + 0.05 * m, hand.z)
    const restTip = new THREE.Vector3(hand.x + side * OUT * m, 0, hand.z - REST_BACK * m)
    const length = top.distanceTo(restTip) * scale
    const pole = makeTrekkingPole(length)
    const inv = new THREE.Matrix4().copy(bone.matrixWorld).invert()
    hands.push({
      bone,
      top: top.applyMatrix4(inv),
      restTip: restTip.applyMatrix4(inv),
      side,
      pole,
      length,
      plant: Math.min(0.5, (PLANT_TRAVEL * length) / cycle),
      planted: null,
      swingFrom: new THREE.Vector3(),
      tip: new THREE.Vector3(),
    })
  }

  let weight = 0
  let lastPhase = 0

  return {
    /**
     * 동작을 입힌 뒤 부른다. walking 은 걷는 정도(0~1), phase 는 걸은 거리로 센 걸음 주기(2π 가 두 걸음).
     * 점프·만세 중에는 walking 을 0 으로 넘긴다.
     */
    update(dt: number, phase: number, walking: number) {
      weight += (walking - weight) * (1 - Math.exp(-10 * dt))
      const forward = phase >= lastPhase ? 1 : -1
      const moved = phase !== lastPhase
      lastPhase = phase
      layer.updateWorldMatrix(true, false)
      root.updateWorldMatrix(true, true)

      for (const h of hands) {
        layer.worldToLocal(_top.copy(h.top).applyMatrix4(h.bone.matrixWorld))
        layer.worldToLocal(_carried.copy(h.restTip).applyMatrix4(h.bone.matrixWorld))

        if (weight < 0.01) {
          h.planted = null
          h.tip.copy(_carried)
        } else {
          // 오른손(side > 0)과 왼손은 반 주기 어긋난다. 주기 앞부분은 짚고, 나머지는 들어서 옮긴다
          const c = (((phase / (Math.PI * 2) + (h.side > 0 ? 0 : 0.5)) % 1) + 1) % 1
          const ahead = _v.set(_top.x + h.side * OUT, 0, _top.z + REACH * h.length * forward)
          if (c < h.plant || !moved) {
            if (!h.planted) h.planted = layer.localToWorld(h.tip.clone())
            layer.worldToLocal(h.tip.copy(h.planted))
          } else {
            if (h.planted) {
              h.swingFrom.copy(h.tip)
              h.planted = null
            }
            // 앞으로 걸을 때는 c 가 plant→1 로, 뒤로 걸을 때는 1→plant 로 가므로 진행 정도를 방향에 맞춘다
            const raw = (c - h.plant) / (1 - h.plant)
            const s = forward > 0 ? raw : 1 - raw
            const e = s * s * (3 - 2 * s)
            h.tip.lerpVectors(h.swingFrom, ahead, e)
            h.tip.y += Math.sin(Math.PI * e) * LIFT * h.length
          }
          // 순간이동 등으로 너무 멀어지면 손 아래 자리로 다시 짚는다
          if (h.tip.distanceTo(_top) > h.length * 1.6) {
            h.tip.set(_top.x + h.side * OUT, 0, _top.z)
            h.planted = null
          }
        }

        // 쉬는 자세(손에 든 자리)와 걷는 자리를 걷는 정도만큼 섞는다
        _dir.lerpVectors(_carried, h.tip, weight).sub(_top)
        const len = _dir.length()
        h.pole.position.copy(_top)
        if (len > 1e-4) h.pole.quaternion.setFromUnitVectors(DOWN, _dir.divideScalar(len))
        // 손과 짚은 자리 사이가 스틱 길이와 달라도 끊기거나 박히지 않게 조금 늘이고 줄인다
        h.pole.scale.set(1, THREE.MathUtils.clamp(len / h.length, 0.7, 1.4), 1)
      }
    },
    /** 화면에 붙인다. StrictMode 가 effect 를 두 번 돌려도 한 벌만 붙도록 effect 에서 부른다 */
    attach() {
      for (const h of hands) layer.add(h.pole)
    },
    detach() {
      for (const h of hands) layer.remove(h.pole)
    },
  }
}

/**
 * 손 위치(root 좌표).
 * - grip 이 'bone' 이면 뼈 원점을 손으로 본다 (KayKit 의 handslot).
 * - 'tip' 이면 그 뼈에 붙은 꼭짓점 가운데 뼈에서 가장 먼 점을 손끝으로 본다 (손 뼈가 없는 Kenney).
 */
function findHand(root: THREE.Object3D, bone: THREE.Object3D, grip: 'bone' | 'tip') {
  const bonePos = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld)
  if (grip === 'bone') return bonePos
  const hand = bonePos.clone()
  let best = -1
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    const boneIndex = mesh.skeleton.bones.indexOf(bone as THREE.Bone)
    if (boneIndex < 0) return
    mesh.skeleton.update()
    const idx = mesh.geometry.attributes.skinIndex
    const wt = mesh.geometry.attributes.skinWeight
    for (let i = 0; i < idx.count; i++) {
      let w = 0
      for (let k = 0; k < 4; k++) if (idx.getComponent(i, k) === boneIndex) w += wt.getComponent(i, k)
      if (w < 0.5) continue
      mesh.getVertexPosition(i, _v).applyMatrix4(mesh.matrixWorld)
      const d = _v.distanceToSquared(bonePos)
      if (d > best) {
        best = d
        hand.copy(_v)
      }
    }
  })
  return best < 0 ? null : hand
}
