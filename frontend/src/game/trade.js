// 이적료 이적: 선수 가치 평가, 상대 구단 AI의 수락·역제안·거절, 이적 실행, 내 선수에게 들어오는 제안
import { eur } from './finance.js'
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
  if (ctx.mom) v *= 1 + Math.min(0.15, ctx.mom * 0.03) // 경기 최우수 선수(MOM) 횟수
  if (ctx.yearsLeft === 1) v *= 0.75 // 계약 1년 남으면 싸진다 (곧 FA)
  else if (ctx.yearsLeft === 2) v *= 0.9
  if (st.wantsOut) v *= 0.85
  if (st.inj > 0) v *= 0.85
  return Math.max(0.2, Math.round(v * 10) / 10)
}

/** 몸값 계산에 쓰는 시즌 정보 (남은 계약·출전·공격 포인트) */
export function valueCtx(save, p, leagueId) {
  const c = contractOf(save, p, leagueId)
  const ps = save.pstats?.[p.id] || {}
  return { yearsLeft: yearsLeft(save, c), apps: ps.apps || 0, g: ps.g || 0, a: ps.a || 0, mom: ps.mom || 0 }
}
export const money = (v) => eur(v) // 통화 설정(유로·원화)을 따른다

/** 이적 시장이 열리는 라운드: 시즌 초반 4라운드, 중반 4라운드 */
export function windowState(round, totalRounds) {
  const mid = Math.floor(totalRounds / 2)
  const open = round <= 3 || (round >= mid - 2 && round <= mid + 1)
  const next = round < mid - 2 ? mid - 2 : null
  return { open, label: open ? (round <= 3 ? '여름 이적 시장' : '겨울 이적 시장') : '이적 시장 닫힘', next }
}

const countPos = (players) => players.reduce((c, p) => ({ ...c, [p.pos]: (c[p.pos] || 0) + 1 }), {})
export function squadProblem(players, { minOnly = false } = {}) {
  const c = countPos(players)
  for (const [pos, n] of Object.entries(MIN_SQUAD)) if ((c[pos] || 0) < n) return `${pos} 인원이 ${n}명 아래로 줄어듭니다`
  if (!minOnly && players.length > MAX_SQUAD) return `선수단이 ${MAX_SQUAD}명을 넘습니다`
  return null
}

/** 이 구단에서 핵심 선수(OVR 상위 3명)인지 */
const isCore = (team, id) => [...team.players].sort((a, b) => playerOvrOf(b) - playerOvrOf(a)).slice(0, 3).some((p) => p.id === id)

/**
 * 영입 제안(이적료)에 대한 상대 구단 AI의 판단
 * @returns { verdict: 'accept'|'counter'|'reject', reason, ask?(역제안 금액), need }
 */
/**
 * 상대 구단의 판단: 선수 역할(핵심·주전·후보)·나이에 따라 원하는 금액이 다르고, 협상을 거듭하면 조금씩 양보한다
 *   핵심(팀 상위 3명) 가치의 130% · 주전 105% · 후보(팀 상위 18명 밖) 90% · 30세 이상은 10% 덜
 *   협상 1회마다 4%씩 내려준다 (단 가치의 85% 밑으로는 안 내려감)
 *   제시액이 원하는 금액의 65% 이상이면 역제안 (원하는 금액과 제시액 사이), 그 밑이면 거절
 */
export function evaluateBid({ theirs, player, fee, status = {}, value = null, tries = 0, swap = null, talk = 0 }) {
  const after = [...theirs.players.filter((p) => p.id !== player.id), ...(swap?.player ? [swap.player] : [])]
  const prob = squadProblem(after, { minOnly: true }) // 파는 쪽은 최소 인원만 본다 (K리그처럼 명단이 40명 넘는 구단도 있다)
  if (prob) return { verdict: 'reject', reason: `"그 선수를 팔면 우리 팀 ${prob}. 팔 수 없습니다."` }
  const v = value ?? valueOf(player, status[player.id])
  const core = isCore(theirs, player.id)
  const rank = [...theirs.players].sort((a, b) => playerOvrOf(b) - playerOvrOf(a)).findIndex((p) => p.id === player.id)
  const role = core ? 1.3 : rank < 18 ? 1.05 : 0.9
  const age = player.age >= 30 ? 0.9 : 1
  // talk: 단장과의 대화로 얻어 낸 양보(0~0.08) — 협상 횟수 양보와 합쳐도 가치의 80% 밑으로는 안 내려간다
  const need = Math.round(v * Math.max(0.8, Math.max(0.85, role * age - tries * 0.04) - talk) * 10) / 10
  const why = core ? ' 우리 팀 핵심 선수입니다.' : rank >= 18 ? ' 출전 기회가 적은 선수라 조건만 맞으면 보내겠습니다.' : ''
  // 선수를 끼워 넣으면: 그 선수 값어치(상대 눈으로 본)만큼 현금을 덜 내도 된다
  const credit = swap?.credit || 0
  const total = fee + credit
  const plus = swap?.player ? ` (${swap.player.name} 포함 — 우리 쪽 평가 ${money(credit)}: ${swap.note})` : ''
  if (total >= need) return { verdict: 'accept', reason: `"좋습니다. 현금 ${money(fee)}${plus}이면 보내드리죠."`, need, credit }
  if (total >= need * 0.65) {
    const ask = Math.round(Math.max(need * 0.97, (total + need) / 2) * 10) / 10
    const cash = Math.max(0, Math.round((ask - credit) * 10) / 10)
    return { verdict: 'counter', ask: cash, reason: `"현금 ${money(cash)}${plus}이면 생각해 보겠습니다.${why}"`, need, credit }
  }
  return { verdict: 'reject', reason: `"현금 ${money(fee)}${plus}은 너무 낮습니다.${core ? ' 핵심 선수는 쉽게 내주지 않습니다.' : ''}"`, need, credit }
}

const POS_NAME = { GK: '골키퍼', DF: '수비수', MF: '미드필더', FW: '공격수' }
const POS_NEED = { GK: 3, DF: 8, MF: 8, FW: 5 }
/**
 * 선수+현금 거래: 내가 끼워 넣는 선수를 상대 구단이 얼마로 쳐주는지
 *   그 포지션이 모자라면 가치의 90%, 적당하면 75%, 넘치면 60%
 *   상대 주전(상위 11명) 수준이면 +10%p, 한참 못 미치면(8 이상 낮음) 절반, 31세 이상은 15% 덜
 */
export function swapCredit(theirs, mine, value) {
  if (!mine) return null
  const same = theirs.players.filter((p) => p.pos === mine.pos).length
  const need = POS_NEED[mine.pos] || 6
  let k = same < need ? 0.9 : same <= need + 1 ? 0.75 : 0.6
  const ovrs = theirs.players.map(playerOvrOf).sort((a, b) => b - a)
  const line = ovrs[Math.min(10, ovrs.length - 1)] ?? 70 // 주전 11번째 선수 능력
  const gap = playerOvrOf(mine) - line
  let note = same < need ? `${POS_NAME[mine.pos]}가 부족해 쓸모가 있습니다` : same <= need + 1 ? `${POS_NAME[mine.pos]} 자리는 쓸 만큼은 있습니다` : `${POS_NAME[mine.pos]}는 이미 넘칩니다`
  if (gap >= 0) { k += 0.1; note += ' · 바로 주전급' }
  else if (gap < -8) { k *= 0.5; note += ' · 우리 주전 수준에 못 미칩니다' }
  if (mine.age >= 31) { k *= 0.85; note += ' · 나이가 많습니다' }
  return { player: mine, credit: Math.round(value * k * 10) / 10, note }
}

/**
 * 임대 영입 제안에 대한 상대 구단 판단
 *   핵심(상위 3명)·주전(상위 11명, 24세 이상)은 임대 불가 → 완전 이적만
 *   임대료 기준: 가치의 8% × (어린 선수 0.6 · 후보 0.8 · 주전 경계 1.2) × 연봉 부담이 적을수록 더 요구 (share: 우리가 내는 연봉 비율 0.5~1)
 */
export function evaluateLoan({ theirs, player, fee, share = 1, value, tries = 0 }) {
  const after = theirs.players.filter((p) => p.id !== player.id)
  const prob = squadProblem(after, { minOnly: true })
  if (prob) return { verdict: 'reject', reason: `"그 선수를 보내면 우리 팀 ${prob}. 임대도 어렵습니다."` }
  const rank = [...theirs.players].sort((a, b) => playerOvrOf(b) - playerOvrOf(a)).findIndex((p) => p.id === player.id)
  if (rank < 3) return { verdict: 'reject', reason: '"핵심 선수는 임대 보내지 않습니다."' }
  if (rank < 11 && player.age >= 24) return { verdict: 'reject', reason: '"주전 선수라 임대는 안 됩니다. 완전 이적이라면 이야기해 보죠."' }
  const young = player.age <= 22
  const k = (young ? 0.6 : 1) * (rank >= 18 ? 0.8 : 1.2) * (1 + (1 - share) * 2.5)
  const need = Math.round(Math.max(0.1, value * 0.08 * k * Math.max(0.8, 1 - tries * 0.05)) * 10) / 10
  const why = young ? ' 꾸준히 뛰게 해 주는 게 조건입니다.' : rank >= 18 ? ' 우리 팀에서는 기회가 적으니 보내 줄 수 있습니다.' : ''
  if (fee >= need) return { verdict: 'accept', reason: `"좋습니다. 임대료 ${money(fee)}, 연봉 ${Math.round(share * 100)}% 부담이면 시즌 끝까지 보내 드리죠.${why}"`, need }
  if (fee >= need * 0.6) {
    const ask = Math.round(Math.max(need * 0.97, (fee + need) / 2) * 10) / 10
    return { verdict: 'counter', ask, reason: `"연봉 ${Math.round(share * 100)}% 부담이면 임대료 ${money(ask)}은 받아야 합니다.${why}"`, need }
  }
  return { verdict: 'reject', reason: `"임대료 ${money(fee)}은 너무 적습니다.${share < 1 ? ' 연봉을 더 부담해 주시면 임대료를 낮출 수 있습니다.' : ''}"`, need }
}

/**
 * 내 선수 임대 보내기: 이 선수를 원하는 구단 후보 (출전 기회가 있는 곳 위주)
 *   상대가 연봉 100%를 내고, 임대료는 가치의 3~6%
 */
export function loanTargets(teams, myTeamId, p, value) {
  const ovr = playerOvrOf(p)
  // 같은 세부 포지션(RB·CB·ST…)끼리 비교한다. 그 자리 주전 수만큼 앞에 더 나은 선수가 없으면 '주전 예상'
  const ROLE_SLOT = { GK: 1, CB: 2, LB: 1, RB: 1, LWB: 1, RWB: 1, DM: 1, CDM: 1, CM: 2, AM: 1, CAM: 1, LM: 1, RM: 1, LW: 1, RW: 1, ST: 1, CF: 1 }
  const byRole = !!(p.role && ROLE_SLOT[p.role])
  const avg = (t) => t.players.map(playerOvrOf).sort((a, b) => b - a).slice(0, 14).reduce((x, y) => x + y, 0) / 14
  return teams.filter((t) => t.id !== myTeamId).map((t) => {
    const same = t.players.filter((x) => (byRole ? (x.role || x.pos) === p.role : x.pos === p.pos))
    const slot = byRole ? ROLE_SLOT[p.role] : { GK: 1, DF: 4, MF: 3, FW: 2 }[p.pos] || 3
    const better = same.filter((x) => playerOvrOf(x) > ovr).length
    const role = better < slot ? '주전 예상' : better < slot * 2 ? '로테이션' : '후보'
    const fit = (better < slot ? 3 : better < slot * 2 ? 2 : 0) + (t.players.filter((x) => x.pos === p.pos).length < (POS_NEED[p.pos] || 6) ? 1 : 0)
    return { team: t, role, fit, str: avg(t), fee: Math.round(value * (p.age <= 22 ? 0.03 : 0.06) * 10) / 10 }
  }).filter((x) => x.fit >= 2).sort((a, b) => b.fit - a.fit || a.str - b.str).slice(0, 4) // 같은 조건이면 작은 구단부터 (현실에서도 출전 기회 찾아 아래로 간다)
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

/** 상대 구단이 낼 수 있는 최대 금액 (몸값 기준, 좋은 선수일수록 경쟁이 붙어 더 낸다) */
export function maxBid(p, v, seed) {
  const star = playerOvrOf(p) >= 80 ? 1.35 : playerOvrOf(p) >= 75 ? 1.25 : 1.15
  return Math.round(v * star * (0.95 + (hash(`max-${seed}`) % 15) / 100) * 10) / 10
}

/**
 * 내 선수에게 다른 구단들이 이적료를 제안 (판매 목록에 올렸거나 이적을 요청한 선수)
 * 희망 가격(ask)이 있으면 그 근처에서 시작한다. 좋은 선수면 두 구단이 경쟁한다.
 * 반환: 편지함 메일 배열
 */
export function aiBidFor(save, teams, myTeamId, playerId, round, leagueId = save.league, buyers = []) {
  const mine = teams.find((t) => t.id === myTeamId)
  const p = mine?.players.find((x) => x.id === playerId)
  if (!p) return []
  const v = valueOf(p, save.status?.[p.id], valueCtx(save, p, leagueId))
  const ask = save.askPrice?.[p.id] ?? Math.round(v * 1.2 * 10) / 10
  // 사는 쪽: 내 리그 구단 + 다른 리그 구단
  const others = [...teams.filter((t) => t.id !== myTeamId).map((t) => ({ t, lid: leagueId, league: null })), ...buyers.map((b) => ({ t: b.team, lid: b.lid, league: b.league }))]
  const n = playerOvrOf(p) >= 78 ? 2 : 1
  const out = []
  for (let k = 0; k < n; k++) {
    const pick = others[hash(`${p.id}-${round}-${k}`) % others.length]
    const team = pick.t
    const cap = maxBid(p, v, `${p.id}-${team.id}-${round}`)
    const open = Math.min(cap, ask) * (0.78 + (hash(`bid-${p.id}-${round}-${k}`) % 20) / 100) // 처음엔 희망가보다 조금 낮게
    const fee = Math.round(open * 10) / 10
    out.push(news(round, 'offer', `💰 ${team.name}${pick.league ? ` (${pick.league})` : ''}의 영입 제안: ${p.name}`, `${team.name}이(가) ${p.name}(${p.pos}, OVR ${playerOvrOf(p)}, ${p.age}세)에게 ${money(fee)}을 제시했습니다. (희망 가격 ${money(ask)} · 선수 가치 ${money(v)})`, {
      offer: { teamId: team.id, lid: pick.lid, playerId: p.id, fee, cap, ask, tries: 0 },
      actions: [['accept', '✅ 수락', `${money(fee)}에 판매합니다`], ['counter', '↗️ 더 달라고 하기', `희망 가격 ${money(ask)}에 맞춰 달라고 요구합니다`], ['decline', '❌ 거절', '제안을 거절합니다']],
    }))
  }
  return out
}
