// GLB 캐릭터 아바타 파일을 public/models/avatars/ 에 준비한다.
//
//   node scripts/prepare-avatars.mjs <kenney_mini-characters 폴더> <KayKit_Adventurers_2.0_FREE 폴더>
//
// - Kenney Mini Characters: 캐릭터 GLB 와 공용 텍스처(colormap.png)를 복사한다. 애니메이션이 GLB 안에 들어 있다.
// - KayKit Adventurers: 캐릭터 GLB 를 복사하고, 애니메이션 파일 두 개에서 쓰는 동작만 골라
//   메시를 뺀 animations.glb 하나로 합친다 (원본은 마네킹 메시까지 들어 있어 1.5MB 가 넘는다).
// 두 팩 모두 CC0 1.0 이다.
import fs from 'node:fs'
import path from 'node:path'

const [kenneyDir, kaykitDir] = process.argv.slice(2)
if (!kenneyDir || !kaykitDir) {
  console.error('사용법: node scripts/prepare-avatars.mjs <kenney 폴더> <kaykit 폴더>')
  process.exit(1)
}

const OUT = path.resolve('public/models/avatars')
const KENNEY = ['character-male-b', 'character-female-b', 'character-male-e']
const KAYKIT = ['Barbarian', 'Ranger', 'Knight']
// [원본 파일, 동작 이름]
const KAYKIT_CLIPS = [
  ['Rig_Medium_General.glb', 'Idle_A'],
  ['Rig_Medium_MovementBasic.glb', 'Walking_A'],
  ['Rig_Medium_MovementBasic.glb', 'Jump_Idle'],
  ['Rig_Medium_MovementBasic.glb', 'Jump_Full_Short'],
]

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
  console.log('복사', path.relative(process.cwd(), to))
}

function readGlb(file) {
  const b = fs.readFileSync(file)
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`GLB 파일이 아니다: ${file}`)
  const jsonLen = b.readUInt32LE(12)
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'))
  const binStart = 20 + jsonLen
  const bin = b.subarray(binStart + 8, binStart + 8 + b.readUInt32LE(binStart))
  return { json, bin }
}

function writeGlb(file, json, bin) {
  const pad = (buf, fill) => {
    const extra = (4 - (buf.length % 4)) % 4
    return extra ? Buffer.concat([buf, Buffer.alloc(extra, fill)]) : buf
  }
  const jsonBuf = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20)
  const binBuf = pad(bin, 0)
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8)
  const chunk = (buf, type) => {
    const h = Buffer.alloc(8)
    h.writeUInt32LE(buf.length, 0)
    h.writeUInt32LE(type, 4)
    return Buffer.concat([h, buf])
  }
  fs.writeFileSync(file, Buffer.concat([header, chunk(jsonBuf, 0x4e4f534a), chunk(binBuf, 0x004e4942)]))
}

/** 여러 GLB 에서 고른 동작만 모아, 뼈대 노드와 애니메이션만 든 GLB 를 만든다 */
function buildAnimations(srcDir, picks, outFile) {
  const files = new Map()
  const load = (name) => {
    if (!files.has(name)) files.set(name, readGlb(path.join(srcDir, name)))
    return files.get(name)
  }

  // 뼈대는 첫 파일의 노드를 그대로 쓰되 메시·스킨 연결은 뺀다. 다른 파일의 노드는 이름으로 맞춘다
  const base = load(picks[0][0]).json
  const nodes = base.nodes.map((n) => {
    const copy = { ...n }
    delete copy.mesh
    delete copy.skin
    return copy
  })
  const nodeIndex = new Map(nodes.map((n, i) => [n.name, i]))
  const keptNodes = new Set()
  const markTree = (i) => {
    keptNodes.add(i)
    for (const c of nodes[i].children ?? []) markTree(c)
  }
  for (const r of base.scenes[base.scene ?? 0].nodes) markTree(r)

  const out = { asset: { version: '2.0', generator: 'prepare-avatars.mjs' }, scene: 0, scenes: [{ nodes: base.scenes[base.scene ?? 0].nodes }], nodes, accessors: [], bufferViews: [], buffers: [], animations: [] }
  const chunks = []
  let offset = 0
  const copyAccessor = (glb, index) => {
    const acc = glb.json.accessors[index]
    const view = glb.json.bufferViews[acc.bufferView]
    const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0)
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type]
    const bytes = { 5126: 4, 5123: 2, 5121: 1, 5125: 4, 5122: 2, 5120: 1 }[acc.componentType]
    if (view.byteStride && view.byteStride !== comps * bytes) throw new Error('interleaved 애니메이션 데이터는 지원하지 않는다')
    const data = Buffer.from(glb.bin.subarray(start, start + acc.count * comps * bytes))
    const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)])
    out.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length })
    chunks.push(padded)
    offset += padded.length
    const copy = { ...acc, bufferView: out.bufferViews.length - 1 }
    delete copy.byteOffset
    out.accessors.push(copy)
    return out.accessors.length - 1
  }

  for (const [file, clip] of picks) {
    const glb = load(file)
    const anim = glb.json.animations.find((a) => a.name === clip)
    if (!anim) throw new Error(`${file} 에 ${clip} 동작이 없다`)
    const samplers = anim.samplers.map((s) => ({ input: copyAccessor(glb, s.input), output: copyAccessor(glb, s.output), interpolation: s.interpolation }))
    const channels = anim.channels
      .map((c) => ({ sampler: c.sampler, target: { ...c.target, node: nodeIndex.get(glb.json.nodes[c.target.node].name) } }))
      .filter((c) => c.target.node !== undefined && keptNodes.has(c.target.node))
    out.animations.push({ name: clip, samplers, channels })
  }
  const bin = Buffer.concat(chunks)
  out.buffers.push({ byteLength: bin.length })
  writeGlb(outFile, out, bin)
  console.log('만듦', path.relative(process.cwd(), outFile), `${(fs.statSync(outFile).size / 1024).toFixed(0)}KB`, picks.map((p) => p[1]).join(', '))
}

const kenneyGlb = path.join(kenneyDir, 'Models', 'GLB format')
for (const name of KENNEY) copy(path.join(kenneyGlb, `${name}.glb`), path.join(OUT, 'kenney', `${name}.glb`))
// Kenney GLB 는 이 텍스처를 바깥 파일로 읽는다. README 「모델 압축」대로 압축하면 GLB 안에 들어가므로 그 뒤 Textures 폴더는 지운다
copy(path.join(kenneyGlb, 'Textures', 'colormap.png'), path.join(OUT, 'kenney', 'Textures', 'colormap.png'))

for (const name of KAYKIT) copy(path.join(kaykitDir, 'Characters', 'gltf', `${name}.glb`), path.join(OUT, 'kaykit', `${name}.glb`))
buildAnimations(path.join(kaykitDir, 'Animations', 'gltf', 'Rig_Medium'), KAYKIT_CLIPS, path.join(OUT, 'kaykit', 'animations.glb'))
