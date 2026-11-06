// 돌·길·계단에 쓸 Quaternius Stylized Nature MegaKit(무료판, CC0 1.0) 모델을 public/models/nature/ 에 준비한다.
//
//   node scripts/prepare-nature.mjs "<Stylized Nature MegaKit[Standard] 폴더>"
//
// glTF(.gltf + .bin)를 그대로 복사하고, 텍스처는 1024px JPG 로 줄여(원본 PNG 2048px, 2.5MB) 이미지 경로를 바꾼다.
// 텍스처 변환은 macOS 의 sips 를 쓴다.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const pack = process.argv[2]
if (!pack) {
  console.error('사용법: node scripts/prepare-nature.mjs "<Stylized Nature MegaKit[Standard] 폴더>"')
  process.exit(1)
}
const SRC = path.join(pack, 'glTF')
const OUT = path.resolve('public/models/nature')
// 바위, 계단 판석, 길가 자갈
const MODELS = [
  'Rock_Medium_1',
  'Rock_Medium_2',
  'Rock_Medium_3',
  'RockPath_Square_Small_1',
  'RockPath_Square_Small_2',
  'RockPath_Square_Small_3',
  'Pebble_Round_1',
  'Pebble_Round_3',
  'Pebble_Round_5',
  'Pebble_Square_1',
  'Pebble_Square_4',
]

fs.mkdirSync(OUT, { recursive: true })
const textures = new Set()
for (const name of MODELS) {
  const gltf = JSON.parse(fs.readFileSync(path.join(SRC, `${name}.gltf`), 'utf8'))
  for (const b of gltf.buffers) fs.copyFileSync(path.join(SRC, b.uri), path.join(OUT, b.uri))
  for (const img of gltf.images ?? []) {
    textures.add(img.uri)
    img.uri = img.uri.replace(/\.png$/i, '.jpg')
    img.mimeType = 'image/jpeg'
  }
  fs.writeFileSync(path.join(OUT, `${name}.gltf`), JSON.stringify(gltf))
  console.log('복사', name)
}
for (const png of textures) {
  const jpg = path.join(OUT, png.replace(/\.png$/i, '.jpg'))
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', '1024', path.join(SRC, png), '--out', jpg], { stdio: 'ignore' })
  console.log('텍스처', path.basename(jpg), `${(fs.statSync(jpg).size / 1024).toFixed(0)}KB`)
}
fs.copyFileSync(path.join(pack, 'License_Standard.txt'), path.join(OUT, 'LICENSE.txt'))
