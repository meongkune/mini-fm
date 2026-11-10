// 실제 보도 연봉·키·등번호: TheSportsDB(크라우드소싱 스포츠 DB) 무료 API에서 모은다
// 실행: node tools/tsdb_wages.mjs  (환경 변수 TSDB_MINUTES=분 단위 실행 시간, 기본 50 · PRIORITY_LEAGUES=먼저 받을 리그)
// 결과: frontend/public/data/wages/<리그>.json  { players: { 선수ID: { w: €M/년, h: cm, n: 등번호, at: 받은 날 } } }
//   - 무료 키는 분당 30회, 목록 조회는 10개까지라 선수마다 '검색(ID) → 상세' 2회로 받는다 → 하루 약 700명씩
//   - 검색 결과는 1명만 오므로 생년월일(나이 ±1)·종목으로 같은 선수인지 확인한다
//   - 받은 연봉은 그대로 저장하고, 너무 낡은 값(예: 이적 전 연봉)인지는 게임에서 추정 연봉과 비교해 거른다
//   - 진행 상황은 tools/tsdb-state.json (선수 ID ↔ TheSportsDB ID, 받은 날). 90일이 지나면 다시 받는다
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'frontend', 'public', 'data')
const STATE = path.join(ROOT, 'tools', 'tsdb-state.json')
const API = 'https://www.thesportsdb.com/api/v1/json/123' // 공개 무료 키
const UA = 'MiniFM-data/1.0 (https://github.com/meongkune/mini-fm; football manager hobby game)'
const deadline = Date.now() + Number(process.env.TSDB_MINUTES || 50) * 60_000
const prio = (process.env.PRIORITY_LEAGUES || 'bundesliga,premier-league').split(',').map((x) => x.trim())
const today = new Date().toISOString().slice(0, 10)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let calls = 0
async function get(p) {
  if (calls++) await sleep(2100) // 분당 30회 미만
  for (let k = 0; k < 3; k++) {
    const res = await fetch(`${API}${p}`, { headers: { 'User-Agent': UA } })
    if (res.status === 429) { await sleep(65_000); continue }
    const t = await res.text()
    try { return JSON.parse(t) } catch { return null }
  }
  return null
}

// 환율 (유럽중앙은행 기준) — 파운드·달러 연봉을 유로로
const fx = await fetch('https://api.frankfurter.app/latest?from=EUR&to=GBP,USD').then((r) => r.json()).catch(() => null)
const toEur = { '€': 1, '£': 1 / (fx?.rates?.GBP || 0.85), $: 1 / (fx?.rates?.USD || 1.08) }
/** '£3,640,000' · '€88.5m' · '$1.2M' → €M (해석 못 하면 null) */
function wageEur(s) {
  if (!s) return null
  const cur = Object.keys(toEur).find((c) => s.includes(c))
  if (!cur) return null
  const m = s.replace(/,/g, '').match(/([\d.]+)\s*(m|million|k)?/i)
  if (!m) return null
  let v = Number(m[1])
  if (/^m|million/i.test(m[2] || '')) v *= 1e6
  else if (/^k/i.test(m[2] || '')) v *= 1e3
  if (!(v > 10_000)) return null // 너무 작은 값은 주급·오타로 보고 버린다
  return Math.round((v * toEur[cur]) / 1e5) / 10
}
const ageOf = (d) => { if (!d) return null; const b = new Date(d); const n = new Date(); let a = n.getFullYear() - b.getFullYear(); if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--; return a }

const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { players: {} }
const saveState = () => fs.writeFileSync(STATE, JSON.stringify(state) + '\n')
const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'))
fs.mkdirSync(path.join(DATA, 'wages'), { recursive: true })
const out = {}
const leagues = index.leagues.filter((l) => !l.marketOnly).sort((a, b) => (prio.indexOf(b.id) >= 0) - (prio.indexOf(a.id) >= 0) || prio.indexOf(a.id) - prio.indexOf(b.id))
for (const l of leagues) {
  const file = path.join(DATA, 'wages', `${l.id}.json`)
  out[l.id] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).players : {}
}

let got = 0
let miss = 0
outer: for (const l of leagues) {
  const season = JSON.parse(fs.readFileSync(path.join(DATA, l.seasons[0].file), 'utf8'))
  // 구단 주전급부터 (등번호 작은 순 → 나이 많은 순)
  const players = season.teams.flatMap((t) => t.players).sort((a, b) => (a.number ?? 99) - (b.number ?? 99))
  for (const p of players) {
    const s = state.players[p.id]
    if (s && (Date.now() - Date.parse(s.at)) / 864e5 < (s.none ? 30 : 90)) continue
    if (Date.now() > deadline) break outer
    let id = s?.tsdb
    if (!id) {
      const r = await get(`/searchplayers.php?p=${encodeURIComponent(p.name.replace(/ /g, '_'))}`)
      const c = (r?.player || []).find((x) => /soccer/i.test(x.strSport || '') && (!p.age || !x.dateBorn || Math.abs(ageOf(x.dateBorn) - p.age) <= 1))
      if (!c) { state.players[p.id] = { none: true, at: today }; miss++; continue }
      id = c.idPlayer
    }
    const d = (await get(`/lookupplayer.php?id=${id}`))?.players?.[0]
    if (!d) { state.players[p.id] = { tsdb: id, none: true, at: today }; miss++; continue }
    const h = d.strHeight?.match(/([12])\.(\d{2})\s*m/)
    const rec = {
      ...(wageEur(d.strWage) ? { w: wageEur(d.strWage) } : {}),
      ...(h ? { h: Number(h[1]) * 100 + Number(h[2]) } : {}),
      ...(Number(d.strNumber) > 0 && Number(d.strNumber) < 100 ? { n: Number(d.strNumber) } : {}),
      at: today,
    }
    state.players[p.id] = { tsdb: id, at: today }
    if (rec.w || rec.h || rec.n) { out[l.id][p.id] = rec; got++ }
    if ((got + miss) % 25 === 0) { saveState(); for (const [lid, ps] of Object.entries(out)) fs.writeFileSync(path.join(DATA, 'wages', `${lid}.json`), JSON.stringify({ source: 'TheSportsDB (크라우드소싱 · 실제 보도 연봉)', updatedAt: today, players: ps }) + '\n') }
  }
}
saveState()
for (const [lid, ps] of Object.entries(out)) fs.writeFileSync(path.join(DATA, 'wages', `${lid}.json`), JSON.stringify({ source: 'TheSportsDB (크라우드소싱 · 실제 보도 연봉)', updatedAt: today, players: ps }) + '\n')
const total = Object.values(out).reduce((s, ps) => s + Object.keys(ps).length, 0)
const withWage = Object.values(out).reduce((s, ps) => s + Object.values(ps).filter((x) => x.w).length, 0)
console.log(`✔ 이번 실행: ${got}명 받음 · ${miss}명 못 찾음 · 요청 ${calls}회`)
console.log(`  누적: ${total}명 (연봉 있는 선수 ${withWage}명)`)
