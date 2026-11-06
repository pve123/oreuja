import * as THREE from 'three'

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
