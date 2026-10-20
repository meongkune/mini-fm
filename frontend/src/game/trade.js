// 트레이드 이적 (이적료 없음): 선수 가치 평가, 상대 구단 AI의 수락·거절·역제안, 실행
import { playerOvrOf } from '../engine/engine.js'
import { news } from './season.js'

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
export const MIN_SQUAD = { GK: 2, DF: 6, MF: 6, FW: 3 }
export const MAX_SQUAD = 30
export const MAX_PER_SIDE = 2
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

/** 선수 가치 (게임 내 단위, 백만 유로처럼 표시) */
export function valueOf(p, st = {}) {
  const ovr = playerOvrOf(p)
  const pa = potentialOf(p)
  const ageMult = p.age <= 21 ? 1 + (pa - ovr) * 0.045 : p.age <= 27 ? 1 + (pa - ovr) * 0.03 : p.age <= 29 ? 0.85 : p.age <= 31 ? 0.65 : 0.45
  let v = 12 * Math.pow(1.13, ovr - 70) * ageMult
  if (st.wantsOut) v *= 0.8
  if (st.inj > 0) v *= 0.85
  return Math.max(0.5, Math.round(v * 10) / 10)
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
function squadProblem(players) {
  const c = countPos(players)
  for (const [pos, n] of Object.entries(MIN_SQUAD)) if ((c[pos] || 0) < n) return `${pos} 인원이 ${n}명 아래로 줄어듭니다`
  if (players.length > MAX_SQUAD) return `선수단이 ${MAX_SQUAD}명을 넘습니다`
  return null
}

/**
 * 상대 구단 AI의 판단
 * @returns { verdict: 'accept'|'counter'|'reject', reason, ask?: [추가로 원하는 내 선수 ID] }
 */
export function evaluateTrade({ mine, theirs, give, get, status = {} }) {
  if (!give.length || !get.length) return { verdict: 'reject', reason: '주고받을 선수를 한 명 이상 골라야 합니다.' }
  const byId = Object.fromEntries([...mine.players, ...theirs.players].map((p) => [p.id, p]))
  const giveP = give.map((id) => byId[id])
  const getP = get.map((id) => byId[id])
  // 선수단 규정 (양쪽 모두)
  const theirAfter = [...theirs.players.filter((p) => !get.includes(p.id)), ...giveP]
  const myAfter = [...mine.players.filter((p) => !give.includes(p.id)), ...getP]
  const pTheirs = squadProblem(theirAfter)
  if (pTheirs) return { verdict: 'reject', reason: `"그렇게 하면 우리 팀 ${pTheirs}."` }
  const pMine = squadProblem(myAfter)
  if (pMine) return { verdict: 'reject', reason: `규정상 불가: 내 팀 ${pMine}.` }

  const val = (ps) => ps.reduce((s, p) => s + valueOf(p, status[p.id]), 0)
  const offer = val(giveP)
  const ask = val(getP)
  // 팀 핵심 선수(OVR 상위 3명)는 더 비싸게 부른다
  const core = new Set([...theirs.players].sort((a, b) => playerOvrOf(b) - playerOvrOf(a)).slice(0, 3).map((p) => p.id))
  const premium = getP.some((p) => core.has(p.id)) ? 1.3 : 1.12
  const need = ask * premium
  if (offer >= need) return { verdict: 'accept', reason: `"좋습니다. 이 조건이면 받아들이겠습니다."`, offer, need }
  const ratio = offer / need
  const coreNote = getP.some((p) => core.has(p.id)) ? ' 팀 핵심 선수라 쉽게 내줄 수 없습니다.' : ''
  if (ratio >= 0.55 && give.length < MAX_PER_SIDE) {
    // 내 선수 한 명을 더 얹으면 맞춰지는지 찾는다 (가장 싼 선수부터)
    const extra = mine.players
      .filter((p) => !give.includes(p.id))
      .map((p) => ({ p, v: valueOf(p, status[p.id]) }))
      .filter(({ v }) => offer + v >= need)
      .sort((a, b) => a.v - b.v)
      .find(({ p }) => !squadProblem([...mine.players.filter((x) => !give.includes(x.id) && x.id !== p.id), ...getP]) && !squadProblem([...theirAfter, p]))
    if (extra) return { verdict: 'counter', reason: `"조금 모자랍니다.${coreNote} ${extra.p.name}까지 같이 보내 주시면 진행하죠."`, ask: [extra.p.id], offer, need }
  }
  if (ratio >= 0.8) return { verdict: 'reject', reason: `"거의 다 왔는데 조금 부족합니다.${coreNote}"`, offer, need }
  if (ratio >= 0.55) return { verdict: 'reject', reason: `"가치 차이가 꽤 납니다.${coreNote} 더 좋은 선수를 제안해 주세요."`, offer, need }
  return { verdict: 'reject', reason: `"${getP.map((p) => p.name).join(', ')}의 가치에 한참 못 미칩니다."`, offer, need }
}

/** 트레이드 실행: 두 팀 선수단을 save.rosters에 기록 */
export function executeTrade(save, teams, myTeamId, theirId, give, get) {
  const rosters = { ...(save.rosters || Object.fromEntries(teams.map((t) => [t.id, t.players.map((p) => p.id)]))) }
  for (const t of teams) if (!rosters[t.id]) rosters[t.id] = t.players.map((p) => p.id)
  rosters[myTeamId] = [...rosters[myTeamId].filter((id) => !give.includes(id)), ...get]
  rosters[theirId] = [...rosters[theirId].filter((id) => !get.includes(id)), ...give]
  const status = { ...(save.status || {}) }
  for (const id of [...give, ...get]) {
    const s = { ...(status[id] || {}) }
    s.morale = get.includes(id) ? 72 : 60 // 새 팀에 온 선수는 의욕이 높다
    delete s.wantsOut; delete s.promise; delete s.complained
    s.benched = 0
    status[id] = s
  }
  const byId = Object.fromEntries(teams.flatMap((t) => t.players).map((p) => [p.id, p]))
  const their = teams.find((t) => t.id === theirId)
  const item = news(save.round, 'trade', `트레이드 성사 · ${their?.name ?? theirId}`, `${get.map((id) => byId[id]?.name).join(', ')} 영입 ⇄ ${give.map((id) => byId[id]?.name).join(', ')} 이적`, { read: true })
  return {
    ...save,
    rosters,
    status,
    lineup: save.lineup.filter((id) => !give.includes(id)),
    tradeLog: [...(save.tradeLog || []), { round: save.round, with: theirId, give, get }],
    inbox: [item, ...(save.inbox || [])],
  }
}

/** 이적 요청한 내 선수에게 다른 구단이 먼저 제안 (라운드 결과 처리 때 호출) */
export function aiOfferFor(save, teams, myTeamId, playerId, round) {
  const mine = teams.find((t) => t.id === myTeamId)
  const p = mine?.players.find((x) => x.id === playerId)
  if (!p) return null
  const v = valueOf(p, save.status?.[p.id])
  const others = teams.filter((t) => t.id !== myTeamId)
  const team = others[hash(`${p.id}-${round}`) % others.length]
  // 비슷한 가치(80~110%)의 같은 포지션 선수
  const cand = team.players
    .filter((x) => x.pos === p.pos)
    .map((x) => ({ x, r: valueOf(x, save.status?.[x.id]) / v }))
    .filter(({ r }) => r >= 0.8 && r <= 1.1)
    .sort((a, b) => b.r - a.r)[0]
  if (!cand) return null
  return news(round, 'trade', `${team.name}의 트레이드 제안`, `${team.name}이(가) 이적을 원하는 ${p.name} 선수를 원합니다. 대신 ${cand.x.name}(${cand.x.pos}, OVR ${playerOvrOf(cand.x)}, ${cand.x.age}세)을(를) 보내겠다고 합니다.`, {
    offer: { teamId: team.id, give: [p.id], get: [cand.x.id] },
    actions: [['accept', '✅ 수락', '바로 트레이드합니다'], ['decline', '❌ 거절', '제안을 거절합니다']],
  })
}
