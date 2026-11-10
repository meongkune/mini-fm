// 명단 보충: football-data.org 명단에 빠진 1군 선수를 API-Football '현재 명단'으로 채운다
//   예: 브렌트퍼드 이고르 치아구(2025-26 주전 공격수)가 football-data 명단에 없었다
// 실행: FOOTBALL_DATA_TOKEN=... API_FOOTBALL_KEY=... node tools/supplement_squads.mjs PL [BL1 …]
// 요청: 리그마다 football-data 1회 + API-Football 약 (구단 수 + 2)회. 무료 플랜 하루 100회·분당 10회라 7초 간격
//   - 새 선수 능력치는 같은 구단·같은 포지션 선수들의 중간값에서 추정 → 나중에 SportsAPI 시장가치 능력치가 덮어쓴다
//   - API-Football 현재 명단에 없는 선수(임대·이적으로 떠난 선수로 보임)는 구단 인원이 30명을 넘을 때 먼저 뺀다
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'frontend', 'public', 'data')
const FD = process.env.FOOTBALL_DATA_TOKEN
const AF = process.env.API_FOOTBALL_KEY
if (!FD || !AF) throw new Error('FOOTBALL_DATA_TOKEN, API_FOOTBALL_KEY 환경 변수가 필요합니다')

// football-data 대회 코드 → 우리 리그 ID · API-Football 리그 ID
const LEAGUES = {
  PL: ['premier-league', 39], PD: ['la-liga', 140], BL1: ['bundesliga', 78], SA: ['serie-a', 135], FL1: ['ligue-1', 61],
  DED: ['eredivisie', 88], PPL: ['primeira-liga', 94], ELC: ['championship', 40], BSA: ['brasileirao', 71],
}
const MAX = 30
const POS = { Goalkeeper: 'GK', Defender: 'DF', Midfielder: 'MF', Attacker: 'FW' }

let calls = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function af(p) {
  if (calls) await sleep(7000)
  calls++
  const j = await fetch(`https://v3.football.api-sports.io${p}`, { headers: { 'x-apisports-key': AF } }).then((r) => r.json())
  if (j.errors?.rateLimit) { await sleep(65000); return af(p) }
  if (j.errors && Object.keys(j.errors).length) throw new Error(`${p}: ${JSON.stringify(j.errors)}`)
  return j.response || []
}
// 이름 비교: 악센트·기호 제거, 소문자
const norm = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
// API-Football은 'I. Thiago'·'Thiago'처럼 줄여 쓰기도 한다 → 성(마지막 단어) + 첫 글자로 비교
function same(a, b) {
  const x = norm(a).split(' ')
  const y = norm(b).split(' ')
  if (x.join(' ') === y.join(' ')) return true
  if (x.at(-1) !== y.at(-1)) return y.length === 1 ? x.includes(y[0]) : x.length === 1 ? y.includes(x[0]) : false
  return x.length === 1 || y.length === 1 || x[0][0] === y[0][0]
}
const teamKey = (s) => norm(s).replace(/\b(fc|afc|cf|sc|ac|ssc|club|de|cd|ud|rc|as|ogc|losc|sv|vfl|vfb|tsg|1|fk)\b/g, '').replace(/\s+/g, ' ').trim()
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296 }

const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'))
for (const code of process.argv.slice(2)) {
  const [lid, afLeague] = LEAGUES[code] || []
  if (!lid) { console.log(`모르는 대회 코드: ${code}`); continue }
  const file = path.join(DATA, index.leagues.find((l) => l.id === lid).seasons[0].file)
  const season = JSON.parse(fs.readFileSync(file, 'utf8'))
  // football-data 구단 ID → 영문 이름
  const fdTeams = await fetch(`https://api.football-data.org/v4/competitions/${code}/teams?season=${code === 'BSA' ? 2025 : 2025}`, { headers: { 'X-Auth-Token': FD } }).then((r) => r.json())
  const enName = Object.fromEntries((fdTeams.teams || []).map((t) => [t.id, t.shortName || t.name]))
  // API-Football 구단 목록 (무료 플랜은 2024 시즌까지) → 이름으로 맞춘다. 승격팀은 이름 검색
  const afTeams = (await af(`/teams?league=${afLeague}&season=2024`)).map((x) => x.team)
  console.log(`\n## ${lid}`)
  let added = 0
  let dropped = 0
  for (const t of season.teams) {
    const en = enName[t.ext] || ''
    let at = afTeams.find((x) => teamKey(x.name) === teamKey(en)) || afTeams.find((x) => teamKey(x.name).includes(teamKey(en)) || teamKey(en).includes(teamKey(x.name)))
    if (!at && en) at = (await af(`/teams?search=${encodeURIComponent(teamKey(en).split(' ')[0])}`)).map((x) => x.team).find((x) => same(x.name, en) || teamKey(x.name) === teamKey(en))
    if (!at) { console.log(`- ${t.name}(${en}): API-Football 구단을 못 찾음`); continue }
    const now = (await af(`/players/squads?team=${at.id}`))[0]?.players || []
    if (!now.length) continue
    const ours = t.players
    const missing = now.filter((q) => POS[q.position] && q.age >= 17 && !ours.some((p) => same(p.name, q.name)))
    // 지금 명단에 없는 기존 선수 (임대·이적으로 떠난 것으로 보임)
    const gone = ours.filter((p) => !now.some((q) => same(p.name, q.name)))
    const fresh = missing.map((q) => {
      const pos = POS[q.position]
      const peers = ours.filter((p) => p.pos === pos)
      // 같은 구단·포지션 중간값에서 추정 (26~30세 +1, 21세 미만 −4)
      const adj = q.age < 21 ? -4 : q.age <= 25 ? 0 : q.age <= 30 ? 1 : -2
      const n = (k) => Math.round((hash(`${k}-${q.id}`) - 0.5) * 6)
      return {
        id: `${t.id}-AF${q.id}`, name: q.name, pos, number: q.number ?? null, age: q.age,
        att: Math.max(30, (median(peers.map((p) => p.att)) ?? 65) + adj + n('a')),
        def: Math.max(30, (median(peers.map((p) => p.def)) ?? 65) + adj + n('d')),
        sta: Math.max(35, (median(peers.map((p) => p.sta)) ?? 70) + n('s')),
        nation: null, photo: q.photo || null, ext: null, af: q.id,
      }
    })
    let players = [...ours, ...fresh]
    // 30명 초과: 떠난 것으로 보이는 선수부터, 그다음 어린 선수부터 뺀다
    while (players.length > MAX) {
      const out = players.find((p) => gone.includes(p)) || [...players].filter((p) => p.pos !== 'GK').sort((a, b) => a.age - b.age)[0]
      players = players.filter((p) => p !== out)
      dropped++
    }
    // 새로 들어온 선수의 등번호가 겹치면 지운다 (게임이 빈 번호를 준다)
    const used = new Set()
    for (const p of players) { if (p.number && used.has(p.number)) p.number = null; if (p.number) used.add(p.number) }
    t.players = players
    added += fresh.length
    if (fresh.length || gone.length) console.log(`- ${t.name}: 추가 ${fresh.map((p) => p.name).join(', ') || '없음'} · 현재 명단에 없음 ${gone.map((p) => p.name).join(', ') || '없음'}`)
  }
  season.squadsCheckedAt = new Date().toISOString().slice(0, 10)
  season.updatedAt = season.squadsCheckedAt
  fs.writeFileSync(file, JSON.stringify(season) + '\n')
  console.log(`✔ ${lid}: ${added}명 추가 · ${dropped}명 정리`)
}
console.log(`\nAPI-Football 요청 ${calls}회`)
