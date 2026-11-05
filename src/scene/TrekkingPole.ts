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
const _m = new THREE.Matrix4()

/**
 * GLB 캐릭터 손에 스틱을 붙인다. 지금 자세(쉬는 동작을 입힌 상태)에서 스틱 끝이 발바닥 높이에 닿도록
 * 뼈 기준 위치·방향을 계산해 넣으므로, 이후 동작에서는 손을 따라 움직인다.
 *
 * - grip 이 'bone' 이면 뼈 원점을 손 위치로 본다 (KayKit 의 handslot).
 * - 'tip' 이면 그 뼈에 붙은 꼭짓점 가운데 뼈에서 가장 먼 점을 손끝으로 본다 (손 뼈가 없는 Kenney).
 * root 는 부모가 없고 크기가 1 인 상태여야 한다. 붙이면 true.
 */
export function attachTrekkingPole(root: THREE.Object3D, boneName: string, grip: 'bone' | 'tip', metersPerUnit: number) {
  root.updateMatrixWorld(true)
  const bone = root.getObjectByName(boneName) as THREE.Bone | undefined
  if (!bone) return false
  const bonePos = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld)

  const hand = bonePos.clone()
  if (grip === 'tip') {
    let best = -1
    root.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh
      if (!mesh.isSkinnedMesh) return
      const boneIndex = mesh.skeleton.bones.indexOf(bone)
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
    if (best < 0) return false
  }

  // 손잡이 윗끝은 주먹 위로 조금 나오고, 끝은 몸 바깥쪽 조금 뒤 땅을 짚는다 (밀고 나가는 자세).
  // 꼬마 캐릭터는 손이 낮아 똑바로 세우거나 앞을 짚게 하면 뒤따르는 카메라에서 몸에 가려 보이지 않는다
  const m = 1 / metersPerUnit
  const top = new THREE.Vector3(hand.x, hand.y + 0.05 * m, hand.z)
  const tip = new THREE.Vector3(hand.x + Math.sign(hand.x || 1) * 0.25 * m, 0, hand.z - 0.15 * m)
  const down = tip.clone().sub(top)
  const pole = makeTrekkingPole(down.length(), m)
  // 루트 좌표에서 원하는 자리(손 위치, 끝을 향한 방향)를 뼈 기준 좌표로 옮긴다
  const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), down.normalize())
  _m.compose(top, turn, new THREE.Vector3(1, 1, 1))
  _m.premultiply(new THREE.Matrix4().copy(bone.matrixWorld).invert())
  _m.decompose(pole.position, pole.quaternion, pole.scale)
  bone.add(pole)
  return true
}
