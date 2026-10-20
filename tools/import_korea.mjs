// 한국 선수 FA 풀: 위키데이터(CC0)에서 K리그1·2 현역 한국 선수 명단을 받아 게임용 데이터로 만든다
//   - 이름(한글·영문), 생년월일→나이, 포지션, 마지막 소속 구단
//   - 능력치는 나이·리그 수준·고정 난수로 생성 (실제 능력과 다를 수 있음)
// 실행: node tools/import_korea.mjs  →  frontend/public/data/fa/korea.json (토큰 필요 없음)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'frontend', 'public', 'data', 'fa', 'korea.json')
const UA = { 'User-Agent': 'MiniFM-importer/1.0 (https://github.com/meongkune/mini-fm)', Accept: 'application/sparql-results+json' }
const LEAGUES = { Q2386334: ['K리그1', 1], Q5100359: ['K리그2', 2] }

const QUERY = `
SELECT ?p ?pLabel ?pEn ?dob ?team ?teamLabel ?league ?start (GROUP_CONCAT(DISTINCT ?posEn; separator="|") AS ?positions) WHERE {
  VALUES ?league { wd:Q2386334 wd:Q5100359 }
  ?team wdt:P118 ?league .
  ?p p:P54 ?st . ?st ps:P54 ?team .
  FILTER NOT EXISTS { ?st pq:P582 ?end }
  OPTIONAL { ?st pq:P580 ?start }
  ?p wdt:P27 wd:Q884 ; wdt:P569 ?dob .
  FILTER(YEAR(?dob) >= 1989)
  OPTIONAL { ?p wdt:P413 ?pos . ?pos rdfs:label ?posEn . FILTER(LANG(?posEn) = "en") }
  OPTIONAL { ?p rdfs:label ?pEn . FILTER(LANG(?pEn) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ko,en". }
} GROUP BY ?p ?pLabel ?pEn ?dob ?team ?teamLabel ?league ?start`

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
const rnd = (k) => (hash(k) % 10000) / 10000
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)))

function mapPos(list) {
  const p = list.toLowerCase()
  if (p.includes('goal')) return ['GK', 'GK']
  if (p.includes('centre-back') || p.includes('center back') || p.includes('centre back')) return ['DF', 'CB']
  if (p.includes('full-back') || p.includes('full back') || p.includes('wing-back') || p.includes('wing back')) return ['DF', hash(p) % 2 ? 'LB' : 'RB']
  if (p.includes('defender')) return ['DF', 'CB']
  if (p.includes('defensive midfield')) return ['MF', 'DM']
  if (p.includes('attacking midfield')) return ['MF', 'AM']
  if (p.includes('winger') || p.includes('wing')) return ['FW', hash(p) % 2 ? 'LW' : 'RW']
  if (p.includes('midfield')) return ['MF', 'CM']
  if (p.includes('forward') || p.includes('striker')) return ['FW', 'ST']
  return null
}

const res = await fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(QUERY)}`, { headers: UA })
if (!res.ok) throw new Error(`위키데이터 요청 실패 ${res.status}`)
const rows = (await res.json()).results.bindings

// 같은 선수가 여러 구단에 남아 있으면(종료일 누락) 가장 최근 입단 기록을 쓴다
const best = new Map()
for (const r of rows) {
  const id = r.p.value.split('/').pop()
  const start = r.start?.value || '1900'
  if (!best.has(id) || start > best.get(id).start) best.set(id, { r, start })
}
const today = new Date('2025-08-15')
const players = []
for (const [qid, { r, start }] of best) {
  if (start !== '1900' && start < '2019') continue // 입단 기록이 오래된 선수는 현역 여부가 불확실해 제외 (입단일이 없는 선수는 포함)
  // 포지션 정보가 없으면 고정 난수로 추정 (GK 10% · DF 33% · MF 33% · FW 24%)
  const guess = () => { const x = hash(`pos-${qid}`) % 100; return x < 10 ? ['GK', 'GK'] : x < 43 ? ['DF', x % 3 ? 'CB' : x % 2 ? 'LB' : 'RB'] : x < 76 ? ['MF', x % 4 ? 'CM' : 'DM'] : ['FW', x % 3 ? 'ST' : 'LW'] }
  const mapped = mapPos(r.positions?.value || '')
  const pos = mapped || guess()
  const dob = new Date(r.dob.value)
  let age = today.getFullYear() - dob.getFullYear()
  if (today < new Date(today.getFullYear(), dob.getMonth(), dob.getDate())) age--
  if (age < 17 || age > 35) continue
  const [leagueName, tier] = LEAGUES[r.league.value.split('/').pop()]
  // 수준: K리그1 평균 OVR ~67, K리그2 ~62. 나이 곡선 + 고정 난수
  const base = (tier === 1 ? 67 : 62) + (age < 21 ? -5 : age < 24 ? -1.5 : age <= 30 ? 1.5 : age <= 32 ? 0 : -3) + (rnd(`k-${qid}`) - 0.5) * 10
  const bias = { GK: [-30, 1], DF: [-12, 4], MF: [0, 0], FW: [8, -22] }[pos[0]]
  const ko = r.pLabel.value.replace(/\s*\(.*\)\s*$/, '').trim() // "이인규 (축구 선수)" → "이인규"
  if (/^Q\d+$/.test(ko)) continue // 이름이 없는 항목
  players.push({
    id: `KOR-${qid}`,
    name: ko,
    nameEn: r.pEn?.value || ko,
    pos: pos[0],
    role: pos[1],
    age,
    att: clamp(base + bias[0] + (rnd(`a-${qid}`) - 0.5) * 10, 35, 90),
    def: clamp(base + bias[1] + (rnd(`d-${qid}`) - 0.5) * 10, 35, 90),
    sta: clamp(base + (rnd(`s-${qid}`) - 0.5) * 14, 35, 90),
    nation: 'South Korea',
    lastClub: r.teamLabel.value,
    league: leagueName,
    wikidata: qid,
    ...(mapped ? {} : { posGuess: true }),
  })
}
players.sort((a, b) => b.att + b.def - (a.att + a.def))
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify({ source: 'Wikidata (CC0) · K리그1·2 현역 한국 선수', updatedAt: new Date().toISOString().slice(0, 10), players }, null, 1) + '\n')
const byPos = players.reduce((c, p) => ({ ...c, [p.pos]: (c[p.pos] || 0) + 1 }), {})
console.log(`✔ 한국 선수 ${players.length}명 → ${path.relative(ROOT, OUT)}`, byPos)
