// 감독 3D 모델 가공: Quaternius "Ultimate Modular Men Pack"(CC0)의 glTF → 앱용 GLB
//   - 소품(권총) 제거, 감독에게 필요한 동작만 남김, 사용하지 않는 데이터 정리
//   - 입력: models_in/{Suit,Casual_2,Casual_Hoodie}.gltf (원본은 git에 넣지 않음)
//   - 출력: frontend/public/models/manager-{suit,casual,hoodie}.glb
// 실행: node frontend/scripts/build_models.mjs (frontend의 devDependencies 사용)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { dedup, prune } from '@gltf-transform/functions'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const IN = path.join(ROOT, 'models_in')
const OUT = path.join(ROOT, 'frontend', 'public', 'models')
const KEEP_ANIMS = new Set(['Idle', 'Idle_Neutral', 'Wave', 'Interact'])
const FILES = { suit: 'Suit.gltf', casual: 'Casual_2.gltf', hoodie: 'Casual_Hoodie.gltf' }

const io = new NodeIO()
fs.mkdirSync(OUT, { recursive: true })
for (const [key, file] of Object.entries(FILES)) {
  const src = path.join(IN, file)
  if (!fs.existsSync(src)) { console.warn(`건너뜀: ${file} 없음`); continue }
  const doc = await io.read(src)
  const root = doc.getRoot()
  for (const node of root.listNodes()) if (/pistol|sword|gun/i.test(node.getName())) node.dispose()
  for (const anim of root.listAnimations()) if (!KEEP_ANIMS.has(anim.getName())) anim.dispose()
  await doc.transform(dedup(), prune())
  const out = path.join(OUT, `manager-${key}.glb`)
  await io.write(out, doc)
  console.log(`✔ ${path.basename(out)} ${(fs.statSync(out).size / 1024).toFixed(0)}KB · 메시 ${root.listMeshes().map((m) => m.getName()).join(', ')} · 동작 ${root.listAnimations().map((a) => a.getName()).join(', ')}`)
}
fs.writeFileSync(path.join(OUT, 'LICENSE.txt'), 'Manager models: "Ultimate Modular Men Pack" by Quaternius (https://quaternius.com) — CC0 1.0 Universal (public domain).\n')
