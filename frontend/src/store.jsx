import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { api, loadSeasonFile, loadStadiums } from './api.js'
import { playerOvrOf } from './engine/engine.js'
import { available } from './engine/match.js'
import { assignSlots, buildSlots, fitOf, setCustomLayout, shapeNeeds } from './engine/formation.js'
import { applyCupMatch, applyRound, customTalk, engineStatus, news, playerTalk, resolveTalk } from './game/season.js'
import { cleanName, effectiveTeams } from './game/roster.js'
import { applyTalkResult } from './game/aiTalk.js'
import { checkPromises } from './game/relations.js'
import { PATIENCE, evaluateBid, evaluateLoan, executeTransfer, loanTargets, swapCredit, valueCtx, windowState } from './game/trade.js'
import { boardMidCheck, newBoard, nextSeason, seasonLabel, seasonReview } from './game/career.js'
import { COMPS, CUP_LEAGUES, buildCups, cupKey, cupStatus, dueMatchday, myCupFixture, playMatchday } from './game/cup.js'
import { FX_DEFAULT, cashOnly, gateModel, clubKOf, legacyWageV3, setClubK, setFx, wageInfo, ROSTER_MAX, book, checkBankruptcy, contractOf, eur, faDecision, ffpReview, newFinance, prizeMoney, releaseCost, renewalAsk, settleMatch, wageBill, wageBudget, wageFor, wageShock } from './game/finance.js'
import { afterMatchOwner, decide } from './game/owner.js'
import { valueOf } from './game/trade.js'
// 받침에 따라 '로/으로'
const ro = (w) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return w + (c < 0 || c > 11171 ? '(으)로' : c % 28 === 0 || c % 28 === 8 ? '로' : '으로') }

// 시즌 진행 상황은 서버가 아니라 브라우저 localStorage에 저장한다 (서버는 stateless).
// v2: 프리미어리그 구단 데이터로 바뀌면서 이전 저장(가상 구단 ID)과 호환되지 않아 키를 올림
const STORAGE_KEY = 'mini-fm-save-v1'
const MANAGER_KEY = 'mini-fm-manager' // 감독 프로필은 세이브와 따로 (경질·팀 변경에도 유지)
try { indexedDB.deleteDatabase('mini-fm') } catch { /* 예전 VRM 감독 파일 정리 */ }
const EMPTY_SAVE = {
  league: null, // 리그 ID (예: premier-league) — null이면 index.json 기본값
  season: null, // 시즌 ID (예: 2025-26)
  teamId: null,
  formation: '4-4-2',
  mentality: 'balanced',
  pressing: 'normal',
  lineup: [], // 포메이션 자리 순서대로 선수 ID (빈 자리는 null)
  line: 'normal', // 수비 라인
  tempo: 'normal', // 템포
  round: 0,
  results: [],
  // 감독 모드
  seasonNo: 1, // 같은 시즌 데이터로 몇 번째 시즌인지
  status: {}, // 선수 상태: 컨디션·사기·폼·부상·징계
  pstats: {}, // 선수 시즌 기록: 출전·골·도움·평점·클린시트·카드·MOM
  inbox: [], // 메시지함
  rosters: null, // 트레이드로 바뀐 선수단 { teamId: [playerId] }
  mods: {}, // 성장·노화로 바뀐 능력치
  youth: [], // 유스 입단 선수
  history: [], // 지난 시즌 기록
  finance: null, // 구단 재정 { cash, ticket, last, ledger }
  fans: 60, // 팬 민심 0~100
  owner: {}, // 구단주 결정 상태
  contracts: {}, // 선수 계약 { until(시즌 번호), wage(€M/년) }
  signed: [], // FA로 영입한 선수
  released: [], // 방출한 선수 (다시 FA 시장에)
  board: null, // 보드 목표·신뢰도
}

function loadSave() {
  try {
    const s = { ...EMPTY_SAVE, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }
    // 예전 버그로 생긴 중복 영입·괄호 붙은 이름 정리
    if (s.rosters) s.rosters = Object.fromEntries(Object.entries(s.rosters).map(([k, ids]) => [k, [...new Set(ids)]]))
    if (s.signed) s.signed = s.signed.map((p) => ({ ...p, name: cleanName(p.name) }))
    return s
  } catch {
    return EMPTY_SAVE
  }
}

export const playerOvr = playerOvrOf

// 좁은 화면용 짧은 구단명 (예: 맨체스터 유나이티드 → 맨유)
export const short = (team) => team?.short || team?.name || ''

// 두 팀 색이 비슷하면(예: 아스널·리버풀 둘 다 빨강) 원정팀은 원정 유니폼 색을 쓴다
export function kitColors(home, away) {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [a, b] = [rgb(home.color), rgb(away.color)]
  const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  return [home.color, dist < 140 && away.alt ? away.alt : away.color]
}

// 밝은 색(흰 유니폼 등) 위에는 어두운 글자를 쓴다
export function ink(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#111827' : '#ffffff'
}

// 어두운 배경 위 막대·테두리용: 팀 색이 너무 어두우면(예: 뉴캐슬 검정) 밝은 회색으로
export function onDark(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.299 * r + 0.587 * g + 0.114 * b < 60 ? '#cbd5e1' : hex
}

export function teamOvr(team) {
  const top = [...team.players].map(playerOvr).sort((a, b) => b - a).slice(0, 11)
  return Math.round(top.reduce((s, v) => s + v, 0) / top.length)
}

/** 저장된 내 팀 전술 (경기 엔진에 넘기는 형태) */
export const myTactics = (save) => ({
  formation: save.formation, mentality: save.mentality, pressing: save.pressing, line: save.line ?? 'normal', tempo: save.tempo ?? 'normal',
  width: save.width ?? 50, passing: save.passing ?? 50, approach: save.approach || 'balanced', focus: save.focus || 'mixed', trap: !!save.trap, tackling: save.tackling || 'normal',
  // 세트피스: 코너킥 루틴 · 상대 코너킥 수비 · 키커(없으면 자동)
  corner: save.corner || 'mixed', cornerDef: save.cornerDef || 'zonal', spTaker: save.spTaker || null, penTaker: save.penTaker || null,
})

/** 다른 리그 구단 명단에 이적 결과 반영: 내가 데려온 선수(gone)는 빼고, 내가 판 선수(abroad)는 넣는다 */
export function applyWorld(team, lid, save) {
  const gone = save.gone || {}
  const extra = Object.values(save.abroad || {}).filter((a) => a.lid === lid && a.teamId === team.id).map((a) => a.player)
  if (!extra.length && !team.players.some((p) => gone[p.id])) return team
  return { ...team, players: [...team.players.filter((p) => !gone[p.id]), ...extra] }
}
const adjustMap = (map, save) => Object.fromEntries(Object.entries(map).map(([k, t]) => [k, applyWorld(t, k.split('/')[0], save)]))

/** 이번 시즌 FFP 승점 감점 */
const penaltyOf = (save) => (save.pointsPenalty?.seasonNo === (save.seasonNo || 1) ? save.pointsPenalty : null)

const hashStr = (t) => { let h = 2166136261; for (const c of String(t)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }

export const formationNeeds = shapeNeeds

/**
 * 지금 라인업 기준 팀 OVR: 자리마다 (선수 OVR × 자리 적합도), 빈 자리는 0으로 계산
 * → 포지션이 맞지 않는 선수를 세우거나 자리를 비우면 그만큼 떨어진다
 */
export function lineupOvr(team, formation, lineup) {
  const slots = buildSlots(formation)
  const byId = Object.fromEntries(team.players.map((p) => [p.id, p]))
  let sum = 0
  slots.forEach((s, i) => { const p = byId[lineup?.[i]]; if (p) sum += playerOvr(p) * fitOf(p, s.role) })
  return Math.round(sum / slots.length)
}

/** 컨디션·출전 가능을 고려한 자동 배치 (자리 순서, 빈 자리는 null) */
export function autoSlots(team, formation, status = {}, keep = {}) {
  return assignSlots(team, formation, { status, keep, available: (id) => available(status, id) })
}

/** 고른 선수들은 그대로 두고 새 포메이션의 가장 알맞은 자리로 옮긴다 (남는 자리는 null) */
export function alignLineup(team, formation, ids) {
  const chosen = { players: ids.filter(Boolean).map((id) => team.players.find((p) => p.id === id)).filter(Boolean) }
  const out = assignSlots(chosen, formation, { useCondition: false })
  return out.slice(0, buildSlots(formation).length)
}

/** 빈 자리 중 이 선수에게 가장 알맞은 자리 인덱스 */
export function bestEmptySlot(formation, lineup, player) {
  const slots = buildSlots(formation)
  let best = -1
  let bestFit = -1
  slots.forEach((s, i) => {
    if (lineup[i]) return
    const f = fitOf(player, s.role)
    if (f > bestFit) { bestFit = f; best = i }
  })
  return best
}

export function computeStandings(teams, results, penalty = null) {
  const table = Object.fromEntries(
    teams.map((t) => [t.id, { id: t.id, name: t.name, color: t.color, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] }]),
  )
  for (const r of results) {
    const [hg, ag] = r.score
    const h = table[r.home]
    const a = table[r.away]
    if (!h || !a) continue // 다른 시즌 데이터가 섞인 경우 무시
    h.p++; a.p++
    h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg
    if (hg > ag) { h.w++; a.l++; h.pts += 3; h.form.push('W'); a.form.push('L') }
    else if (hg < ag) { a.w++; h.l++; a.pts += 3; h.form.push('L'); a.form.push('W') }
    else { h.d++; a.d++; h.pts++; a.pts++; h.form.push('D'); a.form.push('D') }
  }
  if (penalty?.points && table[penalty.teamId]) table[penalty.teamId].pts -= penalty.points // FFP 승점 감점
  return Object.values(table).sort(
    (x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.name.localeCompare(y.name),
  )
}

const GameContext = createContext(null)

const FX_KEY = 'mini-fm-fx' // 통화 표시 설정·오늘 환율

export function GameProvider({ children }) {
  const [data, setData] = useState(null) // { league, teams, formations, schedule }
  const [error, setError] = useState(null)
  const [save, setSave] = useState(loadSave)
  // 직접 조정한 배치(경기장에서 끌어 옮긴 자리 좌표)를 자리 계산에 등록 — 렌더 전에
  if (save.layout?.name) setCustomLayout(save.layout.name, save.layout.pos)
  // 연봉 계산에 쓰는 내 구단 규모 (구단 재정에 저장해 둔 값)
  setClubK(save.finance?.clubK)
  const [manager, setManager] = useState(() => { try { return JSON.parse(localStorage.getItem(MANAGER_KEY) || 'null') } catch { return null } })
  const [cupTeams, setCupTeams] = useState({}) // 대항전에 나오는 다른 리그 팀 (키: 리그/팀ID)
  const [world, setWorld] = useState({}) // 이적 시장용 다른 리그 (K리그 포함): { 리그ID: { name, teams } }
  const [stadiums, setStadiums] = useState({}) // 홈구장 { 리그ID: { 구단ID: { name, cap } } }
  useEffect(() => { loadStadiums().then(setStadiums) }, [])
  // 통화 표시(유로·원화·둘 다)와 오늘 환율 — 바뀌면 화면 전체를 다시 그린다
  const [fx, setFxState] = useState(() => {
    let saved = null
    try { saved = JSON.parse(localStorage.getItem(FX_KEY) || 'null') } catch { /* 없음 */ }
    const v = { rate: saved?.rate || FX_DEFAULT, date: saved?.date || null, rateDate: saved?.rateDate || null, mode: saved?.mode || 'both' }
    setFx(v)
    return v
  })
  const changeFx = (patch) => setFxState((f) => {
    const v = { ...f, ...patch }
    setFx(v)
    try { localStorage.setItem(FX_KEY, JSON.stringify(v)) } catch { /* 저장 못 해도 이번 화면에는 적용 */ }
    return v
  })
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    if (fx.date === today) return
    // 유럽중앙은행 기준 환율 (영업일마다 갱신). 주소가 바뀌어도 되도록 두 곳을 차례로 시도
    const urls = ['https://api.frankfurter.app/latest?from=EUR&to=KRW', 'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=KRW']
    ;(async () => {
      for (const u of urls) {
        try {
          const j = await fetch(u).then((r) => r.json())
          if (j?.rates?.KRW) { changeFx({ rate: j.rates.KRW, date: today, rateDate: j.date }); return }
        } catch { /* 다음 주소 */ }
      }
    })()
  }, [])

  // 리그·시즌이 바뀔 때마다 해당 시즌 데이터를 불러온다
  useEffect(() => {
    let alive = true
    setData(null)
    setError(null)
    ;(async () => {
      const sel = await api.selectSeason(save.league, save.season)
      const [t, s, index] = await Promise.all([api.teams(), api.schedule(), api.index()])
      // 시즌 데이터를 다시 가져와 선수 ID가 바뀌었으면 선발을 자동으로 다시 고른다
      const team = effectiveTeams(t.teams, save).find((x) => x.id === save.teamId)
      // 선발: 없는 선수가 있거나 예전(자리 순서가 아닌) 형식이면 고른 선수를 유지한 채 자리에 맞춰 다시 배치
      const invalid = team && save.lineup.some((id) => id && !team.players.some((p) => p.id === id))
      const legacy = team && !save.slotLineup
      const fresh = team && (invalid || legacy || save.lineup.length !== 11)
        ? (() => {
            const kept = alignLineup(team, save.formation, save.lineup.filter((id) => id && team.players.some((p) => p.id === id)))
            const keep = Object.fromEntries(kept.map((id, i) => [i, id]).filter(([, id]) => id))
            return autoSlots(team, save.formation, {}, keep)
          })()
        : null
      if (!alive) return
      setData({ ...t, schedule: s.rounds, index, leagueId: sel.leagueId, seasonId: sel.seasonId })
      setSave((cur) => {
        // 저장된 팀이 이 시즌에 없으면(시즌 파일 교체 등) 팀 선택부터 다시
        const teamMissing = cur.teamId && !t.teams.some((x) => x.id === cur.teamId)
        if (teamMissing) return { ...EMPTY_SAVE, league: sel.leagueId, season: sel.seasonId }
        if (fresh && cur.teamId === team.id) cur = { ...cur, lineup: fresh, slotLineup: true }
        if (cur.league === sel.leagueId && cur.season === sel.seasonId) return cur
        return { ...cur, league: sel.leagueId, season: sel.seasonId }
      })
    })().catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [save.league, save.season])

  // 예전 저장(보드 목표 없음)이면 지금 전력으로 목표를 정한다
  useEffect(() => {
    if (data && save.teamId && !save.board) setSave((s) => ({ ...s, board: newBoard(effectiveTeams(data.teams, s), s.teamId) }))
  }, [data, save.teamId, save.board])

  // 구단주 모드: 재정 시작, 내 선수 모두에게 계약을 고정 (없으면 생성)
  useEffect(() => {
    if (!data || !save.teamId) return
    const team = effectiveTeams(data.teams, save).find((t) => t.id === save.teamId)
    if (!team) return
    const missing = team.players.filter((p) => !save.contracts?.[p.id])
    const oldWages = save.finance && !(save.finance.wageModel >= 2) // 예전 연봉 공식(구단 규모 무시)으로 만든 세이브
    // 실제 보도 연봉이 새로 들어온 선수가 있는데 계약은 아직 추정 연봉 (재계약한 계약은 제외) — 매일 수집되므로 계속 확인
    const noReal = save.finance && save.finance.wageModel >= 2 && team.players.some((p) => { const c = save.contracts?.[p.id]; return c && !c.real && !c.renewed && wageInfo(p, data.leagueId, save.finance.clubK).real })
    const toV4 = save.finance && (save.finance.wageModel === 2 || save.finance.wageModel === 3) // 구단 연봉 총액 방식(4판) 전
    if (save.finance?.base && !missing.length && !oldWages && !noReal && !toV4) return
    setSave((s) => {
      // 조건은 최신 상태로 다시 본다 (두 번 실행돼도 한 번만 바뀌게)
      const oldWages = s.finance && !(s.finance.wageModel >= 2)
      const noReal = s.finance && s.finance.wageModel >= 2 && team.players.some((p) => { const c = s.contracts?.[p.id]; return c && !c.real && !c.renewed && wageInfo(p, data.leagueId, s.finance.clubK).real })
      const missing = team.players.filter((p) => !s.contracts?.[p.id])
      const toV4 = s.finance && (s.finance.wageModel === 2 || s.finance.wageModel === 3)
      if (s.finance?.base && !missing.length && !oldWages && !noReal && !toV4) return s
      const k = !s.finance || oldWages || toV4 ? clubKOf(team, data.leagueId) : s.finance.clubK
      setClubK(k)
      const contracts = { ...(s.contracts || {}) }
      let finance = s.finance
      const inbox = []
      if (oldWages) {
        // 연봉 개편: 예전 공식 대비 협상으로 더 받던 비율은 유지하고 새 기준으로 다시 매긴다. 수입 규모도 연봉 총액 비율만큼 맞춘다
        const legacy = (p) => { const m = { 'premier-league': 1.6, 'la-liga': 1.25, bundesliga: 1.2, 'serie-a': 1.1, 'ligue-1': 1.0, eredivisie: 0.55, 'primeira-liga': 0.5, championship: 0.45, brasileirao: 0.4 }[data.leagueId] ?? 1; const ageK = p.age <= 21 ? 0.6 : p.age <= 24 ? 0.85 : p.age <= 30 ? 1 : 0.85; return Math.max(0.1, 0.9 * Math.pow(1.11, playerOvr(p) - 72) * m * ageK) }
        let before = 0
        let after = 0
        for (const p of team.players) {
          const c = contracts[p.id]
          if (!c) continue
          const premium = Math.max(0.8, Math.min(1.6, c.wage / legacy(p)))
          const wage = Math.round(wageFor(p, data.leagueId, k) * premium * 10) / 10
          before += c.wage
          after += wage
          contracts[p.id] = { ...c, wage }
        }
        const ratio = before > 0 ? after / before : 1
        finance = { ...s.finance, base: Math.round(s.finance.base * ratio * 10) / 10, clubK: k, wageModel: 4 }
        inbox.push(news(s.round, 'finance', '💶 연봉 체계 개편', `선수 연봉을 실제 시세에 맞게 다시 매겼습니다 (구단 규모·리그·선수 가치 기준). 연봉 총액 ${eur(before)} → ${eur(after)}/년, 구단 수입 규모도 같은 비율로 맞췄습니다. 협상으로 더 받던 선수는 그 비율을 유지합니다.`, { read: false }))
      }
      if (toV4) {
        // 연봉 기준 4판: 구단 연봉 총액을 먼저 정하고 선수 가치 비율대로 나눈다. 협상으로 더 받던 비율·실제 보도 연봉·재계약 연봉은 유지
        let before = 0
        let after = 0
        for (const p of team.players) {
          const c = contracts[p.id]
          if (!c) continue
          before += c.wage
          if (c.real || c.renewed) { after += c.wage; continue }
          const premium = Math.max(0.8, Math.min(1.6, c.wage / Math.max(0.1, legacyWageV3(p, data.leagueId, s.finance.clubK))))
          const w = wageInfo(p, data.leagueId, k)
          const wage = w.real ? w.wage : Math.round(w.wage * premium * 10) / 10
          after += wage
          contracts[p.id] = { ...c, wage, ...(w.real ? { real: true } : {}) }
        }
        const ratio = before > 0 ? after / before : 1
        finance = { ...s.finance, base: Math.round(s.finance.base * ratio * 10) / 10, clubK: k, wageModel: 4 }
        inbox.push(news(s.round, 'finance', '💶 연봉 기준 조정', `연봉을 실제 구단들처럼 '구단 연봉 총액 → 선수 가치 비율로 나누기' 방식으로 다시 매겼습니다. 연봉 총액 ${eur(before)} → ${eur(after)}/년, 구단 수입 규모도 같은 비율로 맞췄습니다 (FFP 비율은 그대로).`, { read: false }))
      }
      if (noReal || oldWages) {
        // 실제 보도 연봉이 있는 선수는 계약 연봉을 그 값으로 (재계약으로 바뀐 계약은 그대로)
        const fixed = []
        let before = 0
        let after = 0
        for (const p of team.players) {
          const c = contracts[p.id]
          const w = wageInfo(p, data.leagueId, k)
          if (!c || c.renewed || !w.real) continue
          before += c.wage
          after += w.wage
          contracts[p.id] = { ...c, wage: w.wage, real: true }
          fixed.push(p.name.split(' ').at(-1))
        }
        if (fixed.length) {
          const bill = team.players.reduce((a, p) => a + (contracts[p.id]?.wage || 0), 0)
          const prev = bill - after + before
          finance = { ...(finance || s.finance), base: Math.round((finance || s.finance).base * (prev > 0 ? bill / prev : 1) * 10) / 10, clubK: k, wageModel: 4 }
          inbox.push(news(s.round, 'finance', '📰 실제 보도 연봉 반영', `${fixed.length}명의 연봉을 실제 보도 값으로 바꿨습니다: ${fixed.slice(0, 8).join(', ')}${fixed.length > 8 ? ' 외' : ''}. 나머지 선수는 추정 연봉입니다. 이 선수들 연봉 합계 ${eur(before)} → ${eur(after)}/년.`, { read: false }))
        }
      }
      for (const p of missing) contracts[p.id] = contractOf({ ...s, contracts }, p, data.leagueId)
      const fresh = newFinance(team, data.leagueId)
      // 예전 재정(수입 기준 없음)은 수입 기준만 채운다
      finance = finance ? { ...finance, base: finance.base || fresh.base, cash: finance.base ? finance.cash : fresh.cash, clubK: k, wageModel: 4 } : { ...fresh, clubK: k }
      return { ...s, contracts, finance, fans: s.fans ?? 60, inbox: [...inbox, ...(s.inbox || [])].slice(0, 80) }
    })
  }, [data, save.teamId, save.rosters, save.signed?.length, save.youth?.length, save.finance?.base ? 1 : 0])

  // FFP 징계 취소 (1회): 예전 규칙 오류로 받은 징계 — 사채 상환을 손실로 셈 + 연봉 개편으로 시즌 중간에 수입 규모가 바뀜
  //   연봉 개편 알림과 FFP 징계가 둘 다 있는 세이브만, 이번 시즌 징계를 취소하고 벌금을 돌려준다
  useEffect(() => {
    const f = save.finance
    if (!f || f.ffpAppeal || f.ban !== (save.seasonNo || 1)) return
    const inbox = save.inbox || []
    const verdict = inbox.find((m) => m.title === '⚖️ FFP 위반 징계')
    if (!verdict || !inbox.some((m) => m.title === '💶 연봉 체계 개편')) return
    const fine = Number(verdict.body?.match(/벌금 -?€([\d.]+)M/)?.[1] || 0)
    setSave((s) => {
      if (!s.finance || s.finance.ffpAppeal) return s // 이미 처리됨 (두 번 실행돼도 한 번만)
      const nf = { ...s.finance, ban: null, ffpAppeal: true, breaches: Math.max(0, (s.finance.breaches || 1) - 1), cash: Math.round(((s.finance.cash || 0) + fine) * 10) / 10 }
      const note = news(s.round, 'finance', '⚖️ FFP 징계 취소', `지난 시즌 FFP 심사에 계산 오류가 있었습니다 (사채 상환을 손실로 계산, 연봉 체계 개편으로 시즌 중간에 수입 기준이 바뀜). 징계를 취소하고 벌금${fine ? ` ${eur(fine)}` : ''}을 돌려드립니다. 이번 시즌 선수 영입이 가능합니다.`, { read: false })
      return { ...s, finance: nf, pointsPenalty: s.pointsPenalty?.seasonNo === (s.seasonNo || 1) ? null : s.pointsPenalty, inbox: [note, ...(s.inbox || [])].slice(0, 80) }
    })
  }, [save.finance?.ban, save.seasonNo])

  // FFP 기록 다시 시작 (1회): 연봉 개편 전 시즌 손익은 예전(높은) 연봉 기준이라, 줄어든 새 허용 기준으로 심사하면 부당하다
  //   연봉 개편을 거친 세이브만: 지난 시즌들 손익 기록을 지우고 새 기준으로 다시 쌓는다
  useEffect(() => {
    const f = save.finance
    if (!f || f.ffpReset || !(f.history || []).length) return
    if (!(save.inbox || []).some((m) => m.title === '💶 연봉 체계 개편')) return
    setSave((s) => {
      if (!s.finance || s.finance.ffpReset) return s
      const note = news(s.round, 'finance', '⚖️ FFP 기록 다시 시작', '연봉 체계가 바뀌기 전 시즌들의 손익은 예전 연봉 기준이라 새 기준과 맞지 않습니다. 최근 3시즌 FFP 기록을 지우고 이번 시즌부터 새 기준으로 다시 쌓습니다.', { read: false })
      return { ...s, finance: { ...s.finance, history: [], ffpReset: true }, inbox: [note, ...(s.inbox || [])].slice(0, 80) }
    })
  }, [save.finance?.history?.length])

  // 이적 시장: 내 리그 말고 모든 리그(K리그 같은 '이적 시장 전용' 리그 포함) 명단을 불러 둔다
  useEffect(() => {
    if (!data) return
    let alive = true
    ;(async () => {
      const out = {}
      for (const l of data.index.leagues) {
        if (l.id === data.leagueId) continue
        const s = l.seasons.find((x) => x.id === data.seasonId) || l.seasons[0]
        try { out[l.id] = { name: l.name, teams: (await loadSeasonFile(s.file)).teams } } catch { /* 그 리그만 건너뜀 */ }
      }
      if (alive) setWorld(out)
    })()
    return () => { alive = false }
  }, [data?.leagueId, data?.seasonId])

  // 대항전(챔스·유로파·컨퍼런스): 시즌마다 참가팀을 뽑고(다른 리그 파일을 읽어서) 대진을 만든다
  const seasonNo = save.seasonNo || 1
  useEffect(() => {
    if (!data || !save.teamId || !CUP_LEAGUES.includes(data.leagueId)) return
    let alive = true
    ;(async () => {
      const leagues = data.index.leagues.filter((l) => CUP_LEAGUES.includes(l.id))
      const loaded = []
      for (const l of leagues) {
        const s = l.seasons.find((x) => x.id === data.seasonId)
        if (!s) continue
        if (l.id === data.leagueId) loaded.push({ leagueId: l.id, teams: effectiveTeams(data.teams, save), order: seasonNo > 1 ? save.lastOrder : null })
        else loaded.push({ leagueId: l.id, teams: (await loadSeasonFile(s.file)).teams })
      }
      if (!alive) return
      const map = {}
      for (const l of loaded) for (const t of l.teams) map[cupKey(l.leagueId, t.id)] = t
      setCupTeams(map)
      if (!save.cups || save.cupSeason !== seasonNo) {
        const cups = buildCups(loaded, { seed: seasonNo * 101 + (save.teamId || '').length, totalRounds: data.schedule.length })
        setSave((cur) => { const { cup: _old, ...rest } = cur; return { ...rest, cups, cupSeason: seasonNo } })
      }
    })().catch((e) => console.warn('대항전 준비 실패', e))
    return () => { alive = false }
  }, [data, save.teamId, seasonNo, save.cupSeason])

  // 내 팀 경기가 없는 대회 매치데이(미참가·탈락·다른 조)는 자동으로 진행
  useEffect(() => {
    const cups = save.cups || []
    if (!data || !cups.length || !cups.every((c) => c.teams.every((t) => cupTeams[t.key] || t.leagueId === data.leagueId))) return
    const myKey = cupKey(data.leagueId, save.teamId)
    const due = cups.map((c) => { const md = dueMatchday(c, save.round); return md && !myCupFixture(c, md, myKey) ? md : null })
    if (!due.some(Boolean)) return
    const leagueKeyed = Object.fromEntries(effectiveTeams(data.teams, save).map((t) => [cupKey(data.leagueId, t.id), t]))
    const all = { ...adjustMap(cupTeams, save), ...leagueKeyed }
    setSave((s) => {
      const st = engineStatus(s, Object.values(all))
      return { ...s, cups: s.cups.map((c, i) => (due[i] ? playMatchday(c, due[i], all, st, null, s.seasonNo || 1).cup : c)) }
    })
  }, [data, save.cups, save.round, cupTeams])

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(save)) } catch { /* 저장 실패해도 게임은 계속 */ }
  }, [save])

  const value = useMemo(() => {
    const teams = data ? effectiveTeams(data.teams, save) : []
    const teamsById = Object.fromEntries(teams.map((t) => [t.id, t]))
    const status = data ? engineStatus(save, teams) : {}
    const myTeam = save.teamId ? teamsById[save.teamId] : null
    const totalRounds = data ? data.schedule.length : 0
    const seasonOver = data ? save.round >= totalRounds : false
    // 대항전: 내 팀 키, 다른 리그 팀을 포함한 팀 찾기, 내가 나가는 대회와 이번에 치를 매치데이
    const myKey = data && save.teamId ? cupKey(data.leagueId, save.teamId) : null
    const leagueKeyed = data ? Object.fromEntries(teams.map((t) => [cupKey(data.leagueId, t.id), t])) : {}
    const allTeams = { ...adjustMap(cupTeams, save), ...leagueKeyed }
    // 이적 시장용 다른 리그 구단 (내가 데려온 선수는 빠지고, 내가 판 선수는 들어간다)
    const worldTeams = Object.entries(world).flatMap(([lid, L]) => L.teams.map((t) => ({ lid, league: L.name, team: applyWorld(t, lid, save) })))
    const findTeam = (ref) => (typeof ref === 'string' ? teamsById[ref] : ref.lid === data?.leagueId ? teamsById[ref.id] : worldTeams.find((w) => w.lid === ref.lid && w.team.id === ref.id)?.team)
    // 다른 리그 선수를 내 팀으로: 선수 정보를 세이브에 복사하고 원래 구단 명단에서는 빼 둔다
    const bringIn = (s, player, contract) => {
      const rosters = s.rosters || Object.fromEntries(teams.map((t) => [t.id, t.players.map((x) => x.id)]))
      const used = new Set(myTeam.players.map((x) => x.number))
      const number = !player.number || used.has(player.number) ? Array.from({ length: 98 }, (_, i) => i + 2).find((n) => !used.has(n)) : player.number
      const abroad = { ...(s.abroad || {}) }
      delete abroad[player.id]
      return { ...s, signed: [...(s.signed || []).filter((x) => x.id !== player.id), { ...player, number, from: undefined }], rosters: { ...rosters, [s.teamId]: [...rosters[s.teamId].filter((id) => id !== player.id), player.id] }, gone: { ...(s.gone || {}), [player.id]: true }, abroad, contracts: { ...s.contracts, [player.id]: contract }, status: { ...s.status, [player.id]: { morale: 74, cond: 100 } } }
    }
    // 내 선수를 다른 구단으로 (같은 리그면 명단 이동, 다른 리그면 그 구단 명단에 들어간 것으로 기록)
    const sendOut = (s, p, teamId, lid) => {
      if (!lid || lid === data.leagueId) return executeTransfer(s, teams, s.teamId, teamId, p.id)
      const rosters = s.rosters || Object.fromEntries(teams.map((t) => [t.id, t.players.map((x) => x.id)]))
      const gone = { ...(s.gone || {}) }
      delete gone[p.id]
      return { ...s, rosters: { ...rosters, [s.teamId]: rosters[s.teamId].filter((id) => id !== p.id) }, lineup: s.lineup.map((id) => (id === p.id ? null : id)), forSale: (s.forSale || []).filter((id) => id !== p.id), gone, abroad: { ...(s.abroad || {}), [p.id]: { lid, teamId, player: { ...p } } } }
    }
    const isLoanIn = (id) => save.loans?.[id]?.dir === 'in'
    // 선수+현금: 끼워 넣는 내 선수 (임대 온 선수는 안 됨)
    const swapOf = (theirs, swapId) => {
      const mine = swapId && !isLoanIn(swapId) ? myTeam.players.find((x) => x.id === swapId) : null
      return mine ? swapCredit(theirs, mine, valueOf(mine, status[mine.id], valueCtx(save, mine, data.leagueId))) : null
    }
    const cups = save.cups || []
    const cupIdx = cups.findIndex((c) => c.teams.some((t) => t.key === myKey))
    const cup = cupIdx >= 0 ? cups[cupIdx] : null
    const comp = cup ? COMPS[cup.tier] : null
    const cupReady = cup && cup.teams.every((t) => allTeams[t.key])
    const cupMd = cupReady ? dueMatchday(cup, save.round) : null
    const myCup = cupMd ? myCupFixture(cup, cupMd, myKey) : null
    const leagueFixture = data && myTeam && !seasonOver
      ? data.schedule[save.round].find((m) => m.home === myTeam.id || m.away === myTeam.id)
      : null
    // 다음 경기: 유럽 대항전이 끼어 있으면 그것부터. homeTeam/awayTeam은 팀 객체, isHome은 내 팀이 홈인지
    const nextFixture = myCup
      ? { ...myCup, cup: true, label: `${comp.short} ${cupMd.label}`, comp, homeTeam: allTeams[myCup.home], awayTeam: allTeams[myCup.away], isHome: myCup.home === myKey }
      : leagueFixture
        ? { ...leagueFixture, homeTeam: teamsById[leagueFixture.home], awayTeam: teamsById[leagueFixture.away], isHome: leagueFixture.home === myTeam.id, label: `${save.round + 1}라운드` }
        : null

    const update = (patch) => setSave((s) => ({ ...s, ...patch }))

    /** 이 경기의 구장·관중: 홈 구단 구장, 내 홈경기는 티켓 가격·민심으로 정한 관중률, 다른 경기는 82~99% */
    const venueOf = (homeId, lid = data?.leagueId, seed = '') => {
      const st = stadiums[lid]?.[homeId]
      if (!st) return null
      let rate = 0.82 + ((([...String(`${homeId}-${seed}`)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)) % 1000) / 1000) * 0.17
      if (homeId === save.teamId && save.finance) rate = gateModel(save.finance, save.fans ?? 60, save).att
      return { name: st.name, cap: st.cap, crowd: st.cap ? Math.round(st.cap * Math.min(1, rate)) : null, rate }
    }
    return {
      venueOf,
      fx, changeFx,
      manager,
      saveManager(m) { setManager(m); try { localStorage.setItem(MANAGER_KEY, JSON.stringify(m)) } catch { /* 저장 실패 무시 */ } },
      data, error, save, teams, teamsById, myTeam, totalRounds, seasonOver, nextFixture, update, status,
      cups, cup, cupIdx, cupMd, allTeams, myKey, worldTeams, cupState: cup ? cupStatus(cup, myKey) : null,
      standings: data ? computeStandings(teams, save.results, penaltyOf(save)) : [],
      unread: (save.inbox || []).filter((x) => !x.read).length,
      /** 컨디션·부상·징계를 고려한 베스트 11 */
      autoPick(formation = save.formation, teamId = save.teamId) {
        return autoSlots(teamsById[teamId], formation, status)
      },
      chooseTeam(teamId) {
        const lineup = autoSlots(teamsById[teamId], '4-4-2', {})
        const base = effectiveTeams(data.teams, EMPTY_SAVE)
        setSave((s) => ({ ...EMPTY_SAVE, league: s.league, season: s.season, teamId, lineup, slotLineup: true, board: newBoard(base, teamId) }))
      },
      seasonText: data ? `${data.leagueInfo.name} ${seasonLabel(data.season, save.seasonNo)}` : '',
      review: data && save.teamId && save.round >= data.schedule.length ? seasonReview(save, computeStandings(teams, save.results, penaltyOf(save))) : null,
      /** 시즌 마감 → 다음 시즌 (경질되면 팀 선택으로) */
      startNextSeason() {
        setSave((s) => {
          const standingsNow = computeStandings(teams, s.results, penaltyOf(s))
          const r = nextSeason(s, { teams, baseTeams: data.teams, standings: standingsNow, country: data.leagueInfo.country, baseSeason: data.season })
          if (r.review.sacked) {
            return { ...EMPTY_SAVE, league: s.league, season: s.season, sacked: { team: s.teamId, history: r.save.history } }
          }
          // 구단주 결산: 순위 상금, 사채 상환, 계약 만료 선수 이탈
          const pos = standingsNow.findIndex((x) => x.id === s.teamId) + 1
          const prize = prizeMoney(pos, standingsNow.length, s.finance?.base || 40)
          const repay = Math.min(s.owner?.debt || 0, Math.round(((s.owner?.debt || 0) / 2) * 10) / 10)
          // 사채 상환은 빌린 돈을 갚는 것이라 FFP 손익에 넣지 않는다 (빌릴 때도 수입으로 치지 않았다)
          const settled = cashOnly(book(r.save.finance || {}, prize, '리그 상금'), -repay)
          const ffp = ffpReview(settled, wageBill(s, myTeam, data.leagueId), s.seasonNo || 1)
          const finance = { ...ffp.finance, ...(ffp.penalty ? { ban: (s.seasonNo || 1) + 1 } : {}) }
          const owner = { ...(r.save.owner || {}), debt: Math.round(((s.owner?.debt || 0) - repay) * 10) / 10, used: {}, youthBoost: false, sponsorBoost: 0 }
          // 임대 복귀: 빌려 온 선수는 원래 구단으로, 빌려 준 선수는 우리 팀으로
          if (s.loans && Object.keys(s.loans).length) {
            const rs = { ...r.save.rosters }
            let signed = r.save.signed || []
            const gone = { ...(r.save.gone || {}) }
            const abroad = { ...(r.save.abroad || {}) }
            const contracts = { ...(r.save.contracts || {}) }
            const back = []
            for (const [id, L] of Object.entries(s.loans)) {
              if (L.dir === 'in') {
                rs[s.teamId] = rs[s.teamId].filter((x) => x !== id)
                if (L.lid === data.leagueId) rs[L.teamId] = [...(rs[L.teamId] || []).filter((x) => x !== id), id]
                else { signed = signed.filter((x) => x.id !== id); delete gone[id] }
                delete contracts[id]
                back.push(`${L.name || '선수'} → ${L.club}`)
              } else {
                if (L.lid === data.leagueId) rs[L.teamId] = (rs[L.teamId] || []).filter((x) => x !== id)
                else delete abroad[id]
                rs[s.teamId] = [...rs[s.teamId].filter((x) => x !== id), id]
                back.push(`${L.name || '선수'} ← ${L.club}`)
              }
            }
            r.save = { ...r.save, rosters: rs, signed, gone, abroad, contracts, loans: {}, inbox: [news(0, 'trade', `🔁 임대 종료 ${back.length}명`, `${back.join(', ')}. 임대 기간이 끝나 선수들이 원래 팀으로 돌아갔습니다.`), ...(r.save.inbox || [])] }
          }
          const leaving = Object.entries(s.contracts || {}).filter(([id, c]) => c.until < (s.seasonNo || 1) + 1 && r.save.rosters?.[s.teamId]?.includes(id)).map(([id]) => id)
          const byIdNow = Object.fromEntries(teams.flatMap((t) => t.players).map((p) => [p.id, p]))
          const rosters = { ...r.save.rosters, [s.teamId]: r.save.rosters[s.teamId].filter((id) => !leaving.includes(id)) }
          const released = [...(s.released || []), ...leaving.map((id) => byIdNow[id]).filter(Boolean).map((p) => ({ ...p, from: s.teamId }))]
          const closing = [
            news(0, 'finance', `💼 시즌 결산: 상금 ${eur(prize)}`, `${pos}위 상금 ${eur(prize)}${repay ? ` · 사채 상환 ${eur(repay)}` : ''}. 시즌 손익 ${eur(ffp.st.cur)} · FFP ${ffp.st.label}. 현재 현금 ${eur(finance.cash)}.`),
            ...(ffp.penalty ? [news(0, 'finance', '⚖️ FFP 위반 징계', `최근 3시즌 손익 ${eur(ffp.st.total)} (허용 -${eur(ffp.st.allowance)}) · 매출 대비 연봉 ${Math.round(ffp.st.ratio * 100)}%. 벌금 ${eur(ffp.penalty.fine)}, 이번 시즌 선수 영입 금지${ffp.penalty.points ? `, 승점 ${ffp.penalty.points}점 감점` : ''}.`)] : []),
            ...(leaving.length ? [news(0, 'contract', `📄 계약 만료 ${leaving.length}명 이탈`, `${leaving.map((id) => byIdNow[id]?.name).join(', ')} 선수가 계약이 끝나 팀을 떠났습니다. FA 시장에서 다시 영입할 수 있습니다.`)] : []),
          ]
          r.save = { ...r.save, finance, owner, rosters, released, lineup: r.save.lineup.map((id) => (leaving.includes(id) ? null : id)), inbox: [...closing, ...(r.save.inbox || [])].slice(0, 80) }
          const nextTeams = effectiveTeams(data.teams, r.save)
          const mine = nextTeams.find((t) => t.id === s.teamId)
          const keep = Object.fromEntries(r.save.lineup.map((id, i) => [i, id]).filter(([, id]) => id && mine.players.some((p) => p.id === id)))
          const lineup = autoSlots(mine, s.formation, {}, keep)
          const pointsPenalty = ffp.penalty?.points ? { seasonNo: (s.seasonNo || 1) + 1, teamId: s.teamId, points: ffp.penalty.points } : null
          return { ...r.save, pointsPenalty, lineup, lastOrder: standingsNow.map((x) => x.id), board: newBoard(nextTeams, s.teamId, { confidence: r.conf, fails: r.review.fails }) }
        })
      },
      readInbox(id) {
        setSave((s) => ({ ...s, inbox: s.inbox.map((x) => (x.id === id || id === 'all' ? { ...x, read: true } : x)) }))
      },
      answerTalk(id, action) {
        setSave((s) => resolveTalk(s, id, action))
      },
      transferWindow: data ? windowState(save.round, data.schedule.length) : { open: false },
      /** 영입 제안: 상대 구단에 이적료 제시 → { verdict, reason, ask? } (이적 시장마다 같은 선수에 3번까지) */
      bidFor(ref, playerId, fee, { swapId = null, talk = 0 } = {}) {
        if (!windowState(save.round, data.schedule.length).open) return { verdict: 'reject', reason: '이적 시장이 닫혀 있습니다.' }
        if (save.finance?.ban === (save.seasonNo || 1)) return { verdict: 'reject', reason: 'FFP 위반 징계로 이번 시즌에는 선수를 영입할 수 없습니다.' }
        const key = `${save.seasonNo || 1}-${windowState(save.round, data.schedule.length).label}-${playerId}`
        const tries = save.bidTalks?.[key] || 0
        if (tries >= PATIENCE) return { verdict: 'reject', reason: '"더 이상 이야기하지 않겠습니다." (이번 이적 시장 협상 횟수 소진)' }
        const theirs = findTeam(ref)
        const player = theirs.players.find((p) => p.id === playerId)
        const r = evaluateBid({ theirs, player, fee, status, tries, talk, swap: swapOf(theirs, swapId), value: valueOf(player, status[player.id], valueCtx(save, player, data.leagueId)) })
        setSave((s) => ({ ...s, bidTalks: { ...(s.bidTalks || {}), [key]: tries + 1 } }))
        return { ...r, tries: tries + 1, swapId }
      },
      /** 상대 구단이 끼워 넣을 내 선수를 얼마로 쳐주는지 (미리보기) */
      swapPreview: (ref, swapId) => { const t = findTeam(ref); return t ? swapOf(t, swapId) : null },
      /** 임대 영입 제안: 임대료 + 우리가 낼 연봉 비율(share) → { verdict, reason, ask? } */
      loanBid(ref, playerId, fee, share) {
        if (!windowState(save.round, data.schedule.length).open) return { verdict: 'reject', reason: '이적 시장이 닫혀 있습니다.' }
        if (save.finance?.ban === (save.seasonNo || 1)) return { verdict: 'reject', reason: 'FFP 위반 징계로 이번 시즌에는 선수를 영입할 수 없습니다.' }
        const key = `${save.seasonNo || 1}-${windowState(save.round, data.schedule.length).label}-${playerId}`
        const tries = save.bidTalks?.[key] || 0
        if (tries >= PATIENCE) return { verdict: 'reject', reason: '"더 이상 이야기하지 않겠습니다." (이번 이적 시장 협상 횟수 소진)' }
        const theirs = findTeam(ref)
        const player = theirs.players.find((p) => p.id === playerId)
        const r = evaluateLoan({ theirs, player, fee, share, tries, value: valueOf(player, status[player.id], valueCtx(save, player, data.leagueId)) })
        setSave((s) => ({ ...s, bidTalks: { ...(s.bidTalks || {}), [key]: tries + 1 } }))
        return { ...r, tries: tries + 1 }
      },
      /** 임대 선수의 원래 연봉 (지금 구단 기준) */
      loanWage: (p, team, lid) => wageFor(p, lid, clubKOf(team, lid)),
      /** 임대 영입 확정: 시즌이 끝나면 원래 구단으로 돌아간다 */
      loanIn(ref, playerId, fee, share) {
        const theirs = findTeam(ref)
        const lid = typeof ref === 'string' ? data.leagueId : ref.lid
        const player = theirs.players.find((p) => p.id === playerId)
        const pay = Math.round(wageFor(player, lid, clubKOf(theirs, lid)) * share * 10) / 10
        if (myTeam.players.length >= ROSTER_MAX) return { ok: false, reason: `로스터가 가득 찼습니다 (${ROSTER_MAX}명).` }
        if ((save.finance?.cash ?? 0) < fee) return { ok: false, reason: `현금이 부족합니다 (보유 ${eur(save.finance?.cash ?? 0)} < 임대료 ${eur(fee)}).` }
        const billNow = wageBill(save, myTeam, data.leagueId)
        if (billNow + pay > wageBudget(save.finance)) return { ok: false, reason: `임금 예산 초과: 연봉 부담 ${eur(pay)}을 더하면 ${eur(billNow + pay)} > 예산 ${eur(wageBudget(save.finance))}.` }
        setSave((s) => {
          const contract = { until: s.seasonNo || 1, wage: pay, loan: true }
          const moved = lid !== data.leagueId ? bringIn(s, player, contract) : executeTransfer(s, teams, theirs.id, s.teamId, playerId, { contract })
          const item = news(s.round, 'trade', `🔁 임대 영입: ${player.name}`, `${theirs.name}에서 시즌 끝까지 임대. 임대료 ${eur(fee)}, 연봉 ${Math.round(share * 100)}% 부담(${eur(pay)}/년). 시즌이 끝나면 돌아갑니다.`, { read: true })
          return { ...moved, loans: { ...(s.loans || {}), [playerId]: { dir: 'in', teamId: theirs.id, lid, club: theirs.name, name: player.name, fee, share, season: s.seasonNo || 1 } }, finance: book(moved.finance, -fee, '이적료 지출'), tradeLog: [...(s.tradeLog || []), { round: s.round, in: playerId, from: theirs.id, lid: lid !== data.leagueId ? lid : undefined, fee, loan: true }], inbox: [item, ...(moved.inbox || [])] }
        })
        return { ok: true, wage: pay }
      },
      /** 내 선수 임대 보낼 곳 후보 (같은 리그, 출전 기회가 있는 구단) */
      loanOptions: (p) => (isLoanIn(p.id) ? [] : loanTargets(teams, save.teamId, p, valueOf(p, status[p.id], valueCtx(save, p, data.leagueId)))),
      /** 임대 보내기: 상대가 연봉을 전부 내고, 시즌이 끝나면 돌아온다 */
      loanOut(p, target) {
        if (!windowState(save.round, data.schedule.length).open) return { ok: false, reason: '이적 시장이 닫혀 있습니다.' }
        if (isLoanIn(p.id)) return { ok: false, reason: '임대 온 선수는 다시 임대 보낼 수 없습니다.' }
        const rank = [...myTeam.players].sort((a, b) => playerOvr(b) - playerOvr(a)).findIndex((x) => x.id === p.id)
        setSave((s) => {
          const moved = sendOut(s, p, target.team.id, data.leagueId)
          // 출전 기회를 찾아 가는 어린·후보 선수는 반기고, 주전급 베테랑은 서운해한다
          const happy = p.age <= 23 || rank >= 15
          const st = { ...(moved.status?.[p.id] || {}), morale: Math.max(0, Math.min(100, (s.status?.[p.id]?.morale ?? 60) + (happy ? 8 : -10))) }
          const item = news(s.round, 'trade', `🔁 임대 보냄: ${p.name}`, `${ro(target.team.name)} 시즌 끝까지 임대 (${target.role}). 임대료 ${eur(target.fee)}을 받고 연봉은 ${target.team.name}이 냅니다. ${happy ? '선수는 출전 기회가 생겨 반기고 있습니다.' : '선수는 밀려났다고 느껴 서운해합니다.'}`, { read: true })
          return { ...moved, status: { ...moved.status, [p.id]: st }, loans: { ...(s.loans || {}), [p.id]: { dir: 'out', teamId: target.team.id, lid: data.leagueId, club: target.team.name, name: p.name, fee: target.fee, season: s.seasonNo || 1 } }, finance: book(moved.finance, target.fee, '이적료 수입'), tradeLog: [...(s.tradeLog || []), { round: s.round, out: p.id, to: target.team.id, fee: target.fee, loan: true }], inbox: [item, ...(moved.inbox || [])] }
        })
        return { ok: true }
      },
      isLoanIn,
      /** 이적 확정: 이적료 + 개인 조건(연봉은 선수 요구액) → { ok, reason } */
      signTransfer(ref, playerId, fee, years, agreedWage = null, { swapId = null } = {}) {
        const theirs = findTeam(ref)
        const foreign = typeof ref !== 'string' && ref.lid !== data.leagueId
        const theirId = typeof ref === 'string' ? ref : ref.id
        const player = theirs.players.find((p) => p.id === playerId)
        // 요구 연봉: 우리 구단 기준과 지금 구단에서 받는 연봉 중 큰 쪽 + 15% (빅클럽 선수는 연봉을 깎고 오지 않는다)
        const fromLid = typeof ref === 'string' ? data.leagueId : ref.lid
        // 연봉 협상(대화)으로 합의했으면 그 금액, 아니면 요구 연봉
        const wage = agreedWage ?? Math.round(Math.max(wageFor(player, data.leagueId), wageFor(player, fromLid, clubKOf(theirs, fromLid))) * 1.15 * 10) / 10
        const swap = swapId ? myTeam.players.find((x) => x.id === swapId && !isLoanIn(x.id)) : null
        if (swapId && !swap) return { ok: false, reason: '끼워 넣기로 한 선수가 이미 팀에 없습니다.' }
        if (!swap && myTeam.players.length >= ROSTER_MAX) return { ok: false, reason: `로스터가 가득 찼습니다 (${ROSTER_MAX}명).` }
        if ((save.finance?.cash ?? 0) < fee) return { ok: false, reason: `현금이 부족합니다 (보유 ${eur(save.finance?.cash ?? 0)} < 이적료 ${eur(fee)}).` }
        // 끼워 넣는 선수의 연봉은 빠진다
        const billNow = wageBill(save, myTeam, data.leagueId) - (swap ? contractOf(save, swap, data.leagueId).wage : 0)
        if (billNow + wage > wageBudget(save.finance)) return { ok: false, reason: `임금 예산 초과: 연봉 ${eur(wage)}을 더하면 ${eur(billNow + wage)} > 예산 ${eur(wageBudget(save.finance))}.` }
        setSave((s) => {
          const contract = { until: (s.seasonNo || 1) + years - 1, wage }
          // 다른 리그에서 데려오면: 선수 정보를 내 세이브에 복사하고, 원래 구단 명단에서는 빼 둔다
          let moved = foreign ? bringIn(s, player, contract) : executeTransfer(s, teams, theirId, s.teamId, playerId, { contract })
          // 선수+현금: 끼워 넣은 내 선수는 상대 구단으로
          if (swap) moved = sendOut(moved, swap, theirId, fromLid)
          const item = news(s.round, 'trade', `✍️ 영입: ${player.name}`, `${theirs.name}${foreign ? ` (${world[ref.lid]?.name})` : ''}에서 이적료 ${eur(fee)}${swap ? ` + ${swap.name}(우리 선수)` : ''}, 연봉 ${eur(wage)}/년 · ${years}년 계약.`, { read: true })
          return { ...moved, finance: book(moved.finance, -fee, '이적료 지출'), tradeLog: [...(s.tradeLog || []), { round: s.round, in: playerId, from: theirId, lid: foreign ? ref.lid : undefined, fee, ...(swap ? { swap: swap.id } : {}) }, ...(swap ? [{ round: s.round, out: swap.id, to: theirId, fee: 0, swap: true }] : [])], inbox: [item, ...(moved.inbox || [])] }
        })
        return { ok: true, wage }
      },
      /** 판매 목록 등록·해제 (이적 시장이 열려 있으면 다른 구단 제안이 들어온다) */
      /** 판매 희망 가격 */
      setAskPrice(playerId, fee) { setSave((s) => ({ ...s, askPrice: { ...(s.askPrice || {}), [playerId]: fee } })) },
      toggleSale(playerId) {
        if (isLoanIn(playerId)) return
        setSave((s) => ({ ...s, forSale: (s.forSale || []).includes(playerId) ? s.forSale.filter((x) => x !== playerId) : [...(s.forSale || []), playerId] }))
      },
      /** 편지함의 다른 구단 이적료 제안에 답 */
      answerOffer(id, action, amount = null) {
        setSave((s) => {
          const item = s.inbox.find((x) => x.id === id)
          if (!item?.offer || item.resolved) return s
          const mark = (sv, reply) => ({ ...sv, inbox: sv.inbox.map((x) => (x.id === id ? { ...x, resolved: action, reply, read: true } : x)) })
          if (action === 'decline') return mark(s, '제안을 거절했습니다.')
          if (action === 'counter') {
            // 더 달라고 하기: 상대 최대 금액 안이면 희망 가격에 합의, 넘으면 한 번은 중간 금액으로 '최종 제안', 그 뒤엔 협상 결렬
            const o = item.offer
            // 직접 적은 금액이 있으면 그 금액, 없으면 희망 가격(또는 제안의 1.1배)
            const want = amount ? Math.round(amount * 10) / 10 : Math.max(o.ask ?? o.fee * 1.15, Math.round(o.fee * 1.1 * 10) / 10)
            const club = teamsById[o.teamId]?.name || '상대 구단'
            const pName = teamsById[s.teamId]?.players.find((x) => x.id === o.playerId)?.name || '선수'
            const acts = (fee, last) => [['accept', '✅ 수락', `${eur(fee)}에 판매합니다`], ...(last ? [] : [['counter', '↗️ 한 번 더 요구', '더 올려 달라고 합니다']]), ['decline', '❌ 거절', '제안을 거절합니다']]
            let follow
            if (want <= o.fee) follow = news(s.round, 'offer', `🤝 ${club}: ${pName} ${eur(o.fee)}에 합의`, `요구한 금액이 이미 제안보다 낮아, 제안 금액 ${eur(o.fee)} 그대로 판매할 수 있습니다.`, { offer: { ...o, tries: (o.tries || 0) + 1 }, actions: acts(o.fee, true) })
            else if (want <= o.cap) follow = news(s.round, 'offer', `🤝 ${club}: ${pName} ${eur(want)}에 합의`, `${club}이(가) 요구를 받아들였습니다. ${eur(want)}에 판매할 수 있습니다.`, { offer: { ...o, fee: want, tries: (o.tries || 0) + 1 }, actions: acts(want, true) })
            else if (want > o.cap * 1.6) follow = news(s.round, 'offer', `🚪 ${club}: 협상 결렬`, `"${eur(want)}이라니요. 말이 안 되는 금액입니다." ${club}이(가) 협상을 접었습니다.`)
            else if ((o.tries || 0) < 2) { const mid = Math.round(Math.min(o.cap, (o.fee + o.cap) / 2 + (o.tries || 0) * (o.cap - o.fee) / 4) * 10) / 10; follow = news(s.round, 'offer', `📈 ${club}의 수정 제안: ${pName} ${eur(mid)}`, `"${eur(want)}은 무리입니다. ${eur(mid)}이 우리 최종 제안입니다."`, { offer: { ...o, fee: mid, tries: (o.tries || 0) + 1 }, actions: acts(mid, (o.tries || 0) >= 1) }) }
            else follow = news(s.round, 'offer', `🚪 ${club}: 협상 결렬`, `${club}이(가) 더 이상 금액을 올릴 수 없다며 협상을 접었습니다.`)
            return { ...mark(s, `${eur(want)}을 요구했습니다.`), inbox: [follow, ...mark(s, `${eur(want)}을 요구했습니다.`).inbox] }
          }
          const { teamId, playerId, fee } = item.offer
          if (!playerId || !teamsById[s.teamId]?.players.some((p) => p.id === playerId)) return mark(s, '이미 선수 구성이 바뀌어 제안이 무효가 됐습니다.')
          if (s.loans?.[playerId]?.dir === 'in') return mark(s, '임대 온 선수라 팔 수 없습니다.')
          if (!windowState(s.round, data.schedule.length).open) return mark(s, '이적 시장이 닫혀 진행할 수 없습니다.')
          const p = teamsById[s.teamId].players.find((x) => x.id === playerId)
          const lid = item.offer.lid
          // 다른 리그 구단에 팔면: 내 명단에서 빼고, 그 구단 명단에 들어간 것으로 기록 (대항전 등에서 보인다)
          const moved = lid && lid !== data.leagueId
            ? (() => {
                const rosters = s.rosters || Object.fromEntries(teams.map((t) => [t.id, t.players.map((x) => x.id)]))
                const gone = { ...(s.gone || {}) }
                delete gone[playerId]
                return { ...s, rosters: { ...rosters, [s.teamId]: rosters[s.teamId].filter((id) => id !== playerId) }, lineup: s.lineup.map((id) => (id === playerId ? null : id)), forSale: (s.forSale || []).filter((id) => id !== playerId), gone, abroad: { ...(s.abroad || {}), [playerId]: { lid, teamId, player: { ...p } } } }
              })()
            : executeTransfer(s, teams, s.teamId, teamId, playerId)
          const sold = mark({ ...moved, finance: book(moved.finance, fee, '이적료 수입'), tradeLog: [...(s.tradeLog || []), { round: s.round, out: playerId, to: teamId, fee }] }, `${p.name}을(를) ${eur(fee)}에 팔았습니다.`)
          // 같은 선수에게 온 다른 구단 제안은 자동으로 취소 (이미 팔린 선수)
          return { ...sold, inbox: sold.inbox.map((x) => (x.id !== id && x.offer?.playerId === playerId && !x.resolved ? { ...x, resolved: 'void', reply: `${p.name}이(가) 다른 구단으로 이적해 이 제안은 취소됐습니다.`, read: true } : x)) }
        })
      },
      /** 구단주 결정 실행 → { title, text, good } */
      ownerDecide(key) {
        const r = decide(save, key, { team: myTeam, leagueId: data.leagueId })
        setSave(r.save)
        return r
      },
      setTicket(pct) { setSave((s) => ({ ...s, finance: { ...s.finance, ticketPct: pct } })) },
      setWageRatio(ratio) { setSave((s) => ({ ...s, finance: { ...s.finance, wageRatio: ratio } })) },
      contractOf: (p) => contractOf(save, p, data?.leagueId),
      wageFor: (p) => wageFor(p, data?.leagueId),
      /** 영입 요구 연봉: 우리 구단 기준과 지금 구단 연봉 중 큰 쪽 + 15% */
      askWage: (p, team, lid = data?.leagueId) => Math.round(Math.max(wageFor(p, data?.leagueId), wageFor(p, lid, clubKOf(team, lid))) * 1.15 * 10) / 10,
      /** 지금 몸값 (폼·공격 포인트·남은 계약 반영) */
      valueFor: (p) => valueOf(p, status[p.id], valueCtx(save, p, data?.leagueId)),
      renewalAsk: (p) => renewalAsk(save, p, data?.leagueId, status[p.id]),
      /** 재계약 */
      renew(p, years, wage) {
        const billNow = wageBill(save, myTeam, data.leagueId)
        const old = contractOf(save, p, data.leagueId).wage
        if (wage > old && billNow - old + wage > wageBudget(save.finance)) return { ok: false, reason: `임금 예산 초과: 재계약하면 연봉 총액 ${eur(billNow - old + wage)} > 예산 ${eur(wageBudget(save.finance))}` }
        setSave((s) => {
          const st = { ...(s.status?.[p.id] || {}), morale: Math.min(100, (s.status?.[p.id]?.morale ?? 60) + 6), contractAsked: false }
          const kept = checkPromises(p, st, { round: s.round, sum: null, fitOk: false, renewed: true, sold: false, wage }) // 재계약 약속을 지켰는지
          return {
            ...s,
            contracts: { ...s.contracts, [p.id]: { until: (s.seasonNo || 1) + years, wage, renewed: true } }, // 재계약한 연봉은 협상 값 (실제 보도 연봉으로 덮지 않는다)
            status: { ...s.status, [p.id]: st },
            inbox: [...kept, news(s.round, 'contract', `✍️ ${p.name} 재계약`, `${years}년 연장, 연봉 ${eur(wage)}.`), ...(s.inbox || [])],
          }
        })
        return { ok: true }
      },
      releaseCost: (p) => releaseCost(save, p, data?.leagueId),
      /** 방출: 위약금을 내고 FA로 내보낸다 */
      release(p) {
        const cost = releaseCost(save, p, data.leagueId)
        setSave((s) => {
          const rosters = s.rosters || Object.fromEntries(teams.map((t) => [t.id, t.players.map((x) => x.id)]))
          return {
            ...s,
            rosters: { ...rosters, [s.teamId]: rosters[s.teamId].filter((id) => id !== p.id) },
            lineup: s.lineup.map((id) => (id === p.id ? null : id)),
            finance: book(s.finance, -cost, '방출 위약금'),
            released: [...(s.released || []), { ...p, from: s.teamId }],
            fans: Math.max(0, (s.fans ?? 60) - (playerOvr(p) >= 80 ? 4 : 0)),
            inbox: [news(s.round, 'contract', `🚪 ${p.name} 방출`, `위약금 ${eur(cost)}을 내고 계약을 해지했습니다.`), ...(s.inbox || [])],
          }
        })
      },
      /** 강제 매각: 감독·선수 의사와 상관없이 AI 구단에 즉시 판다 (가치의 60~120%) */
      forceSell(p) {
        const others = teams.filter((t) => t.id !== save.teamId)
        const buyer = others.sort((a, b) => a.players.filter((x) => x.pos === p.pos).length - b.players.filter((x) => x.pos === p.pos).length)[0]
        const k = 0.75 + ((p.id.length * 7 + save.round * 13) % 26) / 100 // 급매: 몸값의 75~100%
        const fee = Math.round(valueOf(p, status[p.id], valueCtx(save, p, data.leagueId)) * k * 10) / 10
        const star = [...myTeam.players].sort((a, b) => playerOvr(b) - playerOvr(a)).slice(0, 3).some((x) => x.id === p.id)
        setSave((s) => {
          const rosters = s.rosters || Object.fromEntries(teams.map((t) => [t.id, t.players.map((x) => x.id)]))
          return {
            ...s,
            rosters: { ...rosters, [s.teamId]: rosters[s.teamId].filter((id) => id !== p.id), [buyer.id]: [...rosters[buyer.id], p.id] },
            lineup: s.lineup.map((id) => (id === p.id ? null : id)),
            finance: book(s.finance, fee, '이적료 수입'),
            fans: Math.max(0, (s.fans ?? 60) - (star ? 10 : 2)),
            inbox: [news(s.round, 'trade', `💸 ${p.name} 강제 매각`, `${buyer.name}에 ${eur(fee)}을 받고 팔았습니다.${star ? ' 핵심 선수를 판 구단주에게 팬들이 분노합니다. (민심 -10)' : ''}`), ...(s.inbox || [])],
          }
        })
        return { buyer: buyer.name, fee }
      },
      /** FA 제안 전 미리보기: 임금 체계·주급 총액 영향 */
      faPreview(p, wage) { return myTeam && data ? wageShock(save, myTeam, data.leagueId, p, wage) : null },
      /** FA 영입 제안 */
      offerFA(p, years, offerWage) {
        if (teams.some((t) => t.players.some((x) => x.id === p.id))) return { ok: false, reason: '이미 구단에 소속된 선수입니다.' }
        const size = myTeam.players.length
        if (size >= ROSTER_MAX) return { ok: false, reason: `로스터가 가득 찼습니다 (${ROSTER_MAX}명). 먼저 방출하세요.` }
        const top = myTeam.players.map(playerOvr).sort((a, b) => b - a).slice(0, 11)
        const d = faDecision(p, { offerWage, years, leagueId: data.leagueId, clubOvr: top.reduce((a, b) => a + b, 0) / top.length })
        if (!d.ok) return d
        const fee = Math.round(offerWage * 0.5 * 10) / 10 // 계약금
        if (save.finance?.ban === (save.seasonNo || 1)) return { ok: false, reason: 'FFP 위반 징계로 이번 시즌에는 선수를 영입할 수 없습니다.' }
        const billNow = wageBill(save, myTeam, data.leagueId)
        if (billNow + offerWage > wageBudget(save.finance)) return { ok: false, reason: `임금 예산 초과: 연봉 총액 ${eur(billNow + offerWage)} > 예산 ${eur(wageBudget(save.finance))}. 구단 운영에서 임금 예산을 늘리거나 선수를 정리하세요.` }
        if ((save.finance?.cash ?? 0) < fee) return { ok: false, reason: `계약금 ${eur(fee)}을 낼 현금이 없습니다 (보유 ${eur(save.finance?.cash ?? 0)}).` }
        const shock = wageShock(save, myTeam, data.leagueId, p, offerWage)
        const roll = (k) => (hashStr(`${p.id}-${k}-${save.round}`) % 100) / 100
        setSave((s) => {
          const rosters = s.rosters || Object.fromEntries(teams.map((t) => [t.id, t.players.map((x) => x.id)]))
          if (Object.values(rosters).some((ids) => ids.includes(p.id))) return s // 연속 클릭으로 두 번 들어오는 것 방지
          const used = new Set(myTeam.players.map((x) => x.number))
          const number = Array.from({ length: 98 }, (_, i) => i + 2).find((n) => !used.has(n))
          const signedP = { ...p, number, from: undefined }
          return {
            ...s,
            signed: [...(s.signed || []).filter((x) => x.id !== p.id), signedP],
            released: (s.released || []).filter((x) => x.id !== p.id),
            rosters: { ...rosters, [s.teamId]: [...rosters[s.teamId].filter((id) => id !== p.id), p.id] },
            contracts: { ...s.contracts, [p.id]: { until: (s.seasonNo || 1) + years - 1, wage: offerWage } },
            finance: book(s.finance, -fee, 'FA 계약금'),
            status: { ...s.status, [p.id]: { morale: 72, cond: 100 } },
            fans: Math.min(100, (s.fans ?? 60) + (playerOvr(p) >= 75 ? 3 : 1)),
            inbox: [news(s.round, 'trade', `✍️ FA 영입: ${p.name}`, `${years}년 계약, 연봉 ${eur(offerWage)}, 계약금 ${eur(fee)}.`), ...(s.inbox || [])],
          }
        })
        // 후폭풍: 임금 체계 붕괴(더 잘하는데 덜 받는 선수들 반발) · 과다 지출 비판
        const fallout = []
        if (shock.jealous.length) {
          const angry = [...shock.jealous].sort((a, b) => playerOvr(b) - playerOvr(a))
          const leaver = angry[0] && roll('out') < 0.35 ? angry[0] : null
          setSave((s) => {
            const st = { ...s.status }
            for (const x of angry) st[x.id] = { morale: 60, cond: 100, ...(st[x.id] || {}), morale: Math.max(0, (st[x.id]?.morale ?? 60) - 12) }
            if (leaver) st[leaver.id] = { ...st[leaver.id], wantsOut: true }
            const names = angry.slice(0, 3).map((x) => x.name).join('·')
            const item = news(s.round, 'talk', '😤 임금 체계 붕괴', `${p.name}이(가) ${eur(offerWage)}을 받는다는 소식에 ${names}${angry.length > 3 ? ` 등 ${angry.length}명` : ''}이(가) "우리가 더 잘하는데 왜 덜 받냐"며 반발합니다. (사기 -12)${leaver ? ` ${leaver.name}은(는) 결국 이적을 요청했습니다.` : ''}`)
            return { ...s, status: st, inbox: [item, ...(s.inbox || [])] }
          })
          fallout.push(`기존 선수 ${angry.length}명이 반발합니다 (사기 -12)${leaver ? ` · ${leaver.name} 이적 요청` : ''}`)
        }
        if (shock.overpay >= 1.6) {
          setSave((s) => ({ ...s, fans: Math.max(0, (s.fans ?? 60) - 5), inbox: [news(s.round, 'owner', '📰 "돈을 길바닥에 뿌린다"', `언론이 ${p.name}에게 요구액의 ${Math.round(shock.overpay * 100)}%를 준 계약을 맹비난합니다. (민심 -5)`), ...(s.inbox || [])] }))
          fallout.push('과다 지출 비판 (민심 -5)')
        }
        if (shock.newBill > shock.income) fallout.push(`주급 총액 ${eur(shock.newBill)}이 시즌 수입 ${eur(shock.income)}을 넘어 매 경기 적자가 납니다`)
        return { ...d, fee, fallout }
      },
      /** 직접 입력한 말로 면담 → 반응 결과 (itemId: 편지함 면담 요청에 대한 답) */
      sayTo(playerId, text, itemId = null) {
        const player = myTeam?.players.find((p) => p.id === playerId)
        if (!player || !text.trim()) return null
        const r = customTalk(save, player, text.trim(), itemId)
        if (r.blocked) return { blocked: r.blocked }
        setSave(r.save)
        return r.result
      },
      /** 배틀식 면담 결과 반영 (itemId: 편지함 면담 요청) */
      /** 면담 요청을 지금은 받지 않기: 기록으로 남고 사기 −4 (나중에 선수 상세에서 따로 면담할 수 있다) */
      ignoreTalk(itemId) {
        setSave((s) => {
          const m = (s.inbox || []).find((x) => x.id === itemId)
          if (!m || m.resolved) return s
          const st = { ...(s.status || {}) }
          if (m.playerId) st[m.playerId] = { ...(st[m.playerId] || {}), morale: Math.max(0, (st[m.playerId]?.morale ?? 60) - 4) }
          return { ...s, status: st, inbox: s.inbox.map((x) => (x.id === itemId ? { ...x, resolved: 'ignored', read: true, ignoredAt: s.round, ignoredByChoice: true } : x)) }
        })
      },
      /** 약속 추가 (연봉 협상의 '활약 시 인상' 등) */
      addPromise(playerId, pr) {
        setSave((s) => ({ ...s, status: { ...s.status, [playerId]: { ...(s.status?.[playerId] || {}), promises: [...(s.status?.[playerId]?.promises || []).filter((x) => x.kind !== pr.kind), pr] } } }))
      },
      finishTalk(playerId, result, itemId = null) {
        const player = myTeam?.players.find((p) => p.id === playerId)
        if (!player) return
        setSave((s) => applyTalkResult(s, player, result, itemId).save)
      },
      /** 개별 면담 → 반응 문구를 돌려준다 */
      talkTo(playerId, kind) {
        const r = playerTalk(save, playerId, kind)
        setSave(r.save)
        return r.text
      },
      /** 리그·시즌 변경 — 진행 중인 시즌 기록은 초기화된다 */
      chooseSeason(league, season) {
        setSave({ ...EMPTY_SAVE, league, season })
      },
      resetSeason() {
        setSave((s) => ({ ...s, round: 0, results: [], status: {}, pstats: {}, inbox: [] }))
      },
      quitTeam() {
        setSave((s) => ({ ...EMPTY_SAVE, league: s.league, season: s.season }))
      },
      /** 내 경기 요약을 넣고 라운드 마무리 (다른 경기는 여기서 시뮬레이션) */
      finishRound(mine) {
        const done = (x) => ({ ...x, lastMatchKey: mine.key || x.lastMatchKey, liveMatch: null })
        if (nextFixture?.cup) {
          // 대항전 경기: 대회 결과 반영 + 내 선수 상태 (리그 라운드는 그대로)
          const md = cupMd
          setSave((s) => {
            if (mine.key && s.lastMatchKey === mine.key) return s // 이미 저장한 경기
            const r = playMatchday(s.cups[cupIdx], md, allTeams, engineStatus(s, Object.values(allTeams)), { home: nextFixture.home, away: nextFixture.away, summary: mine.summary }, seasonNo)
            const mineIdx = nextFixture.isHome ? 0 : 1
            const opp = mineIdx === 0 ? nextFixture.awayTeam : nextFixture.homeTeam
            const after = applyCupMatch({ ...s, cups: s.cups.map((c, i) => (i === cupIdx ? r.cup : c)) }, { myTeam, mineIdx, summary: mine.summary, label: `${cup.name} ${md.label}`, oppName: opp.name })
            const [gf, ga] = mineIdx === 0 ? mine.summary.score : [...mine.summary.score].reverse()
            const money = settleMatch(after, { team: myTeam, leagueId: data.leagueId, home: nextFixture.isHome, result: Math.sign(gf - ga), totalRounds: data.schedule.length, cupStage: md.stage, cupPay: comp.pay })
            return done(afterMatchOwner({ ...after, ...money }, Math.sign(gf - ga)))
          })
          return
        }
        setSave((s) => {
          if (mine.key && s.lastMatchKey === mine.key) return s // 이미 저장한 경기 (두 번 눌러도 한 번만)
          const next = applyRound(s, { teamsById, schedule: data.schedule, myTeamId: s.teamId, mine, buyers: worldTeams })
          const mineIdx = mine.home === s.teamId ? 0 : 1
          const [gf, ga] = mineIdx === 0 ? mine.summary.score : [...mine.summary.score].reverse()
          const money = settleMatch(next, { team: myTeam, leagueId: data.leagueId, home: mineIdx === 0, result: Math.sign(gf - ga), totalRounds: data.schedule.length })
          const owned = afterMatchOwner({ ...next, ...money }, Math.sign(gf - ga))
          const b = checkBankruptcy(owned, data.leagueId)
          if (b.bankrupt) return { ...EMPTY_SAVE, league: s.league, season: s.season, sacked: { team: s.teamId, history: s.history, bankrupt: true, cash: b.save.finance.cash } }
          return done(b.save)
        })
      },
    }
  }, [data, error, save, manager, cupTeams, world, fx, stadiums])

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

export function useGame() {
  return useContext(GameContext)
}
