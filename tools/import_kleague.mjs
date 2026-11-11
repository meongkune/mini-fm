// K리그1·2 현재 명단 → 게임용 '이적 시장 리그' 데이터 (API-Football 무료 플랜, 요청 약 27회)
//   무료 플랜은 2022~2024 시즌만 열려 있어서: 구단 ID는 2024 시즌 목록에서, 명단은 시즌이 필요 없는 '현재 명단'(/players/squads)으로 받는다
//   한글 이름은 기존 위키데이터 목록(fa/korea.json)의 로마자 이름과 맞춰 찾고, 못 찾으면 로마자 그대로 쓴다
//   능력치는 API에 없으므로 리그 수준(K리그1 > K리그2)·나이·포지션·고정 난수로 추정한다 (SportsAPI 능력치가 생기면 덮어쓸 수 있다)
// 실행: API_FOOTBALL_KEY=... node tools/import_kleague.mjs → frontend/public/data/k-league/2026.json + index.json 등록
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'frontend', 'public', 'data')
const KEY = process.env.API_FOOTBALL_KEY
if (!KEY) throw new Error('API_FOOTBALL_KEY 환경 변수가 없습니다')

let calls = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function get(p) {
  if (calls) await sleep(7000) // 무료 플랜은 분당 약 10회 제한
  calls++
  const res = await fetch(`https://v3.football.api-sports.io${p}`, { headers: { 'x-apisports-key': KEY } })
  const j = await res.json()
  if (j.errors?.rateLimit && (get.retry = (get.retry || 0) + 1) <= 3) { await sleep(65000); return get(p) } // 분당 한도: 1분 쉬고 다시
  get.retry = 0
  if (j.errors && Object.keys(j.errors).length) throw new Error(`${p}: ${JSON.stringify(j.errors)}`)
  return j.response || []
}

// 구단 한글 이름 (API-Football 영문 이름 → 한국어)
const KO = {
  'Gangwon FC': '강원 FC', 'Daegu FC': '대구 FC', 'Seoul E-Land FC': '서울 이랜드', 'Daejeon Citizen': '대전 하나시티즌', 'Asan Mugunghwa': '충남아산 FC',
  'Suwon City FC': '수원 FC', 'Gwangju FC': '광주 FC', 'Jeju United FC': '제주 SK', 'Jeonbuk Motors': '전북 현대', 'Incheon United': '인천 유나이티드',
  'Pohang Steelers': '포항 스틸러스', 'FC Seoul': 'FC 서울', 'Ulsan Hyundai FC': '울산 HD', 'Gimcheon Sangmu FC': '김천 상무', 'Suwon Bluewings': '수원 삼성',
  'Busan I Park': '부산 아이파크', 'Jeonnam Dragons': '전남 드래곤즈', 'Gyeongnam FC': '경남 FC', 'Bucheon FC 1995': '부천 FC 1995', 'Ansan Greeners': '안산 그리너스',
  'Seongnam FC': '성남 FC', 'Gimpo Citizen': '김포 FC', 'Cheonan City': '천안 시티', 'Chungbuk Cheongju': '충북청주 FC', 'FC Anyang': 'FC 안양', 'Hwaseong FC': '화성 FC',
}
const COLORS = ['#ff7a00', '#5cb3ff', '#0b2a63', '#7b1fa2', '#00843d', '#d50000', '#1b5e20', '#004b87', '#e65100', '#212121', '#ad1457', '#00695c']

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
const rnd = (k) => (hash(k) % 10000) / 10000
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)))
const norm = (s = '') => s.toLowerCase().replace(/[^a-z]/g, '')
const POS = { Goalkeeper: 'GK', Defender: 'DF', Midfielder: 'MF', Attacker: 'FW' }

// 기존 위키데이터 목록의 로마자 이름 → 한글 이름
// 한글 이름 사전: 지난번에 만든 K리그 파일(nameEn → name)과, 남아 있으면 예전 위키데이터 목록
const koName = new Map()
for (const f of [path.join(DATA, 'k-league', '2026.json'), path.join(DATA, 'fa', 'korea.json')]) {
  if (!fs.existsSync(f)) continue
  const j = JSON.parse(fs.readFileSync(f, 'utf8'))
  const list = j.players || (j.teams || []).flatMap((t) => t.players)
  for (const p of list) { const k = norm(p.nameEn); if (k && p.name && !koName.has(k)) koName.set(k, p.name) }
}

const leagueTeams = new Map()
for (const [lid, tier] of [[292, 1], [293, 2]]) {
  for (const t of await get(`/teams?league=${lid}&season=2024`)) if (!leagueTeams.has(t.team.id)) leagueTeams.set(t.team.id, { team: t.team, tier })
}

const teams = []
let matched = 0
const seen = new Set() // 이적 중인 선수가 두 구단 명단에 모두 나오는 경우가 있다 → 처음 나온 구단에만
for (const [tid, { team, tier }] of leagueTeams) {
  const sq = (await get(`/players/squads?team=${tid}`))[0]?.players || []
  const short = (KO[team.name] || team.name).replace(/\s*FC$/, '').trim()
  const players = sq.filter((p) => POS[p.position] && p.age >= 17 && p.age <= 38 && !seen.has(p.id) && seen.add(p.id)).map((p) => {
    const pos = POS[p.position]
    const ko = koName.get(norm(p.name))
    if (ko) matched++
    // 수준: K리그1 평균 OVR ~62, K리그2 ~57 · 나이 곡선 · 고정 난수 · 등번호가 작을수록 주전일 가능성
    const age = p.age
    const starter = p.number && p.number <= 30 ? 2 : -2
    // 실제 K리그 시세(주전급 €1~3M)에 맞춰: 게임 몸값 식에서 OVR 70 ≈ €1.6M, 74 ≈ €4M
    const base = (tier === 1 ? 62 : 57) + (age < 21 ? -6 : age < 24 ? -2 : age <= 30 ? 1.5 : age <= 33 ? 0 : -3) + starter + (rnd(`k-${p.id}`) - 0.5) * 7
    const bias = { GK: [-30, 1], DF: [-12, 4], MF: [0, 0], FW: [8, -18] }[pos]
    return {
      id: `KL-${p.id}`,
      name: ko || p.name,
      ...(ko ? { nameEn: p.name } : {}),
      pos,
      number: p.number ?? null,
      age,
      att: clamp(base + bias[0] + (rnd(`a-${p.id}`) - 0.5) * 8, 30, 88),
      def: clamp(base + bias[1] + (rnd(`d-${p.id}`) - 0.5) * 8, 30, 88),
      sta: clamp(base + (rnd(`s-${p.id}`) - 0.5) * 12, 35, 90),
      nation: 'South Korea',
      photo: p.photo || null,
      ext: { af: p.id },
    }
  })
  if (!players.length) continue
  teams.push({
    id: `K${tid}`,
    name: KO[team.name] || team.name,
    short,
    color: COLORS[hash(team.name) % COLORS.length],
    alt: '#ffffff',
    logo: team.logo || null,
    tier,
    players,
  })
}

const out = path.join(DATA, 'k-league', '2026.json')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify({
  league: { name: 'K리그', country: '대한민국', marketOnly: true },
  season: '2026',
  updatedAt: new Date().toISOString().slice(0, 10),
  source: 'API-Football (K리그1·2 현재 명단) · 능력치는 추정값',
  zones: [],
  teams,
}) + '\n')

// index.json에 '이적 시장 전용 리그'로 등록 (직접 맡는 리그 목록에는 안 보인다)
const idxFile = path.join(DATA, 'index.json')
const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'))
idx.leagues = idx.leagues.filter((l) => l.id !== 'k-league')
idx.leagues.push({ id: 'k-league', name: 'K리그', country: '대한민국', marketOnly: true, seasons: [{ id: '2026', file: 'k-league/2026.json', teams: teams.length }] })
fs.writeFileSync(idxFile, JSON.stringify(idx, null, 2) + '\n')

const total = teams.reduce((s, t) => s + t.players.length, 0)
console.log(`✔ K리그 ${teams.length}개 구단 · ${total}명 (한글 이름 매칭 ${matched}명) · 요청 ${calls}회`)
