// 승격·강등: 프리미어리그(1부) ↔ 챔피언십(2부)
//   1부 18~20위 강등 · 2부 1·2위 자동 승격 + 3~6위 플레이오프(4강 3위-6위·4위-5위, 결승) 승자 승격
//   내가 뛰지 않는 쪽 리그는 화면에 안 보이므로, 시즌이 끝날 때 전력 기반 득점 모델로 한 시즌을 빠르게 계산한다
//   (경기 엔진으로 552경기를 돌리면 7초가 걸려서 — 이 모델은 1ms 안팎)
import { playerOvrOf, roundRobin } from '../engine/engine.js'

export const TOP = 'premier-league'
export const LOW = 'championship'
export const PAIR = { [TOP]: LOW, [LOW]: TOP }
export const DOWN = 3 // 강등 팀 수 (= 승격 팀 수)

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
const strengthOf = (t) => { const o = (t?.players || []).map(playerOvrOf).sort((a, b) => b - a).slice(0, 11); return o.length ? o.reduce((a, b) => a + b, 0) / o.length : 65 }

// 결정적 난수 → 포아송 골 수
function poisson(lambda, seed) {
  let L = Math.exp(-lambda), k = 0, p = 1, i = 0
  do { k++; p *= (hash(`${seed}-${i++}`) % 100000) / 100000 } while (p > L && k < 12)
  return k - 1
}
/** 한 경기: 전력 차 1당 기대 득점 약 7% 차이, 홈 이점 약 +12% (경기 엔진의 평균 2.8골·홈 승률 약 45%에 맞춤) */
export function quickScore(home, away, seed) {
  const d = (strengthOf(home) - strengthOf(away)) / 14
  return [poisson(1.62 * Math.exp(d), `${seed}-h`), poisson(1.3 * Math.exp(-d), `${seed}-a`)]
}

/** 리그 한 시즌 빠른 계산 → 순위(팀 ID·승점·득실) */
export function simulateDivision(teams, seasonNo = 1, salt = '') {
  const byId = Object.fromEntries(teams.map((t) => [t.id, t]))
  const T = Object.fromEntries(teams.map((t) => [t.id, { id: t.id, name: t.name, pts: 0, gf: 0, ga: 0 }]))
  roundRobin(teams.map((t) => t.id)).forEach((rnd, ri) => rnd.forEach((f) => {
    const [h, a] = quickScore(byId[f.home], byId[f.away], `div-${salt}-${seasonNo}-${ri}-${f.home}-${f.away}`)
    T[f.home].gf += h; T[f.home].ga += a; T[f.away].gf += a; T[f.away].ga += h
    if (h > a) T[f.home].pts += 3; else if (h < a) T[f.away].pts += 3; else { T[f.home].pts++; T[f.away].pts++ }
  }))
  return Object.values(T).sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf)
}

/** 단판 경기 (비기면 승부차기: 조금 더 강한 쪽이 약간 유리) */
function knockout(home, away, seed) {
  const [h, a] = quickScore(home, away, seed)
  if (h !== a) return { home: home.id, away: away.id, score: [h, a], winner: h > a ? home.id : away.id }
  const r = (hash(`pk-${seed}`) % 1000) / 1000
  const hw = r < 0.5 + (strengthOf(home) - strengthOf(away)) / 60
  return { home: home.id, away: away.id, score: [h, a], pens: hw ? [5, 4] : [3, 4], winner: hw ? home.id : away.id }
}

/** 승격 플레이오프: 3위-6위, 4위-5위 (높은 순위 홈) → 결승(중립, 더 높은 순위 쪽을 홈으로) */
export function playoff(order, teamsById, seasonNo = 1) {
  const [t3, t4, t5, t6] = order.slice(2, 6).map((id) => teamsById[id])
  if (!t6) return null
  const sf1 = knockout(t3, t6, `po-${seasonNo}-1`)
  const sf2 = knockout(t4, t5, `po-${seasonNo}-2`)
  const rank = (id) => order.indexOf(id)
  const [fh, fa] = [sf1.winner, sf2.winner].sort((a, b) => rank(a) - rank(b)).map((id) => teamsById[id])
  const final = knockout(fh, fa, `po-${seasonNo}-F`)
  return { sf: [sf1, sf2], final, winner: final.winner }
}

/**
 * 시즌 말 승격·강등
 * @param topOrder 1부 최종 순위(팀 ID) · lowOrder 2부 최종 순위 · teamsById 두 리그 팀
 * @returns { down: [1부→2부], up: [2부→1부], playoff }
 */
export function promoteRelegate(topOrder, lowOrder, teamsById, seasonNo = 1) {
  const down = topOrder.slice(-DOWN)
  const po = playoff(lowOrder, teamsById, seasonNo)
  const up = [...lowOrder.slice(0, 2), ...(po ? [po.winner] : [lowOrder[2]])]
  return { down, up, playoff: po }
}

/** 강등 직후 재정: 중계권이 크게 줄지만 '낙하산 지원금'이 2시즌 나온다 (실제 프리미어리그와 같은 구조) */
export const RELEGATION_REVENUE = [0.5, 0.42, 0.34] // 강등 1시즌째·2시즌째·그 뒤 (1부 시절 매출 대비)
