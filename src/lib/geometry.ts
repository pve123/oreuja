import * as THREE from 'three'

/**
 * 꼭짓점을 중심에서 [min, min + range] 배로 흔들어 울퉁불퉁하게 만든다 (나무 수관, 바위, 감자).
 * 같은 자리 꼭짓점(면 이음매에서 겹친 것)은 같은 비율로 밀어 틈이 생기지 않게 한다. 법선은 모양을 다 바꾼 뒤 부르는 쪽이 계산한다
 */
export function jitterVertices(geo: THREE.BufferGeometry, rand: () => number, min: number, range: number) {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  const moved = new Map<string, number>()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`
    if (!moved.has(key)) moved.set(key, min + rand() * range)
    v.multiplyScalar(moved.get(key)!)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  return geo
}

/**
 * glTF 메시의 모양을 월드 좌표로 구운 새 BufferGeometry 를 만든다 (InstancedMesh 로 여러 번 찍을 때).
 *
 * meshopt 로 압축한 모델은 좌표를 정수(-1~1 로 정규화한 int16 등)로 담고 크기는 노드 변환에 맡긴다.
 * 그대로 applyMatrix4 를 하면 -1~1 밖 값이 잘려 모양이 깨지므로, 모든 속성을 실수(Float32)로 먼저 푼다.
 */
export function bakeGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  const src = mesh.geometry as THREE.BufferGeometry
  const out = new THREE.BufferGeometry()
  for (const [name, attr] of Object.entries(src.attributes)) {
    const size = attr.itemSize
    const array = new Float32Array(attr.count * size)
    for (let i = 0; i < attr.count; i++)
      for (let k = 0; k < size; k++) array[i * size + k] = attr.getComponent(i, k)
    out.setAttribute(name, new THREE.BufferAttribute(array, size))
  }
  if (src.index) out.setIndex(src.index.clone())
  for (const g of src.groups) out.addGroup(g.start, g.count, g.materialIndex)
  return out.applyMatrix4(mesh.matrixWorld)
}
