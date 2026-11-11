// 홈구장 이름·수용 인원: football-data(구단 영문 이름·구장 이름) + TheSportsDB(구장 수용 인원)
// 실행: FOOTBALL_DATA_TOKEN=... node tools/stadiums.mjs → frontend/public/data/stadiums.json
//   { 리그ID: { 구단ID: { name: 구장 이름, cap: 수용 인원 } } }
//   TheSportsDB 무료 키는 분당 30회 → 구단마다 검색·구단·구장 3회, 2.1초 간격 (176개 구단 약 20분)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'frontend', 'public', 'data')
const FD = process.env.FOOTBALL_DATA_TOKEN
const TS = 'https://www.thesportsdb.com/api/v1/json/123'
const UA = { 'User-Agent': 'MiniFM-data/1.0 (https://github.com/meongkune/mini-fm)' }
const LEAGUES = { PL: 'premier-league', BL1: 'bundesliga', PD: 'la-liga', SA: 'serie-a', FL1: 'ligue-1', DED: 'eredivisie', PPL: 'primeira-liga', ELC: 'championship', BSA: 'brasileirao' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fold = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(fc|cf|afc|sc|ac|sv|club|de|futebol|clube|calcio|1)\b/g, ' ').replace(/\s+/g, ' ').trim()
let calls = 0
async function ts(p) {
  if (calls++) await sleep(2100)
  for (let k = 0; k < 3; k++) {
    const r = await fetch(`${TS}${p}`, { headers: UA })
    if (r.status === 429) { await sleep(65000); continue }
    try { return await r.json() } catch { return null }
  }
  return null
}

const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'))
const out = {}
for (const [code, lid] of Object.entries(LEAGUES)) {
  const season = JSON.parse(fs.readFileSync(path.join(DATA, index.leagues.find((l) => l.id === lid).seasons[0].file), 'utf8'))
  const fd = await fetch(`https://api.football-data.org/v4/competitions/${code}/teams?season=2025`, { headers: { 'X-Auth-Token': FD } }).then((r) => r.json())
  const byExt = Object.fromEntries((fd.teams || []).map((t) => [t.id, t]))
  out[lid] = {}
  let found = 0
  for (const t of season.teams) {
    const en = byExt[t.ext]
    if (!en) continue
    const rec = { name: en.venue || null, cap: null }
    // TheSportsDB에서 같은 구단 찾기: 짧은 이름으로 검색 → 축구 · 이름이 겹치는 구단
    const q = await ts(`/searchteams.php?t=${encodeURIComponent(en.shortName || en.name)}`)
    const key = fold(en.shortName || en.name)
    const team = (q?.teams || []).find((x) => x.strSport === 'Soccer' && (fold(x.strTeam) === key || fold(x.strTeam).includes(key) || key.includes(fold(x.strTeam))))
    if (team) {
      const full = (await ts(`/lookupteam.php?id=${team.idTeam}`))?.teams?.[0]
      if (full?.idVenue) {
        const v = (await ts(`/lookupvenue.php?id=${full.idVenue}`))?.venues?.[0]
        if (v) { rec.name = v.strVenue || rec.name; rec.cap = Number(v.intCapacity) || null }
      }
      if (!rec.name) rec.name = full?.strStadium || team.strStadium || null
    }
    if (rec.name) { out[lid][t.id] = rec; if (rec.cap) found++ }
  }
  console.log(`✔ ${lid}: 구장 ${Object.keys(out[lid]).length}/${season.teams.length} · 수용 인원 ${found}`)
}
fs.writeFileSync(path.join(DATA, 'stadiums.json'), JSON.stringify(out) + '\n')
console.log(`TheSportsDB 요청 ${calls}회`)
