// 명단 손 보정: tools/squad_fixes.json의 선수를 시즌 파일에 넣는다 (이미 있으면 건너뜀 · 여러 번 실행해도 같음)
// 능력치는 같은 구단·같은 포지션 선수 중간값으로 두고, 나중에 SportsAPI 시장가치 능력치가 이름으로 맞춰 덮어쓴다
// 실행: node tools/apply_squad_fixes.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'frontend', 'public', 'data')
const fixes = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'squad_fixes.json'), 'utf8'))
const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'))
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 65 }
const norm = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

for (const [lid, teams] of Object.entries(fixes)) {
  if (lid.startsWith('_')) continue
  const l = index.leagues.find((x) => x.id === lid)
  if (!l) continue
  const file = path.join(DATA, l.seasons[0].file)
  const season = JSON.parse(fs.readFileSync(file, 'utf8'))
  let added = 0
  for (const [tid, list] of Object.entries(teams)) {
    const t = season.teams.find((x) => x.id === tid)
    if (!t) continue
    for (const f of list) {
      if (t.players.some((p) => norm(p.name) === norm(f.name))) continue
      const peers = t.players.filter((p) => p.pos === f.pos)
      // 실제 등번호를 준다. football-data는 등번호가 없어 가져오기 도구가 관례 번호를 붙였으므로, 겹치는 선수는 빈 번호로 옮긴다
      const used = new Set(t.players.map((p) => p.number))
      const clash = f.number && t.players.find((p) => p.number === f.number)
      if (clash) clash.number = Array.from({ length: 87 }, (_, i) => i + 13).find((n) => !used.has(n))
      t.players.push({
        id: `${tid}-fix-${norm(f.name).replace(/[^a-z]+/g, '-')}`,
        name: f.name, pos: f.pos, ...(f.role ? { role: f.role } : {}),
        number: f.number ?? null,
        age: f.age, att: median(peers.map((p) => p.att)), def: median(peers.map((p) => p.def)), sta: median(peers.map((p) => p.sta)),
        nation: f.nation || null, ext: null,
      })
      added++
      console.log(`+ ${lid} · ${t.name}: ${f.name}`)
    }
    // 1군 30명 상한: 넘으면 가장 어린 유스 선수부터 뺀다 (골키퍼 제외)
    while (t.players.length > 30) {
      const out = [...t.players].filter((p) => p.pos !== 'GK' && !String(p.id).includes('-fix-')).sort((a, b) => a.age - b.age)[0]
      t.players = t.players.filter((p) => p !== out)
      console.log(`- ${lid} · ${t.name}: ${out.name}(${out.age}세) 1군 30명 상한으로 제외`)
    }
  }
  if (added) fs.writeFileSync(file, JSON.stringify(season, null, 2) + '\n')
}
