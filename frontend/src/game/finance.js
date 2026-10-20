// 구단 재정·계약 (단위: 백만 유로 €M). 내 구단만 계산한다.
import { playerOvrOf } from '../engine/engine.js'
import { news } from './season.js'

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const r1 = (v) => Math.round(v * 10) / 10

// 리그별 돈의 규모: 라운드당 중계권·스폰서, 홈경기 관중 수입, 주급 수준, 시즌 상금(1위 기준), 시작 자금 배수
export const LEAGUE_MONEY = {
  'premier-league': { tv: 3.2, sponsor: 1.4, gate: 2.6, wage: 1.6, prize: 45, cash: 1.6 },
  'la-liga': { tv: 2.0, sponsor: 1.0, gate: 1.8, wage: 1.25, prize: 30, cash: 1.2 },
  bundesliga: { tv: 1.9, sponsor: 1.1, gate: 2.2, wage: 1.2, prize: 28, cash: 1.2 },
  'serie-a': { tv: 1.8, sponsor: 0.9, gate: 1.5, wage: 1.1, prize: 26, cash: 1.1 },
  'ligue-1': { tv: 1.2, sponsor: 0.8, gate: 1.3, wage: 1.0, prize: 20, cash: 1.0 },
  eredivisie: { tv: 0.5, sponsor: 0.4, gate: 0.8, wage: 0.55, prize: 8, cash: 0.6 },
  'primeira-liga': { tv: 0.5, sponsor: 0.35, gate: 0.7, wage: 0.5, prize: 8, cash: 0.6 },
  championship: { tv: 0.45, sponsor: 0.3, gate: 0.9, wage: 0.45, prize: 6, cash: 0.5 },
  brasileirao: { tv: 0.55, sponsor: 0.35, gate: 0.6, wage: 0.4, prize: 7, cash: 0.5 },
}
export const moneyOf = (leagueId) => LEAGUE_MONEY[leagueId] || LEAGUE_MONEY['ligue-1']
export const eur = (v) => `${v < 0 ? '-' : ''}€${Math.abs(v) >= 10 ? Math.round(Math.abs(v)) : Math.abs(v).toFixed(1)}M`

// 티켓 가격: 관중 수입 배수와 팬 민심 변화(홈경기마다)
export const TICKETS = [
  ['cheap', '반값 할인', 0.7, 1.5, '관중석이 꽉 차고 팬들이 좋아합니다'],
  ['normal', '보통', 1.0, 0, '평소 가격'],
  ['high', '인상', 1.35, -1, '수입은 늘지만 불만이 쌓입니다'],
  ['gouge', '폭리', 1.8, -3, '돈은 많이 벌지만 팬들이 등을 돌립니다'],
]

/** 연봉(€M/년): OVR·나이·리그 수준 */
export function wageFor(p, leagueId) {
  const m = moneyOf(leagueId).wage
  const ageK = p.age <= 21 ? 0.6 : p.age <= 24 ? 0.85 : p.age <= 30 ? 1 : 0.85
  return r1(Math.max(0.1, 0.9 * Math.pow(1.11, playerOvrOf(p) - 72) * m * ageK))
}

/** 계약: 저장된 게 없으면 선수 ID로 고정 생성 (1~5년) */
export function contractOf(save, p, leagueId) {
  const c = save.contracts?.[p.id]
  if (c) return c
  const years = 1 + (hash(`ct-${p.id}`) % 5)
  return { until: (save.seasonNo || 1) + years - 1, wage: wageFor(p, leagueId) }
}
export const yearsLeft = (save, c) => c.until - (save.seasonNo || 1) + 1

/** 시작 자금: 리그 규모 × 전력 */
export function initialCash(team, leagueId) {
  const top = team.players.map(playerOvrOf).sort((a, b) => b - a).slice(0, 11)
  const s = top.reduce((a, b) => a + b, 0) / top.length
  return Math.round(40 * moneyOf(leagueId).cash * Math.pow(1.08, s - 75))
}

/**
 * 재정 시작: 구단 규모(시작 시점 연봉 총액)로 시즌 수입 기준(base)을 정한다
 * 수입 = 연봉 × 1.15 (중계·스폰서 70%, 관중 30%) → 연봉을 늘리면 적자, 줄이면 흑자
 */
export function newFinance(team, leagueId) {
  const wages = team.players.reduce((s, p) => s + wageFor(p, leagueId), 0)
  const base = r1(Math.max(8, wages * 1.15))
  return { cash: r1(base * 0.6), base, ticket: 'normal', last: null, ledger: [], warn: 0 }
}

/** 주급 총액 (€M/년) */
export function wageBill(save, team, leagueId) {
  return r1(team.players.reduce((s, p) => s + contractOf(save, p, leagueId).wage * (1 - (save.owner?.wageCut || 0)), 0))
}

/**
 * 라운드(경기) 정산: 수입(중계·스폰서·관중) - 주급. 팬 민심은 홈경기 티켓 가격·결과로 변한다
 * extra: { cup: true } 이면 대회 경기 (상금 포함)
 */
export function settleMatch(save, { team, leagueId, home, result, totalRounds, cupStage = null, cupPay = 1 }) {
  const m = moneyOf(leagueId)
  const f = { ...(save.finance || newFinance(team, leagueId)) }
  const fans = save.fans ?? 60
  const t = TICKETS.find((x) => x[0] === f.ticket) || TICKETS[1]
  const fanK = 0.6 + fans / 125 // 민심이 낮으면 관중이 줄어든다
  const items = []
  const base = f.base || 40
  if (!cupStage) {
    items.push(['중계권', r1((base * 0.45) / totalRounds)])
    items.push(['스폰서', r1(((base * 0.25) / totalRounds) * (1 + (save.owner?.sponsorBoost || 0)))])
  }
  if (home) items.push(['관중 수입', r1(((base * 0.3) / (totalRounds / 2)) * t[2] * fanK * (cupStage ? 0.8 + 0.6 * cupPay : 1))])
  if (cupStage) items.push(['대회 수당', r1(base * 0.012 * cupPay * (result > 0 ? 1.6 : 1))])
  const wages = cupStage ? 0 : r1(wageBill(save, team, leagueId) / totalRounds)
  if (wages) items.push(['주급', -wages])
  const net = r1(items.reduce((s, [, v]) => s + v, 0))
  f.cash = r1(f.cash + net)
  f.last = { items, net }
  f.ledger = [...(f.ledger || []), { r: save.round, net }].slice(-40)
  let dFans = (result > 0 ? 2 : result < 0 ? -2 : 0) + (home ? t[3] : 0)
  return { finance: f, fans: clamp(Math.round(fans + dFans), 0, 100) }
}

/** 재정 위기·파산 판단: 현금 -€30M 이하 경고, 위기 상태로 4라운드 이상 지나거나 -€80M 아래면 파산 */
export function checkBankruptcy(save, leagueId) {
  const f = save.finance
  if (!f) return { save, bankrupt: false }
  const limit = -0.35 * (f.base || 40)
  let warn = f.cash < limit ? (f.warn || 0) + 1 : 0
  const inbox = []
  if (warn === 1) inbox.push(news(save.round, 'finance', '💸 재정 위기', `현금이 ${eur(f.cash)}입니다. 4라운드 안에 회복하지 못하면 구단이 파산합니다. 선수 매각·주급 삭감·스폰서 계약을 검토하세요.`))
  const bankrupt = warn >= 5 || f.cash < limit * 2.6
  return { save: { ...save, finance: { ...f, warn }, inbox: [...inbox, ...(save.inbox || [])].slice(0, 80) }, bankrupt }
}

/** 시즌 상금: 순위에 따라 */
export function prizeMoney(pos, n, base) {
  return r1(base * 0.25 * Math.max(0.05, (n - pos + 1) / n) ** 1.6)
}

/** 재계약 요구 조건: 사기·나이·이적 요청 여부에 따라 거절도 */
export function renewalAsk(save, p, leagueId, status = {}) {
  const base = wageFor(p, leagueId)
  const morale = status.morale ?? 60
  if (status.wantsOut) return { refuse: '이적을 원하고 있어 재계약 협상을 거부합니다.' }
  if (morale < 30) return { refuse: '구단에 불만이 많아 재계약할 생각이 없다고 합니다.' }
  const k = 1.05 + (60 - morale) / 200 + (p.age <= 24 ? 0.1 : 0)
  return { wage: r1(base * k), maxYears: p.age >= 32 ? 1 : p.age >= 30 ? 2 : 4 }
}

/** 방출 위약금: 남은 연봉의 50% */
export function releaseCost(save, p, leagueId) {
  const c = contractOf(save, p, leagueId)
  return r1(Math.max(0.2, c.wage * yearsLeft(save, c) * 0.5))
}

/** FA 영입 판단: 제시 연봉·기간·구단 규모 → 수락 여부와 이유 */
export function faDecision(p, { offerWage, years, leagueId, clubOvr }) {
  const ask = r1(wageFor(p, leagueId) * 1.1)
  const allure = (moneyOf(leagueId).wage - 0.5) * 0.15 + (clubOvr - playerOvrOf(p)) / 60 // 큰 리그·강팀일수록 오고 싶어 한다
  const ratio = offerWage / ask
  const need = 1 - allure
  if (years > (p.age >= 32 ? 2 : 5)) return { ok: false, ask, reason: `${p.age}세라 그렇게 긴 계약은 부담스럽다고 합니다.` }
  if (ratio >= need) return { ok: true, ask, reason: '조건에 만족해 입단을 결정했습니다!' }
  if (ratio >= need * 0.85) return { ok: false, ask, counter: r1(ask * need), reason: `조금만 더 주면 오겠다고 합니다 (요구 ${eur(r1(ask * need))}/년).` }
  return { ok: false, ask, reason: `제시액이 너무 적다며 거절했습니다 (요구 ${eur(ask)}/년 수준).` }
}
export const ROSTER_MAX = 40
export const ROSTER_MIN = 18
