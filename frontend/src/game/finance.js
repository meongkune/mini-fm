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
// ── 통화 표시: 유로(백만 단위)와 원화 ──
// 환율은 매일 유럽중앙은행 기준 환율(frankfurter.app, 무료·키 없음)을 받아 쓴다. 못 받으면 마지막 값 → 기본값
export const FX_DEFAULT = 1600
let FX = { rate: FX_DEFAULT, date: null, mode: 'both' } // mode: 'eur' | 'krw' | 'both'
export const fxState = () => FX
export function setFx(patch) { FX = { ...FX, ...patch } }
/** 원화: 1조 2천억 → '1.2조', 4억 8천만 → '4.8억', 3천5백만 → '3,500만' */
export function wonText(m) {
  const won = Math.abs(m) * 1e6 * FX.rate
  if (won >= 1e12) return `${(won / 1e12).toFixed(won >= 1e13 ? 0 : 1)}조`
  if (won >= 1e8) return `${won >= 1e10 ? Math.round(won / 1e8).toLocaleString() : (won / 1e8).toFixed(1)}억`
  return `${Math.round(won / 1e4).toLocaleString()}만`
}
const euroText = (a) => `€${a >= 10 ? Math.round(a) : a.toFixed(1)}M`
/** 금액(€M) 표시: 설정에 따라 '€0.3M' · '4.8억 원' · '€0.3M (4.8억)' */
export const eur = (v) => {
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  if (FX.mode === 'krw') return `${sign}${wonText(a)}원`
  if (FX.mode === 'both') return `${sign}${euroText(a)} (${wonText(a)})`
  return `${sign}${euroText(a)}`
}

// 티켓 가격: 관중 수입 배수와 팬 민심 변화(홈경기마다)
export const TICKETS = [
  ['cheap', '반값 할인', 0.7, 1.5, '관중석이 꽉 차고 팬들이 좋아합니다'],
  ['normal', '보통', 1.0, 0, '평소 가격'],
  ['high', '인상', 1.35, -1, '수입은 늘지만 불만이 쌓입니다'],
  ['gouge', '폭리', 1.8, -3, '돈은 많이 벌지만 팬들이 등을 돌립니다'],
]

// ── 연봉 ──
// 실제 축구처럼 '구단마다 쓰는 연봉 총액'을 먼저 정하고, 그 안에서 선수 가치 비율대로 나눈다.
//   구단 총액 = 리그 최상위 구단 총액 × 0.8^(리그 1위와의 전력 차) — 공개 추정치(Capology 등)에 맞춤
//     예: 맨시티·아스널 약 €250M · 바이에른 약 €280M · 브렌트퍼드 약 €70M · 묀헨글라트바흐 약 €55M · PSV 약 €40M
//   선수 몫 = 능력가치^0.55 × 나이 (어린 선수는 신인 계약이라 적게) × 골키퍼 0.7
const BILL_TOP = { 'premier-league': 260, 'la-liga': 300, bundesliga: 280, 'serie-a': 200, 'ligue-1': 380, eredivisie: 40, 'primeira-liga': 75, championship: 45, brasileirao: 60, 'k-league': 10 }
const BILL_MIN = { 'premier-league': 45, 'la-liga': 18, bundesliga: 28, 'serie-a': 18, 'ligue-1': 14, eredivisie: 6, 'primeira-liga': 5, championship: 12, brasileirao: 8, 'k-league': 2 }
const TOP_OVR = { 'premier-league': 86.7, 'la-liga': 86.5, bundesliga: 85.7, 'serie-a': 83.8, 'ligue-1': 86.5, eredivisie: 80.5, 'primeira-liga': 81.9, championship: 81.1, brasileirao: 82.8, 'k-league': 68.7 }
const WAGE_FLOOR = { 'premier-league': 0.3, 'la-liga': 0.15, bundesliga: 0.15, 'serie-a': 0.12, 'ligue-1': 0.12, championship: 0.1 }
const worthOf = (p) => 0.1 * Math.pow(10, (playerOvrOf(p) - 58 - (p.pos === 'GK' ? 3 : 0)) / 10) // 나이 할인 없는 능력가치(€M)
/** 연봉 몫 가중치 */
function weightOf(p) {
  const worth = worthOf(p)
  const ageK = p.age <= 20 ? 0.45 : p.age <= 22 ? 0.65 : p.age <= 24 ? 0.85 : p.age <= 30 ? 1 : 0.95
  return Math.pow(worth, 0.55) * ageK * (p.pos === 'GK' ? 0.7 : 1) // 골키퍼는 같은 가치의 필드 선수보다 적게 받는다
}
const strengthOf = (team) => { const top = (team?.players || []).map(playerOvrOf).sort((a, b) => b - a).slice(0, 11); return top.length ? top.reduce((a, b) => a + b, 0) / top.length : 70 }
// 구단별 선수 연봉 총액 (€M/년, 공개 추정치를 반올림한 대략값) — 스쿼드 가치만으로는 구단의 '돈 쓰는 규모'를 알 수 없어서
//   (예: 브렌트퍼드는 선수 가치가 높지만 연봉은 적게 쓴다). 표에 없는 구단은 아래 공식으로 계산
const CLUB_BILL = {
  'premier-league': { MCI: 265, MUN: 235, LIV: 230, CHE: 225, ARS: 215, TOT: 165, AVL: 175, NEW: 165, WHU: 140, EVE: 115, BHA: 110, NOT: 110, FUL: 110, CRY: 100, BOU: 100, WOL: 95, BRE: 82, LEE: 80, SUN: 70, BUR: 65 },
  bundesliga: { FCB: 300, BVB: 200, RBL: 150, B04: 140, WOB: 100, VFB: 90, SGE: 90, TSG: 70, BMG: 60, SCF: 55, SVW: 55, M05: 45, FCA: 45, UNB: 45, KOE: 45, HSV: 40, STP: 28, HEI: 25 },
}
/** 구단 연봉 총액 (€M/년) */
export function clubBill(team, leagueId) {
  const fixed = CLUB_BILL[leagueId]?.[team?.id]
  if (fixed) return fixed
  const top = BILL_TOP[leagueId] ?? 30
  // 리그 1위와 전력(주전 11명 평균) 1점 차이마다 총액 20%씩 적어진다
  const gap = Math.max(0, (TOP_OVR[leagueId] ?? 80) - strengthOf(team))
  return clamp(top * Math.pow(0.8, gap), BILL_MIN[leagueId] ?? 3, top * 1.1)
}
/** 구단 연봉 단가: 가중치 1당 €M (= 총액 ÷ 선수단 가중치 합) */
export function clubKOf(team, leagueId) {
  const sum = (team?.players || []).reduce((a, p) => a + weightOf(p), 0)
  return sum > 0 ? clubBill(team, leagueId) / sum : 0.2
}
// 내 구단 단가 (화면이 그리기 전에 store가 정한다 — 통화 표시처럼)
let CLUB_K = null
export const setClubK = (k) => { CLUB_K = k && k < 3 && k > 0.01 && k !== 1 ? k : CLUB_K }
/**
 * 연봉 + 출처: 실제 보도 연봉(TheSportsDB)이 있고 추정치의 0.4~2.5배 안이면 실제 값, 아니면 추정
 *   크라우드소싱 값이라 주급이 섞이거나(×52로 맞춰 봄) 이적 전 낡은 값이 있다 → 추정치와 너무 다르면 버린다
 * @returns { wage, real }
 */
export function wageInfo(p, leagueId, clubK = CLUB_K) {
  const est = estWage(p, leagueId, clubK)
  if (p.realWage) {
    const fits = [p.realWage, r1(p.realWage * 52)].map((w) => ({ w, d: Math.abs(Math.log(w / est)) })).filter(({ w }) => w / est >= 0.4 && w / est <= 2.5).sort((a, b) => a.d - b.d)
    if (fits.length) return { wage: Math.max(0.1, fits[0].w), real: true }
  }
  return { wage: est, real: false }
}
/** 연봉(€M/년): 실제 보도 값이 그럴듯하면 그것, 아니면 추정 */
export const wageFor = (p, leagueId, clubK = CLUB_K) => wageInfo(p, leagueId, clubK).wage

/** 추정 연봉(€M/년): 구단 단가 × 선수 가중치 (단가가 없으면 리그 평균 구단 기준) */
function estWage(p, leagueId, clubK = CLUB_K) {
  const k = clubK || ((BILL_TOP[leagueId] ?? 30) * 0.35) / 180 // 단가를 모를 때: 리그 중위권 구단 정도
  return r1(Math.max(WAGE_FLOOR[leagueId] ?? 0.08, k * weightOf(p)))
}

/** 예전(3판) 추정 연봉 — 진행 중인 세이브의 연봉을 새 기준으로 옮길 때만 쓴다 */
export function legacyWageV3(p, leagueId, oldK = 1) {
  const L = { 'premier-league': 1.15, 'la-liga': 1.0, bundesliga: 0.95, 'serie-a': 0.95, 'ligue-1': 0.9, eredivisie: 0.6, 'primeira-liga': 0.55, championship: 0.7, brasileirao: 0.6, 'k-league': 0.35 }
  const M = { 'premier-league': 0.5, 'la-liga': 0.3, bundesliga: 0.35, 'serie-a': 0.3, 'ligue-1': 0.25, championship: 0.2, eredivisie: 0.15, 'primeira-liga': 0.12, brasileirao: 0.12 }
  const worth = worthOf(p)
  const ageK = p.age <= 20 ? 0.5 : p.age <= 22 ? 0.7 : p.age <= 24 ? 0.85 : p.age <= 30 ? 1 : 0.92
  const star = 1 + clamp((worth - 60) / 300, 0, 0.35)
  return r1(Math.max(M[leagueId] ?? 0.1, 0.47 * Math.pow(worth, 0.653) * star * (L[leagueId] ?? 0.8) * (oldK || 1) * ageK))
}

/**
 * 다른 구단 선수의 계약 만료 시즌. 선수마다 저장하지 않는다 (세이브 크기):
 *   - 처음 계약은 선수 ID로 고정 (1시즌 기준 1~5년) → 시즌이 지나면 실제로 줄어든다 (예전에는 해마다 다시 계산해 영영 만료되지 않았다)
 *   - 재계약·이적으로 새로 맺은 계약만 save.aiCt[선수ID] = 만료 시즌 으로 적어 둔다
 *   - 적힌 게 없는데 이미 지난 계약(다른 리그 선수·옛 세이브)은 3년마다 재계약한 것으로 본다
 */
export function aiUntil(save, p) {
  const no = save.seasonNo || 1
  const set = save.aiCt?.[p.id]
  if (set >= no) return set
  let u = 1 + (hash(`ct-${p.id}`) % 5)
  while (u < no) u += 3
  return u
}
/** 계약: 내 선수는 저장된 계약, 다른 구단 선수는 aiUntil로 정해지는 계약 */
export function contractOf(save, p, leagueId) {
  const c = save.contracts?.[p.id]
  if (c) return c
  const w = wageInfo(p, leagueId)
  return { until: aiUntil(save, p), wage: w.wage, ...(w.real ? { real: true } : {}) }
}
/** 선수단 연봉 가중치 합 (구단 단가를 곱하면 연봉 총액) — 다른 구단 재정 계산용 */
export const squadWeight = (team) => (team?.players || []).reduce((a, p) => a + weightOf(p), 0)
export const yearsLeft = (save, c) => c.until - (save.seasonNo || 1) + 1

/** 시작 자금: 리그 규모 × 전력 */
export function initialCash(team, leagueId) {
  const top = team.players.map(playerOvrOf).sort((a, b) => b - a).slice(0, 11)
  const s = top.reduce((a, b) => a + b, 0) / top.length
  return Math.round(40 * moneyOf(leagueId).cash * Math.pow(1.08, s - 75))
}

// ── 재정 5판: 현실 구단·FM처럼 ──
//   매출은 구단 규모로 정해지고(게임 시작 때 한 번), 그 뒤로는 연봉을 올리거나 내려도 매출이 따라 움직이지 않는다 (성적에 따라서만 조금 변한다)
//   매출 100 중 연봉이 약 62, 운영비(직원·구장·유스·원정)가 약 31 → 평소에는 조금 남는다
//   이사회가 시즌마다 '이적 자금'과 '임금 예산'을 정해 주고, 감독은 둘을 맞바꿀 수만 있다
//   이적료는 현금으로는 바로 나가지만, FFP 손익에는 계약 기간에 나눠 잡힌다 (5년 계약 €50M → 해마다 €10M)
export const FIN_MODEL = 5
export const WAGE_SHARE = 0.62 // 시작 시점: 매출 중 연봉 비중
export const OPEX = 0.31 // 매출 중 운영비
export const REV_K = 1.15 // 예상 매출 = base × 1.15 (중계·스폰서·관중·상품 + 평균적인 상금)
export const WB_SHARE = 0.7 // 이사회가 허락하는 임금 예산: 매출의 70%
export const SHIFT_K = 2 // 맞바꾸기: 임금 예산 €1M/년 ↔ 이적 자금 €2M
const r2 = (v) => Math.round(v * 100) / 100
const v5 = (f) => (f?.fm || 0) >= FIN_MODEL
/** 한 시즌 예상 매출 */
export const revenueOf = (f = {}) => r1((f.base || 40) * (v5(f) ? REV_K : 1.1))

/**
 * 재정 시작: 구단 규모(게임을 시작할 때의 선수단 연봉)로 매출을 정한다 — 이후에는 연봉과 상관없이 고정
 */
export function newFinance(team, leagueId) {
  const k = clubKOf(team, leagueId)
  const wages = team.players.reduce((s, p) => s + wageFor(p, leagueId, k), 0)
  const rev = Math.max(10, wages / WAGE_SHARE)
  const base = r1(rev / REV_K)
  return {
    cash: r1(rev * 0.14), base, ticket: 'normal', last: null, ledger: [], warn: 0, wageModel: 4, clubK: k,
    fm: FIN_MODEL, tb: r1(rev * 0.12), wb: r1(Math.max(rev * WB_SHARE, wages * 1.06)), shift: 0, amort: [],
  }
}

/** 예전 재정(4판 이하)을 5판으로: 매출을 '연봉 62%' 기준으로 다시 잡고, 지금 현금·연봉에 맞춰 예산을 준다 */
export function toFinanceV5(f, bill) {
  const base = r1((f.base || 40) / (1.15 * WAGE_SHARE * REV_K)) // 예전 base = 시작 연봉 × 1.15
  const rev = base * REV_K
  const nf = { ...f, base, fm: FIN_MODEL, tb: r1(Math.max(0, (f.cash || 0) * 0.7)), wb: r1(Math.max(rev * WB_SHARE, bill * 1.06)), shift: 0, amort: [] }
  delete nf.wageRatio
  return nf
}

/** 새 시즌 이사회 예산: 성적이 좋으면 매출이 조금 늘고, 이사회 신뢰가 높을수록 이적 자금을 더 준다 */
export function boardBudgets(f, { success = true, confidence = 60, bill = 0 } = {}) {
  if (!v5(f)) return f
  const base = r1((f.base || 40) * (success ? 1.04 : 0.98))
  const rev = base * REV_K
  const cash = f.cash || 0
  const tb = r1(Math.max(0, Math.min(cash, Math.max(rev * 0.03, cash * 0.65) * (0.75 + confidence / 200))))
  return { ...f, base, tb, wb: r1(Math.max(rev * WB_SHARE, bill)), shift: 0 }
}

/** 이적 자금: 이사회가 준 한도에서 임금 쪽으로 넘긴 만큼 빼고, 통장 현금보다 많이는 못 쓴다 */
export const transferFunds = (f = {}) => (v5(f) ? r1(Math.max(0, Math.min(f.cash || 0, (f.tb || 0) - (f.shift || 0) * SHIFT_K))) : f.cash || 0)

/** 맞바꾸기 범위(€M/년): 음수 = 임금 예산을 줄여 이적 자금으로, 양수 = 이적 자금을 줄여 임금 예산으로 */
export function shiftRange(f = {}, bill = 0) {
  // 임금 예산은 지금 연봉 총액 밑으로 못 줄이고, 이적 자금은 통장 현금보다 많아질 수 없으니 그 이상 넘겨도 소용없다
  const min = -Math.max(0, Math.floor(Math.min((f.wb || 0) - bill, Math.max(0, (f.cash || 0) - (f.tb || 0)) / SHIFT_K) * 2) / 2)
  const max = Math.max(0, Math.floor((Math.min(f.tb || 0, f.cash || 0) / SHIFT_K) * 2) / 2)
  return { min, max }
}

/** 이적료·임대료·계약금 지출: 현금·이적 자금은 바로 줄고, FFP 손익에는 계약 기간에 나눠 잡는다 */
export function payFee(f, fee, years = 1, cat = '이적료 지출') {
  if (!v5(f)) return book(f, -fee, cat)
  const y = clamp(Math.round(years) || 1, 1, 5)
  const per = r2(fee / y)
  const b = book(f, -per, cat) // 올해 몫만 손익에
  return { ...b, cash: r1((f.cash || 0) - fee), tb: r1(Math.max(0, (f.tb || 0) - fee)), amort: y > 1 ? [...(f.amort || []), { per, left: y - 1 }] : f.amort || [] }
}

/** 이적료 수입: 현금으로 들어오고, 그 80%는 다시 이적 자금으로 쓸 수 있다 */
export function takeFee(f, fee, cat = '이적료 수입') {
  const b = book(f, fee, cat)
  return v5(f) ? { ...b, tb: r1((f.tb || 0) + fee * 0.8) } : b
}

/** 주급 총액 (€M/년) */
export function wageBill(save, team, leagueId) {
  return r1(team.players.reduce((s, p) => s + contractOf(save, p, leagueId).wage * (1 - (save.owner?.wageCut || 0)), 0))
}

/**
 * 라운드(경기) 정산: 수입(중계·스폰서·관중) - 주급. 팬 민심은 홈경기 티켓 가격·결과로 변한다
 * extra: { cup: true } 이면 대회 경기 (상금 포함)
 */
export function settleMatch(save, { team, leagueId, home, result, totalRounds, cupStage = null, cupPay = 1, oppGap = 0 }) {
  const f = { ...(save.finance || newFinance(team, leagueId)) }
  const fans = save.fans ?? 60
  const tk = gateModel(f, fans, save) // 티켓 가격(%)·민심·최근 성적 → 관중
  const items = []
  const base = f.base || 40
  if (!cupStage) {
    items.push(['중계권', r1((base * 0.45) / totalRounds)])
    // 스폰서: 민심이 높을수록 더 낸다 (0.85~1.15배)
    items.push(['스폰서', r1(((base * 0.25) / totalRounds) * (1 + (save.owner?.sponsorBoost || 0)) * fanMoneyK(fans))])
    const nm = save.owner?.naming
    if (nm && nm.until >= (save.seasonNo || 1)) items.push(['명명권', r2(nm.per / totalRounds)])
  }
  // 무료 입장의 날: 그 홈경기 입장 수입은 없고 관중석은 꽉 찬다
  const free = home && !cupStage && save.owner?.freeGate
  if (home) {
    items.push(['관중 수입', free ? 0 : r1(((base * 0.3) / (totalRounds / 2)) * tk.revenueK * (cupStage ? 0.8 + 0.6 * cupPay : 1))])
    items.push(['상품 판매', r1(((base * 0.06) / (totalRounds / 2)) * (0.5 + fans / 100))])
  }
  // 대회 수당·상금은 대회 쪽(cup.js cupPrizes)에서 장부에 넣는다. 여기서는 홈경기 관중 수입만
  // 운영비: 직원·구장·유스·원정 (매출의 31%, 리그 라운드마다)
  if (!cupStage && v5(f)) items.push(['운영비', -r2((base * REV_K * OPEX) / totalRounds)])
  const wages = cupStage ? 0 : r1(wageBill(save, team, leagueId) / totalRounds)
  if (wages) items.push(['주급', -wages])
  const net = r1(items.reduce((s, [, v]) => s + v, 0))
  f.cash = r1(f.cash + net)
  f.last = { items, net, ...(home ? { att: free ? 1 : tk.att, pct: free ? -100 : tk.pct } : {}) }
  f.ledger = [...(f.ledger || []), { r: save.round, net }].slice(-40)
  // 시즌 손익 누적 (FFP 판단용)
  const ss = { rev: 0, exp: 0, wages: 0, ...(f.season || {}) }
  const cats = { ...(ss.cats || {}) } // 항목별 시즌 누적 (구단 화면 그래프)
  for (const [k, v] of items) { cats[k] = r1((cats[k] || 0) + v); if (v >= 0) ss.rev = r1(ss.rev + v); else { ss.exp = r1(ss.exp - v); if (k === '주급') ss.wages = r1(ss.wages - v) } }
  ss.cats = cats
  f.season = ss
  const dFans = fanDelta(fans, result, oppGap) + (home ? (free ? 8 : tk.dFans) : 0)
  return { finance: f, fans: clamp(r1(fans + dFans), 0, 100) }
}

// ── 팬 민심 ──
//   경기 결과는 '기대 대비'로 움직인다: 강한 상대를 이기면 크게 오르고, 약한 상대에게 지면 크게 깎인다
//   아무 일이 없으면 조금씩 중간(55)으로 돌아온다 (바닥·꼭대기에 영영 갇히지 않게)
//   oppGap = 상대 전력 - 우리 전력 (주전 11명 평균)
export function fanDelta(fans, result, oppGap = 0) {
  const e = clamp(oppGap / 4, -1, 1) // 상대가 4 이상 강하면 1, 4 이상 약하면 -1
  const res = result > 0 ? clamp(2 + 2 * e, 1, 4) : result < 0 ? clamp(-2 + 2 * e, -4, -0.5) : 1.5 * e
  return res + (55 - fans) * 0.03
}
/** 민심이 스폰서·상품 수입에 주는 배수: 민심 0 → 0.85, 50 → 1.0, 100 → 1.15 */
export const fanMoneyK = (fans = 60) => 0.85 + 0.3 * clamp(fans, 0, 100) / 100
/** 홈 관중 응원: 경기력 배수 보정 (민심 100 → +1.2%, 0 → -1.2% 야유) */
export const crowdBoost = (fans = 60) => ((clamp(fans, 0, 100) - 50) / 50) * 0.012

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

/**
 * 연봉 체계 점검: 새 계약이 팀 임금 구조를 흔드는지
 * - 기존 최고 연봉보다 많이 주면, 새 선수보다 OVR이 높은데 덜 받게 되는 선수들이 반발한다
 * - 요구액의 1.6배 넘게 주면 언론·팬이 '돈 낭비'라고 비판한다
 */
export function wageShock(save, team, leagueId, p, offerWage) {
  const rows = team.players.filter((x) => x.id !== p.id).map((x) => ({ x, wage: contractOf(save, x, leagueId).wage }))
  const top = rows.sort((a, b) => b.wage - a.wage)[0] || null
  const newOvr = playerOvrOf(p)
  const jealous = rows.filter((r) => r.wage < offerWage && playerOvrOf(r.x) > newOvr).map((r) => r.x)
  const ask = wageFor(p, leagueId) * 1.1
  const bill = wageBill(save, team, leagueId)
  return { topWage: top?.wage ?? 0, topName: top?.x.name ?? '', jealous, overpay: offerWage / ask, bill, newBill: r1(bill + offerWage), income: save.finance?.base || 40 }
}

// ── 티켓 가격(%) · 관중 · FFP ──
const OLD_TICKET = { cheap: -30, normal: 0, high: 35, gouge: 80 }
export const ticketPct = (f = {}) => (typeof f.ticketPct === 'number' ? f.ticketPct : OLD_TICKET[f.ticket] ?? 0)

/**
 * 홈경기 관중 모델: 수요(민심·최근 성적) × 가격 탄력성
 * 반환: att(관중 비율 0~1) · revenueK(기준 대비 관중 수입 배수) · dFans(경기당 민심 변화)
 */
export function gateModel(f, fans = 60, save = null, pct = ticketPct(f)) {
  const recent = (save?.results || []).filter((r) => r.home === save.teamId || r.away === save.teamId).slice(-5)
  const form = recent.reduce((s, r) => { const d = r.home === save.teamId ? r.score[0] - r.score[1] : r.score[1] - r.score[0]; return s + Math.sign(d) }, 0)
  const demand = clamp(0.6 + fans / 220 + form * 0.02, 0.35, 1.08)
  const elastic = pct >= 0 ? 1 - 0.55 * (pct / 100) ** 1.2 : 1 - 0.2 * (pct / 100) // 비싸질수록 관중이 줄고, 싸지면 조금 는다
  const att = clamp(demand * elastic, 0.15, 1)
  const revenueK = ((1 + pct / 100) * att) / 0.86 // 보통 가격·보통 수요(관중 86%)일 때 1
  const dFans = r1(-pct / 40 + (att < 0.65 ? -0.6 : 0))
  return { att, revenueK, dFans, pct }
}

/** FFP 기준: 최근 3시즌 손실 합계 한도 · 매출 대비 연봉 비율(85% 넘으면 주의, 100% 넘으면 위반) */
export function ffpStatus(f = {}, bill = 0) {
  const base = f.base || 40
  const allowance = r1(base * 0.25)
  const cur = f.season ? r1(f.season.rev - f.season.exp) : 0
  const past = (f.history || []).slice(-2).map((x) => x.net)
  const total = r1([...past, cur].reduce((a, b) => a + b, 0))
  const revenue = Math.max(1, revenueOf(f)) // 한 시즌 예상 매출 (중계·스폰서·관중·상품)
  const ratio = bill / revenue
  const level = total < -allowance || ratio > 1 ? 'breach' : total < -allowance * 0.6 || ratio > 0.85 ? 'warn' : 'ok'
  return { allowance, cur, total, ratio, revenue: r1(revenue), level, label: { ok: '준수', warn: '주의', breach: '위반' }[level] }
}

/** 시즌 마감 FFP 심사: 위반이면 벌금 + 다음 시즌 영입 금지, 두 번째 위반부터 승점 6점 감점 */
export function ffpReview(f = {}, bill = 0, seasonNo = 1) {
  const st = ffpStatus(f, bill)
  const history = [...(f.history || []), { seasonNo, net: st.cur, rev: f.season?.rev || 0, exp: f.season?.exp || 0 }].slice(-5)
  // 지난 영입의 이적료 중 올해 몫(분할)은 새 시즌 손익에 미리 잡아 둔다
  const due = r1((f.amort || []).reduce((a, x) => a + x.per, 0))
  const amort = (f.amort || []).map((x) => ({ ...x, left: x.left - 1 })).filter((x) => x.left > 0)
  const nf = { ...f, history, amort, season: due ? { rev: 0, exp: due, wages: 0, cats: { '이적료 분할(지난 영입)': -due } } : { rev: 0, exp: 0, wages: 0 } }
  if (st.level !== 'breach') return { finance: nf, penalty: null, st }
  const breaches = (f.breaches || 0) + 1
  const fine = r1(Math.max(0, -(st.total + st.allowance)) * 0.3 + (f.base || 40) * 0.03)
  nf.cash = r1((f.cash || 0) - fine)
  nf.breaches = breaches
  return { finance: nf, penalty: { fine, ban: true, points: breaches >= 2 ? 6 : 0 }, st }
}

/** 현금만 움직이는 돈 (FFP 손익에 넣지 않는다): 사채 대출·상환 같은 빌리고 갚는 돈 */
export const cashOnly = (f, amount) => ({ ...f, cash: r2((f.cash || 0) + amount) }) // 0.01 단위 (경기마다 나눠 갚는 작은 금액이 반올림으로 사라지지 않게)

/** 장부 기록 (영입·방출·매각 등 경기 밖의 돈) */
export function book(f, amount, cat = amount >= 0 ? '기타 수입' : '기타 지출') {
  const ss = { rev: 0, exp: 0, wages: 0, ...(f.season || {}) }
  ss.cats = { ...(ss.cats || {}), [cat]: r2((ss.cats?.[cat] || 0) + amount) }
  if (amount >= 0) ss.rev = r2(ss.rev + amount)
  else ss.exp = r2(ss.exp - amount)
  return { ...f, cash: r2((f.cash || 0) + amount), season: ss }
}

/** 임금 예산: 이사회가 정한 한도 + 감독이 이적 자금에서 넘겨 온 만큼 (5판 전 세이브는 예전 방식) */
export const wageBudget = (f = {}) => (v5(f) ? r1((f.wb ?? revenueOf(f) * WB_SHARE) + (f.shift || 0)) : r1((f.base || 40) * 1.1 * (f.wageRatio ?? 0.85)))
