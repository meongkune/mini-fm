// SportsAPI Pro로 선수 능력치를 실제 데이터 기반으로 다시 계산한다 (하루 무료 100회 안에서 조금씩, 다음 날 이어서)
//   1단계: 리그마다 시즌 ID·팀 목록(2회) → 팀별 선수 명단(팀당 1회): 시장가치·나이·세부 포지션으로 OVR 계산
//   2단계: 명단이 끝나면 선수별 능력치 레이더(1인 1회, OVR 높은 선수부터)로 공격·수비 비중 보정
// 약관상 원본 응답은 공개하면 안 되므로 저장소에는 '계산한 결과'(공격·수비·세부 포지션)와 진행 상태(ID 대응표)만 남긴다.
// 실행: SPORTSAPIPRO_KEY=... node tools/sportsapi_ratings.mjs  (MAX_CALLS로 이번 실행 요청 수 제한, 기본 95)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'frontend', 'public', 'data')
const OUT = path.join(DATA, 'ratings')
const STATE_FILE = path.join(ROOT, 'tools', 'sportsapi-state.json')
const KEY = process.env.SPORTSAPIPRO_KEY
const MAX_CALLS = Number(process.env.MAX_CALLS || 95)
const BASE = 'https://api.sportsapipro.com/v2/football'
if (!KEY) throw new Error('SPORTSAPIPRO_KEY 환경 변수가 없습니다')

// 우리 리그 ID → SportsAPI(유니크) 대회 ID
const TOURNAMENTS = {
  'premier-league': 17, 'la-liga': 8, bundesliga: 35, 'serie-a': 23, 'ligue-1': 34,
  eredivisie: 37, 'primeira-liga': 238, championship: 18, brasileirao: 325,
}
// SportsAPI 세부 포지션 코드 → 게임 역할
const ROLE = { GK: 'GK', DC: 'CB', DL: 'LB', DR: 'RB', DM: 'DM', MC: 'CM', ML: 'LM', MR: 'RM', AM: 'AM', LW: 'LW', RW: 'RW', ST: 'ST', CF: 'ST', WBL: 'LWB', WBR: 'RWB' }
const ROLE_POS = { GK: 'GK', CB: 'DF', LB: 'DF', RB: 'DF', LWB: 'DF', RWB: 'DF', DM: 'MF', CM: 'MF', LM: 'MF', RM: 'MF', AM: 'MF', LW: 'FW', RW: 'FW', ST: 'FW' }
// 역할별 기본 공격-수비 차이 (레이더 데이터가 없을 때)
const GAP = { GK: -40, CB: -16, LB: -10, RB: -10, LWB: -6, RWB: -6, DM: -12, CM: 0, LM: 8, RM: 8, AM: 12, LW: 15, RW: 15, ST: 18 }

const today = new Date().toISOString().slice(0, 10)
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : { leagues: {}, players: {} }
const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1) + '\n')

let calls = 0
let remaining = Infinity
/** 한도 초과가 아닌 오류(없는 팀·선수 등)는 건너뛰고 계속 */
async function tryGet(p) {
  try { return await get(p) } catch (e) { if (e.budget) throw e; console.log(`  건너뜀: ${e.message}`); return null }
}
async function get(p) {
  if (calls >= MAX_CALLS || remaining <= 2) throw Object.assign(new Error('오늘 요청 한도 도달'), { budget: true })
  calls++
  const res = await fetch(`${BASE}${p}`, { headers: { 'x-api-key': KEY } })
  const left = Number(res.headers.get('x-ratelimit-remaining'))
  if (Number.isFinite(left)) remaining = left
  if (res.status === 429) throw Object.assign(new Error('요청 한도 초과(429)'), { budget: true })
  if (!res.ok) throw new Error(`${p} → ${res.status}`)
  const j = await res.json()
  return j.data ?? j
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)))
const norm = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/ł/g, 'l').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
const ageOf = (ts) => { if (!ts) return null; const d = new Date(ts * 1000); const ref = new Date('2025-08-15'); let a = ref.getFullYear() - d.getFullYear(); if (ref < new Date(ref.getFullYear(), d.getMonth(), d.getDate())) a--; return a }

/** 시장가치(€)·나이 → OVR. €100M≈88 · €10M≈78 · €1M≈68 · €200k≈61 (어린 선수는 잠재력 몫을 빼고, 베테랑은 낮은 시세를 보정) */
function ovrFrom(mv, age, role) {
  let o = 58 + 10 * Math.log10(Math.max(mv, 5e4) / 1e5)
  o += age <= 20 ? -4 : age <= 21 ? -3 : age <= 23 ? -1.5 : age <= 29 ? 0 : age <= 31 ? 2 : age <= 33 ? 4 : 6
  if (role === 'GK') o += 3 // 골키퍼는 시장가치가 낮게 매겨진다
  return clamp(o, 45, 93)
}
/** OVR과 공격-수비 차이(gap)로 공격·수비 값을 정한다 (게임의 포지션별 OVR 공식과 맞춘다) */
function split(ovr, pos, gap) {
  if (pos === 'GK') return { att: clamp(ovr - 35, 20, 70), def: ovr }
  let att
  let def
  if (pos === 'DF') { def = ovr - 0.2 * gap; att = def + gap }
  else if (pos === 'FW') { att = ovr + 0.2 * gap; def = att - gap }
  else { att = ovr + gap / 2; def = ovr - gap / 2 }
  return { att: clamp(att, 20, 99), def: clamp(def, 20, 99) }
}

// 우리 데이터: 리그별 최신 시즌 파일과 결과 파일
const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'))
const ours = {}
for (const l of index.leagues) {
  if (!TOURNAMENTS[l.id]) continue
  const season = JSON.parse(fs.readFileSync(path.join(DATA, l.seasons[0].file), 'utf8'))
  ours[l.id] = season.teams.flatMap((t) => t.players.map((p) => ({ ...p, lid: l.id })))
}
// 이적·강등으로 리그가 바뀐 선수도 찾도록 전체 리그에서 매칭한다
const everyone = Object.values(ours).flat()
const R = {}
const ratingsFor = (lid) => (R[lid] ||= ratingsOf(lid))
fs.mkdirSync(OUT, { recursive: true })
const ratingsOf = (lid) => { const f = path.join(OUT, `${lid}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { players: {} } }
const writeRatings = (lid, r) => fs.writeFileSync(path.join(OUT, `${lid}.json`), JSON.stringify({ source: 'SportsAPI Pro 시장가치·능력치로 계산한 게임용 값', updatedAt: today, players: r.players }, null, 0) + '\n')

/**
 * SportsAPI 선수 → 우리 선수
 * 1) 이름이 같고 나이 차 1 이하  2) 성·이름 첫 글자가 같고 나이 차 1 이하
 * 3) 우리 데이터가 한 단어 이름(예: Martinelli, Rodri)이면 그 단어가 상대 이름에 있고 나이 차 1 이하 — 후보가 하나일 때만
 */
function matchPlayer(list, sp) {
  const full = norm(sp.name)
  const age = ageOf(sp.dateOfBirthTimestamp)
  const near = (p) => age === null || p.age == null || Math.abs(p.age - age) <= 1
  const one = (c) => (c.length === 1 ? c[0] : null)
  const parts = full.split(' ')
  return one(list.filter((p) => norm(p.name) === full && near(p)))
    || one(list.filter((p) => { const q = norm(p.name).split(' '); return q.length > 1 && q.at(-1) === parts.at(-1) && q[0][0] === parts[0][0] && near(p) }))
    || one(list.filter((p) => { const q = norm(p.name).split(' '); return q.length === 1 && parts.includes(q[0]) && near(p) }))
}

let matched = 0
let attrDone = 0
try {
  // 1단계: 시즌·팀 목록·명단
  for (const [lid, ut] of Object.entries(TOURNAMENTS)) {
    if (!ours[lid]) continue
    const L = (state.leagues[lid] ||= { teams: {} })
    if (!L.season) {
      const d = await tryGet(`/api/tournaments/${ut}/seasons`)
      L.season = (d?.seasons || d)?.[0]?.id
      if (!L.season) continue
      saveState()
    }
    if (!Object.keys(L.teams).length) {
      const d = await tryGet(`/api/tournament/${ut}/season/${L.season}/standings`)
      // 순위표 형식: 평평한 목록 [{teamId, teamName}] 또는 그룹 [{rows: [{team: {id, name}}]}]
      const st = d?.standings || []
      const rows = st[0]?.rows ? st.flatMap((g) => g.rows.map((r) => ({ teamId: r.team.id, teamName: r.team.name }))) : st
      for (const row of rows) L.teams[row.teamId] = { name: row.teamName, done: null }
      saveState()
    }
    for (const [tid, t] of Object.entries(L.teams)) {
      if (t.done && (Date.parse(today) - Date.parse(t.done)) / 864e5 < 60) continue // 60일 지나면 다시 받아 이적·부상 반영
      const d = await tryGet(`/api/teams/${tid}/players`)
      for (const { player: sp } of d?.players || []) {
        const p = matchPlayer(everyone, sp)
        const mv = sp.proposedMarketValueRaw?.value ?? sp.proposedMarketValue
        if (!p || !mv) continue
        const role = ROLE[sp.positionsDetailed?.[0]]
        const useRole = role && ROLE_POS[role] === p.pos ? role : p.role
        const age = ageOf(sp.dateOfBirthTimestamp) ?? p.age
        const ovr = ovrFrom(mv, age, useRole)
        ratingsFor(p.lid).players[p.id] = { ...split(ovr, p.pos, GAP[useRole] ?? 0), ...(useRole ? { role: useRole } : {}) }
        state.players[p.id] = { sid: sp.id, lid: p.lid, ovr, attr: state.players[p.id]?.attr || null }
        matched++
      }
      t.done = today
      for (const [l, r] of Object.entries(R)) writeRatings(l, r)
      saveState()
      console.log(`  ${lid} · ${t.name}: 명단 반영`)
    }
  }
  // 2단계: OVR 높은 선수부터 능력치 레이더로 공격·수비 비중 보정
  // 우선순위: PRIORITY_LEAGUES(지금 플레이 중인 리그 등) 먼저, 그 안에서는 OVR 높은 선수부터. 레이더 값을 아직 저장 못 한 선수도 다시 받는다
  const prio = (process.env.PRIORITY_LEAGUES || 'bundesliga').split(',').map((x) => x.trim()).filter(Boolean)
  const rank = (lid) => (prio.includes(lid) ? prio.indexOf(lid) : prio.length)
  const todo = Object.entries(state.players).filter(([, s]) => !s.attr || !s.rad).sort((a, b) => rank(a[1].lid) - rank(b[1].lid) || b[1].ovr - a[1].ovr)
  for (const [pid, s] of todo) {
    const d = await tryGet(`/api/players/${s.sid}/attribute-overviews`)
    const cur = (d?.playerAttributeOverviews || []).sort((a, b) => a.yearShift - b.yearShift)[0]
    s.attr = today
    // 게임 능력치로 바꾼 레이더: 같은 포지션 평균과의 차이를 그 선수 OVR에 얹는다 (원본 점수가 아니라 게임용 계산값)
    const avg = (d?.averageAttributeOverviews || [])[0] || {}
    const conv = (k) => Math.max(30, Math.min(99, Math.round(s.ovr + ((cur[k] ?? 50) - (avg[k] ?? 50)) * 0.3)))
    if (cur && cur.position !== 'G') {
      const r = ratingsFor(s.lid)
      const p = ours[s.lid].find((x) => x.id === pid)
      const gap = Math.max(-28, Math.min(28, ((cur.attacking + cur.creativity) / 2 - cur.defending) * 0.45))
      r.players[pid] = { ...r.players[pid], ...split(s.ovr, p.pos, gap), rad: ['attacking', 'technical', 'tactical', 'defending', 'creativity'].map(conv) }
      s.rad = true
      attrDone++
    } else if (cur) {
      const r = ratingsFor(s.lid)
      r.players[pid] = { ...r.players[pid], gk: ['saves', 'anticipation', 'ballDistribution', 'aerial'].map(conv) }
      s.rad = true
      attrDone++
    }
    saveState()
  }
  console.log('✔ 모든 선수 처리 완료')
} catch (e) {
  if (!e.budget) throw e
  console.log(`⏸ ${e.message} — 내일 이어서 진행합니다`)
} finally {
  for (const [lid, r] of Object.entries(R)) writeRatings(lid, r)
  saveState()
}
console.log(`요청 ${calls}회 · 명단 매칭 ${matched}명 · 레이더 보정 ${attrDone}명 · 남은 요청 ${remaining}`)
