// 선수 실제 사진: 영어 위키백과 문서의 대표 이미지(위키미디어 공용, 자유 라이선스)를 모아 둔다
// 실행: node tools/player_photos.mjs [리그 ID …]  (없으면 전체) → frontend/public/data/photos/<리그>.json
//   { players: { 선수ID: { img: 썸네일 URL, page: 문서 제목 } } }
// 요청: 제목 50개씩 한 번에 조회 (리그당 약 15~25회). 위키미디어 정책에 맞춰 User-Agent를 밝히고 순서대로 천천히 보낸다
//   1차: 선수 이름 그대로 → 2차: "이름 (footballer)" — 설명(description)에 football/soccer가 있는 문서만 인정
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'frontend', 'public', 'data')
const UA = 'MiniFM-photos/1.0 (https://github.com/meongkune/mini-fm; football manager hobby game)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let calls = 0

async function lookup(titles) {
  if (calls++) await sleep(700)
  const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=pageimages|description&piprop=thumbnail&pithumbsize=240&titles=' + encodeURIComponent(titles.join('|'))
  const j = await fetch(url, { headers: { 'User-Agent': UA } }).then((r) => r.json())
  // 입력 제목 → 최종 문서 (정규화·넘겨주기 따라가기)
  const norm = Object.fromEntries((j.query?.normalized || []).map((x) => [x.from, x.to]))
  const redir = Object.fromEntries((j.query?.redirects || []).map((x) => [x.from, x.to]))
  const pages = Object.fromEntries((j.query?.pages || []).map((p) => [p.title, p]))
  const out = {}
  for (const t of titles) {
    let k = norm[t] || t
    k = redir[k] || k
    const p = pages[k]
    if (p && !p.missing && /football|soccer/i.test(p.description || '') && p.thumbnail?.source) out[t] = { img: p.thumbnail.source, page: p.title }
  }
  return out
}

const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'))
const want = process.argv.slice(2)
fs.mkdirSync(path.join(DATA, 'photos'), { recursive: true })
for (const l of index.leagues) {
  if (want.length && !want.includes(l.id)) continue
  const season = JSON.parse(fs.readFileSync(path.join(DATA, l.seasons[0].file), 'utf8'))
  const players = season.teams.flatMap((t) => t.players)
  const file = path.join(DATA, 'photos', `${l.id}.json`)
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).players : {}
  const found = { ...prev }
  // 영문 이름: K리그처럼 한글 이름이면 nameEn
  const nameOf = (p) => (/[a-z]/i.test(p.name) ? p.name : p.nameEn || null)
  for (const pass of [(n) => n, (n) => `${n} (footballer)`]) {
    const todo = players.filter((p) => !found[p.id] && nameOf(p))
    for (let i = 0; i < todo.length; i += 50) {
      const chunk = todo.slice(i, i + 50)
      const titles = [...new Set(chunk.map((p) => pass(nameOf(p))))]
      const res = await lookup(titles)
      for (const p of chunk) { const r = res[pass(nameOf(p))]; if (r) found[p.id] = r }
    }
  }
  fs.writeFileSync(file, JSON.stringify({ source: 'Wikipedia / Wikimedia Commons (각 이미지 라이선스는 위키미디어 공용 문서 참고)', updatedAt: new Date().toISOString().slice(0, 10), players: found }) + '\n')
  console.log(`✔ ${l.id}: 사진 ${Object.keys(found).length}/${players.length}명`)
}
console.log(`위키백과 요청 ${calls}회`)
