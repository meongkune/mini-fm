// 이적료 이적: 선수 가치 평가, 상대 구단 AI의 수락·역제안·거절, 이적 실행, 내 선수에게 들어오는 제안
import { playerOvrOf } from '../engine/engine.js'
import { news } from './season.js'
import { contractOf, yearsLeft } from './finance.js'

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
export const MIN_SQUAD = { GK: 2, DF: 6, MF: 6, FW: 3 }
export const MAX_SQUAD = 30
export const PATIENCE = 3 // 같은 선수를 두고 협상할 수 있는 횟수 (이적 시장마다)

/** 숨겨진 잠재력(PA): 선수 ID로 정해지는 고정 값. 어릴수록 폭이 크다 */
export function potentialOf(p) {
  if (p.pa) return p.pa // 유스 선수·지난 시즌에 고정된 값
  const ovr = playerOvrOf(p)
  const r = (hash(`pa-${p.id}`) % 1000) / 1000
  const [lo, hi] = p.age <= 19 ? [6, 20] : p.age <= 21 ? [4, 14] : p.age <= 23 ? [2, 9] : p.age <= 26 ? [0, 4] : [0, 0]
  return Math.min(95, ovr + Math.round(lo + (hi - lo) * r))
}

/** 스카우트 평가: 잠재력을 별 1~5개로 (정확한 값은 숨김) */
export function potentialStars(p) {
  const pa = potentialOf(p)
  return pa >= 88 ? 5 : pa >= 83 ? 4 : pa >= 78 ? 3 : pa >= 72 ? 2 : 1
}

// 나이별 보정 (능력치 계산 tools/sportsapi_ratings.mjs와 같은 표): 어린 선수는 잠재력 몫이 몸값에 붙고, 베테랑은 낮게 매겨진다
const AGE_ADJ = (age) => (age <= 20 ? -4 : age <= 21 ? -3 : age <= 23 ? -1.5 : age <= 29 ? 0 : age <= 31 ? 2 : age <= 33 ? 4 : 6)

/**
 * 선수 몸값 (€M). 능력치를 실제 시장가치에서 계산했으므로 그 식을 거꾸로 풀면 실제 시세에 가까운 값이 된다.
 *   OVR 88 · 25세 ≈ €100M, 78 ≈ €10M, 68 ≈ €1M (골키퍼는 같은 OVR이면 더 싸다)
 * 그 위에 시즌 중 변하는 요소: 최근 폼(평균 평점) · 공격 포인트 · 남은 계약 기간 · 이적 요청 · 부상
 * ctx = { yearsLeft, apps, g, a } (없으면 해당 보정 없음)
 */
export function valueOf(p, st = {}, ctx = {}) {
  const ovr = playerOvrOf(p)
  let v = 0.1 * Math.pow(10, (ovr - 58 - AGE_ADJ(p.age) - (p.pos === 'GK' ? 3 : 0)) / 10)
  if (p.age <= 23) v *= 1 + Math.max(0, potentialOf(p) - ovr) * 0.02 // 스카우트가 보는 성장 여지
  if ((st.fr?.length || 0) >= 3) v *= 1 + Math.max(-0.2, Math.min(0.3, ((st.form ?? 6.6) - 6.6) * 0.25)) // 최근 폼
  if (ctx.apps >= 5 && p.pos !== 'GK' && p.pos !== 'DF') v *= 1 + Math.min(0.25, ((ctx.g || 0) + (ctx.a || 0) * 0.6) / ctx.apps * 0.35) // 공격 포인트
  if (ctx.yearsLeft === 1) v *= 0.65 // 계약 1년 남으면 헐값 (곧 FA)
  else if (ctx.yearsLeft === 2) v *= 0.85
  if (st.wantsOut) v *= 0.8
  if (st.inj > 0) v *= 0.85
  return Math.max(0.2, Math.round(v * 10) / 10)
}

/** 몸값 계산에 쓰는 시즌 정보 (남은 계약·출전·공격 포인트) */
export function valueCtx(save, p, leagueId) {
  const c = contractOf(save, p, leagueId)
  const ps = save.pstats?.[p.id] || {}
  return { yearsLeft: yearsLeft(save, c), apps: ps.apps || 0, g: ps.g || 0, a: ps.a || 0 }
}
export const money = (v) => (v >= 100 ? `€${Math.round(v)}M` : `€${v.toFixed(1)}M`)

/** 이적 시장이 열리는 라운드: 시즌 초반 4라운드, 중반 4라운드 */
export function windowState(round, totalRounds) {
  const mid = Math.floor(totalRounds / 2)
  const open = round <= 3 || (round >= mid - 2 && round <= mid + 1)
  const next = round < mid - 2 ? mid - 2 : null
  return { open, label: open ? (round <= 3 ? '여름 이적 시장' : '겨울 이적 시장') : '이적 시장 닫힘', next }
}

const countPos = (players) => players.reduce((c, p) => ({ ...c, [p.pos]: (c[p.pos] || 0) + 1 }), {})
export function squadProblem(players) {
  const c = countPos(players)
  for (const [pos, n] of Object.entries(MIN_SQUAD)) if ((c[pos] || 0) < n) return `${pos} 인원이 ${n}명 아래로 줄어듭니다`
  if (players.length > MAX_SQUAD) return `선수단이 ${MAX_SQUAD}명을 넘습니다`
  return null
}

/** 이 구단에서 핵심 선수(OVR 상위 3명)인지 */
const isCore = (team, id) => [...team.players].sort((a, b) => playerOvrOf(b) - playerOvrOf(a)).slice(0, 3).some((p) => p.id === id)

/**
 * 영입 제안(이적료)에 대한 상대 구단 AI의 판단
 * @returns { verdict: 'accept'|'counter'|'reject', reason, ask?(역제안 금액), need }
 */
export function evaluateBid({ theirs, player, fee, status = {}, value = null }) {
  const after = theirs.players.filter((p) => p.id !== player.id)
  const prob = squadProblem(after)
  if (prob) return { verdict: 'reject', reason: `"그 선수를 팔면 우리 팀 ${prob}. 팔 수 없습니다."` }
  const core = isCore(theirs, player.id)
  const need = Math.round((value ?? valueOf(player, status[player.id])) * (core ? 1.4 : 1.1) * 10) / 10
  if (fee >= need) return { verdict: 'accept', reason: `"좋습니다. ${money(fee)}이면 보내드리죠."`, need }
  if (fee >= need * 0.75) return { verdict: 'counter', ask: need, reason: `"${money(need)}은 받아야 합니다.${core ? ' 우리 팀 핵심 선수입니다.' : ''}"`, need }
  return { verdict: 'reject', reason: `"${money(fee)}은 말도 안 되는 금액입니다.${core ? ' 핵심 선수는 쉽게 내주지 않습니다.' : ''}"`, need }
}

/** 이적 실행: fromId 구단의 선수를 toId 구단으로 (save.rosters에 기록). contract는 내 팀으로 올 때만 */
export function executeTransfer(save, teams, fromId, toId, playerId, { contract = null } = {}) {
  const rosters = { ...(save.rosters || Object.fromEntries(teams.map((t) => [t.id, t.players.map((p) => p.id)]))) }
  for (const t of teams) if (!rosters[t.id]) rosters[t.id] = t.players.map((p) => p.id)
  rosters[fromId] = rosters[fromId].filter((id) => id !== playerId)
  rosters[toId] = [...rosters[toId].filter((id) => id !== playerId), playerId]
  const status = { ...(save.status || {}) }
  const s = { ...(status[playerId] || {}), morale: toId === save.teamId ? 74 : 60, benched: 0 }
  delete s.wantsOut; delete s.promise; delete s.complained; delete s.promises
  status[playerId] = s
  return {
    ...save,
    rosters,
    status,
    contracts: contract ? { ...(save.contracts || {}), [playerId]: contract } : save.contracts,
    lineup: save.lineup.map((id) => (id === playerId && fromId === save.teamId ? null : id)),
    forSale: (save.forSale || []).filter((id) => id !== playerId),
  }
}

/** 내 선수에게 다른 구단이 이적료를 제안 (판매 목록에 올렸거나 이적을 요청한 선수) */
export function aiBidFor(save, teams, myTeamId, playerId, round, leagueId = save.league) {
  const mine = teams.find((t) => t.id === myTeamId)
  const p = mine?.players.find((x) => x.id === playerId)
  if (!p) return null
  const v = valueOf(p, save.status?.[p.id], valueCtx(save, p, leagueId))
  const others = teams.filter((t) => t.id !== myTeamId)
  const team = others[hash(`${p.id}-${round}`) % others.length]
  const k = 0.8 + (hash(`bid-${p.id}-${round}`) % 40) / 100 // 가치의 80~120%
  const fee = Math.round(v * k * 10) / 10
  return news(round, 'offer', `💰 ${team.name}의 영입 제안: ${p.name}`, `${team.name}이(가) ${p.name}(${p.pos}, OVR ${playerOvrOf(p)}, ${p.age}세) 영입을 위해 ${money(fee)}을 제시했습니다. (선수 가치 ${money(v)})`, {
    offer: { teamId: team.id, playerId: p.id, fee },
    actions: [['accept', '✅ 수락', `${money(fee)}에 판매합니다`], ['decline', '❌ 거절', '제안을 거절합니다']],
  })
}
