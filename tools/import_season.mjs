#!/usr/bin/env node
// football-data.org에서 리그 팀·선수단을 받아 Mini FM 시즌 파일로 변환한다.
//
//   FOOTBALL_DATA_TOKEN=<토큰> node tools/import_season.mjs --competition PL --season 2025
//
// 결과: frontend/public/data/<리그 ID>/<시즌>.json 생성 + frontend/public/data/index.json 갱신
// - 팀·선수 이름, 포지션, 등번호, 나이: API 그대로 (팀 이름은 아는 구단만 한국어로)
// - 능력치(공격·수비·체력): API에 없으므로 생성한다. 팀 기준치는 전 시즌 순위, 선수는 나이 곡선 + 선수 ID 기반 고정 난수
//   → 같은 입력이면 항상 같은 결과. 관리자 화면에서 고칠 수 있다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'frontend', 'public', 'data')
const API = 'https://api.football-data.org/v4'

// 무료 플랜에서 쓸 수 있는 주요 리그 → 앱 리그 ID·이름·순위 구간
export const COMPETITIONS = {
  PL: { id: 'premier-league', name: '프리미어리그', country: '잉글랜드', zones: [[1, 4, '챔피언스리그', '#3b82f6'], [5, 5, '유로파리그', '#f59e0b'], [-3, -1, '강등', '#ef4444']] },
  PD: { id: 'la-liga', name: '라리가', country: '스페인', zones: [[1, 4, '챔피언스리그', '#3b82f6'], [5, 5, '유로파리그', '#f59e0b'], [-3, -1, '강등', '#ef4444']] },
  BL1: { id: 'bundesliga', name: '분데스리가', country: '독일', zones: [[1, 4, '챔피언스리그', '#3b82f6'], [5, 5, '유로파리그', '#f59e0b'], [-2, -1, '강등', '#ef4444']] },
  SA: { id: 'serie-a', name: '세리에 A', country: '이탈리아', zones: [[1, 4, '챔피언스리그', '#3b82f6'], [5, 5, '유로파리그', '#f59e0b'], [-3, -1, '강등', '#ef4444']] },
  FL1: { id: 'ligue-1', name: '리그 1', country: '프랑스', zones: [[1, 3, '챔피언스리그', '#3b82f6'], [4, 4, '유로파리그', '#f59e0b'], [-2, -1, '강등', '#ef4444']] },
}

// 프리미어리그 구단 한국어 이름·짧은 이름·유니폼 색 (TLA 기준). 없는 구단은 API의 영어 이름과 clubColors를 쓴다
const KNOWN_TEAMS = {
  ARS: ['아스널', '아스널', '#EF0107', '#F5F5F5'], AVL: ['애스턴 빌라', '애스턴 빌라', '#670E36', '#95BFE5'],
  BOU: ['AFC 본머스', '본머스', '#DA291C', '#0C0C0C'], BRE: ['브렌트퍼드', '브렌트퍼드', '#E30613', '#FBB800'],
  BHA: ['브라이턴', '브라이턴', '#0057B8', '#F5F5F5'], BUR: ['번리', '번리', '#6C1D45', '#99D6EA'],
  CHE: ['첼시', '첼시', '#034694', '#F5F5F5'], CRY: ['크리스털 팰리스', '팰리스', '#1B458F', '#C4122E'],
  EVE: ['에버턴', '에버턴', '#003399', '#F5F5F5'], FUL: ['풀럼', '풀럼', '#F5F5F5', '#0C0C0C'],
  LEE: ['리즈 유나이티드', '리즈', '#F5F5F5', '#1D428A'], LIV: ['리버풀', '리버풀', '#C8102E', '#F6EB61'],
  MCI: ['맨체스터 시티', '맨시티', '#6CABDD', '#1C2C5B'], MUN: ['맨체스터 유나이티드', '맨유', '#DA291C', '#F5F5F5'],
  NEW: ['뉴캐슬 유나이티드', '뉴캐슬', '#241F20', '#41B6E6'], NOT: ['노팅엄 포레스트', '노팅엄', '#DD0000', '#F5F5F5'],
  SUN: ['선덜랜드', '선덜랜드', '#EB172B', '#0C0C0C'], TOT: ['토트넘 홋스퍼', '토트넘', '#132257', '#F5F5F5'],
  WHU: ['웨스트햄 유나이티드', '웨스트햄', '#7A263A', '#1BB1E7'], WOL: ['울버햄튼', '울버햄튼', '#FDB913', '#231F20'],
  LEI: ['레스터 시티', '레스터', '#003090', '#FDBE11'], IPS: ['입스위치 타운', '입스위치', '#0033A0', '#F5F5F5'],
  SOU: ['사우샘프턴', '사우샘프턴', '#D71920', '#F5F5F5'],
}

const COLOR_WORDS = {
  red: '#D7262F', white: '#F5F5F5', black: '#151515', blue: '#1F4FB0', 'sky blue': '#6CABDD', navy: '#132257', 'navy blue': '#132257',
  yellow: '#F2C500', gold: '#D4A017', green: '#1E8C45', orange: '#F37021', claret: '#7A263A', purple: '#5B2C83', maroon: '#6C1D45',
  grey: '#8A8D93', gray: '#8A8D93', amber: '#FDB913', silver: '#C0C0C0', violet: '#7F3FBF', brown: '#6B3E26', pink: '#E86A92',
}
const colorsFrom = (clubColors = '') => {
  const words = clubColors.toLowerCase().split('/').map((w) => w.trim())
  const hex = words.map((w) => COLOR_WORDS[w] || COLOR_WORDS[w.split(' ').at(-1)]).filter(Boolean)
  return [hex[0] || '#5B5F6B', hex[1] || '#F5F5F5']
}

// football-data.org 포지션 → GK/DF/MF/FW (세부 포지션 문자열도 처리)
export function mapPosition(pos) {
  const p = (pos || '').toLowerCase() // API는 포지션이 없으면 null을 준다
  if (p.includes('goal')) return 'GK'
  if (p.includes('back') || p.includes('defen')) return 'DF'
  if (p.includes('mid')) return 'MF' // "Attacking Midfield"도 MF (attack보다 먼저 검사)
  if (p.includes('wing') || p.includes('forward') || p.includes('offen') || p.includes('striker') || p.includes('attack')) return 'FW'
  return null
}

// 문자열 → 0~1 고정 난수 (FNV-1a + mulberry32)
function seeded(str) {
  let h = 2166136261
  for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ageOn = (dob, refDate) => {
  if (!dob) return 26
  const d = new Date(dob)
  let age = refDate.getFullYear() - d.getFullYear()
  if (refDate < new Date(refDate.getFullYear(), d.getMonth(), d.getDate())) age--
  return age
}
// 나이 곡선: 26~30세 전성기, 어리거나 많으면 감점
const ageBonus = (age) => (age < 19 ? -10 : age < 21 ? -6 : age < 24 ? -2 : age <= 30 ? 2 : age <= 32 ? -1 : -5)
const clamp = (v) => Math.max(40, Math.min(95, Math.round(v)))
// 포지션별 공격/수비 보정. 앱의 OVR 계산(store.jsx playerOvr)과 맞물려 포지션 간 OVR이 비슷하게 분포한다
const BIAS = { GK: [-30, 1], DF: [-12, 4], MF: [0, 0], FW: [8, -22] }
const ovrOf = (p) => (p.pos === 'GK' ? p.def : p.pos === 'DF' ? p.def * 0.8 + p.att * 0.2 : p.pos === 'FW' ? p.att * 0.8 + p.def * 0.2 : (p.att + p.def) / 2)

// 1군 등록 인원(프리미어리그 25명 규정). 포지션별 최소 인원을 먼저 채우고 나머지는 OVR 순
const SQUAD_SIZE = 25
const QUOTA = { GK: 3, DF: 8, MF: 8, FW: 5 }
const POS_ORDER = ['GK', 'DF', 'MF', 'FW']
// API가 등번호를 주지 않을 때 포지션별로 흔히 쓰는 번호를 주전(OVR 높은 순)부터 배정
const NUMBERS = { GK: [1, 13, 31, 41], DF: [2, 5, 4, 3, 6, 15, 12, 24, 26, 33], MF: [8, 10, 6, 7, 16, 14, 18, 20, 17, 22], FW: [9, 11, 7, 19, 10, 21, 29, 23] }

export function pickSquad(players) {
  const sorted = [...players].sort((a, b) => ovrOf(b) - ovrOf(a))
  const chosen = new Set()
  for (const pos of POS_ORDER) sorted.filter((p) => p.pos === pos).slice(0, QUOTA[pos]).forEach((p) => chosen.add(p))
  for (const p of sorted) if (chosen.size < SQUAD_SIZE) chosen.add(p)
  const squad = sorted.filter((p) => chosen.has(p)).sort((a, b) => POS_ORDER.indexOf(a.pos) - POS_ORDER.indexOf(b.pos))
  // 등번호: API 번호가 있으면 우선, 없으면 포지션 관례 번호 → 남은 번호
  const used = new Set(squad.map((p) => p.number).filter(Boolean))
  for (const p of squad) {
    if (p.number) continue
    p.number = NUMBERS[p.pos].find((n) => !used.has(n)) ?? Array.from({ length: 99 }, (_, i) => i + 1).find((n) => n > 12 && !used.has(n))
    used.add(p.number)
  }
  return squad
}

/** API 응답 → Mini FM 시즌 데이터 (네트워크 없음, 테스트 가능) */
export function transform({ competition, seasonYear, teamsResp, prevStandingsResp, today = new Date() }) {
  const comp = COMPETITIONS[competition]
  if (!comp) throw new Error(`지원하지 않는 리그: ${competition}`)
  const label = `${seasonYear}-${String((seasonYear + 1) % 100).padStart(2, '0')}`
  const refDate = new Date(Date.UTC(seasonYear, 7, 15)) // 시즌 시작(8월 중순) 기준 나이

  // 전 시즌 순위로 팀 기준치: 1위 79 → 꼴찌 69, 승격팀(전 시즌 없음)은 68
  const prevRank = {}
  for (const row of prevStandingsResp?.standings?.find((s) => s.type === 'TOTAL')?.table || []) prevRank[row.team.id] = row.position
  const lastRank = Math.max(2, ...Object.values(prevRank)) // 순위표 크기(최하위 순위)

  const teams = (teamsResp.teams || []).map((t) => {
    const tla = (t.tla || t.shortName || t.name).replace(/[^A-Z0-9]/gi, '').slice(0, 3).toUpperCase()
    const known = KNOWN_TEAMS[tla]
    const [color, alt] = known ? [known[2], known[3]] : colorsFrom(t.clubColors)
    const rank = prevRank[t.id]
    const base = rank ? 79 - ((rank - 1) / (lastRank - 1)) * 10 : 68

    const players = pickSquad((t.squad || [])
      .map((p) => ({ ...p, pos: mapPosition(p.position) }))
      .filter((p) => p.pos)
      .map((p) => {
        const rnd = seeded(`${p.id}-${p.name}`)
        const age = ageOn(p.dateOfBirth, refDate)
        const b = base + ageBonus(age) + (rnd() - 0.5) * 6
        const [ab, db] = BIAS[p.pos]
        return {
          id: `${tla}-${p.id}`, // API 선수 ID 기반이라 다시 가져와도 같은 선수는 같은 ID
          name: p.name,
          pos: p.pos,
          number: Number(p.shirtNumber) || 0,
          age,
          att: clamp(b + ab + (rnd() - 0.5) * 12),
          def: clamp(b + db + (rnd() - 0.5) * 12),
          sta: clamp(b + (rnd() - 0.5) * 18),
          ...(p.nationality ? { nation: p.nationality } : {}),
          ext: p.id, // football-data.org 선수 ID (다시 가져올 때 대조용)
        }
      }))

    return {
      id: tla,
      name: known ? known[0] : t.shortName || t.name,
      short: known ? known[1] : t.shortName || t.name,
      color,
      alt,
      ext: t.id,
      players,
    }
  })

  // 경기가 성립하려면 포지션별 최소 인원이 필요하다
  const problems = teams.filter((t) => ['GK', 'DF', 'MF', 'FW'].some((pos) => t.players.filter((p) => p.pos === pos).length < (pos === 'GK' ? 1 : 3)))
  return {
    season: {
      league: { id: comp.id, name: comp.name, country: comp.country },
      season: label,
      updatedAt: today.toISOString().slice(0, 10),
      source: `football-data.org (${competition} ${seasonYear})`,
      zones: comp.zones.map(([from, to, l, c]) => ({ from, to, label: l, color: c })),
      teams,
    },
    label,
    warnings: problems.map((t) => `${t.name}: 포지션별 선수가 부족합니다 (선수단 ${t.players.length}명)`),
  }
}

/** index.json에 시즌을 추가하거나 갱신한다 */
export function upsertIndex(index, comp, label, teamsCount) {
  const out = structuredClone(index)
  let league = out.leagues.find((l) => l.id === comp.id)
  if (!league) { league = { id: comp.id, name: comp.name, country: comp.country, seasons: [] }; out.leagues.push(league) }
  const entry = { id: label, file: `${comp.id}/${label}.json`, teams: teamsCount }
  const i = league.seasons.findIndex((s) => s.id === label)
  if (i >= 0) league.seasons[i] = entry; else league.seasons.push(entry)
  league.seasons.sort((a, b) => b.id.localeCompare(a.id)) // 최신 시즌이 앞으로
  return out
}

async function get(url, token) {
  const res = await fetch(url, { headers: { 'X-Auth-Token': token } })
  if (res.status === 429) throw new Error('요청 한도 초과(분당 10회). 1분 뒤 다시 실행하세요.')
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}\n${(await res.text()).slice(0, 300)}`)
  return res.json()
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((a) => a.trim().split(/\s+/)))
  const competition = (args.competition || 'PL').toUpperCase()
  const seasonYear = Number(args.season || new Date().getFullYear())
  const makeDefault = args.default === 'true'
  const token = process.env.FOOTBALL_DATA_TOKEN
  if (!token) throw new Error('환경 변수 FOOTBALL_DATA_TOKEN이 없습니다.')
  const comp = COMPETITIONS[competition]
  if (!comp) throw new Error(`지원 리그: ${Object.keys(COMPETITIONS).join(', ')}`)

  console.log(`▶ ${comp.name} ${seasonYear} 팀·선수단 가져오는 중…`)
  const teamsResp = await get(`${API}/competitions/${competition}/teams?season=${seasonYear}`, token)
  let prevStandingsResp = null
  try {
    prevStandingsResp = await get(`${API}/competitions/${competition}/standings?season=${seasonYear - 1}`, token)
  } catch (e) {
    console.warn(`  (전 시즌 순위를 받지 못해 모든 팀을 같은 기준치로 생성합니다: ${e.message.split('\n')[0]})`)
  }

  const { season, label, warnings } = transform({ competition, seasonYear, teamsResp, prevStandingsResp })
  const dir = path.join(DATA_DIR, comp.id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${label}.json`), JSON.stringify(season, null, 1) + '\n')

  const indexPath = path.join(DATA_DIR, 'index.json')
  let index = upsertIndex(JSON.parse(fs.readFileSync(indexPath, 'utf8')), comp, label, season.teams.length)
  if (makeDefault) index.default = { league: comp.id, season: label }
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 1) + '\n')

  const players = season.teams.reduce((s, t) => s + t.players.length, 0)
  console.log(`✔ ${comp.name} ${label}: ${season.teams.length}팀, 선수 ${players}명 → data/${comp.id}/${label}.json`)
  for (const w of warnings) console.warn(`  ⚠ ${w}`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ✔ ${comp.name} ${label} 가져오기 완료\n- 팀 ${season.teams.length}개, 선수 ${players}명\n${warnings.map((w) => `- ⚠ ${w}`).join('\n')}\n`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('✖', e.message); process.exit(1) })
}
