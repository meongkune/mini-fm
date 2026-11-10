// 포지션별 세부 능력치: SportsAPI 레이더를 게임용으로 바꾼 값(rad·gk)이 있으면 그대로, 없으면 공격·수비·역할로 추정
import { playerOvrOf } from '../engine/engine.js'
import { roleOf } from '../engine/formation.js'

const FIELD = ['공격', '기술', '전술', '수비', '창의성']
const GK = ['선방', '예측', '빌드업', '공중볼']
const clamp = (v) => Math.max(30, Math.min(99, Math.round(v)))
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }

// 역할별 성향 (추정용): [기술, 전술, 창의성] 보정
const BIAS = {
  ST: [0, -3, -2], LW: [3, -4, 2], RW: [3, -4, 2], AM: [3, 0, 5], CM: [2, 3, 1], DM: [-1, 5, -3],
  LM: [1, 0, 1], RM: [1, 0, 1], CB: [-5, 3, -8], LB: [-1, 1, -3], RB: [-1, 1, -3], LWB: [0, 0, -2], RWB: [0, 0, -2],
}
// 레이더 → 절대 척도 보정: [공격, 기술, 전술, 수비, 창의성]
const RAD_FW = [2, -1, -6, -20, -2]
const RAD_W = [0, 1, -6, -18, 0]
const RAD_FB = [-10, -5, -1, 0, -8]
const RAD_WB = [-6, -3, -2, -3, -5]
const RAD_SM = [-3, 0, -4, -10, -1]
const RAD_ROLE = {
  ST: RAD_FW, LW: RAD_W, RW: RAD_W, AM: [-3, 1, -3, -15, 2], LM: RAD_SM, RM: RAD_SM,
  CM: [-7, 0, 0, -6, -2], DM: [-12, -3, 1, 0, -7], LB: RAD_FB, RB: RAD_FB, LWB: RAD_WB, RWB: RAD_WB, CB: [-20, -9, 0, 2, -14],
}
// 포지션별로 카드에 보여줄 핵심 능력치
const KEY = {
  GK: ['선방', '예측', '공중볼'],
  CB: ['수비', '전술', '기술'], LB: ['수비', '공격', '전술'], RB: ['수비', '공격', '전술'], LWB: ['공격', '수비', '전술'], RWB: ['공격', '수비', '전술'],
  DM: ['수비', '전술', '기술'], CM: ['기술', '전술', '창의성'], AM: ['창의성', '기술', '공격'], LM: ['기술', '공격', '창의성'], RM: ['기술', '공격', '창의성'],
  LW: ['공격', '기술', '창의성'], RW: ['공격', '기술', '창의성'], ST: ['공격', '기술', '창의성'],
}

// 선수 객체마다 한 번만 계산 (경기 엔진이 1분마다 부른다)
const cache = new WeakMap()

/** 세부 능력치 → { labels, values, map(이름→값), est(추정 여부), gk } — 값은 30~99 (OVR과 같은 척도) */
export function attrsOf(p) {
  let c = cache.get(p)
  if (!c) { c = calcAttrs(p); cache.set(p, c) }
  return c
}
function calcAttrs(p) {
  const ovr = playerOvrOf(p)
  const role = roleOf(p)
  if (p.pos === 'GK' || role === 'GK') {
    const r = (k) => (hash(`${k}-${p.id}`) % 7) - 3
    const values = Array.isArray(p.gk) ? p.gk : [p.def, p.def - 1 + r('a'), ovr - 6 + r('b'), p.def - 2 + r('c')].map(clamp)
    return { labels: GK, values, map: Object.fromEntries(GK.map((l, i) => [l, values[i]])), est: !Array.isArray(p.gk), gk: true }
  }
  // SportsAPI 레이더는 '같은 포지션 안에서의 위치'다 (윙어의 수비 91 = 윙어 중 수비 기여 최상위).
  // 포지션별 기준을 더해 모든 포지션이 같은 척도가 되게 바꾼다 (예: 사카 수비 91 → 73, 홀란 수비 93 → 71)
  let values = Array.isArray(p.rad) ? p.rad.map((v, i) => clamp(v + (RAD_ROLE[role]?.[i] ?? 0))) : null
  if (!values) {
    const [t, ta, c] = BIAS[role] || [0, 0, 0]
    const r = (k) => (hash(`${k}-${p.id}`) % 5) - 2
    values = [p.att, ovr + t + r('t'), ovr + ta + r('ta'), p.def, ovr + c + r('c')].map(clamp)
  }
  return { labels: FIELD, values, map: Object.fromEntries(FIELD.map((l, i) => [l, values[i]])), est: !Array.isArray(p.rad), gk: false }
}

/** 카드에 보여줄 포지션 핵심 능력치 3개 [[이름, 값]] */
export function keyAttrs(p) {
  const a = attrsOf(p)
  return (KEY[roleOf(p)] || KEY.CM).map((k) => [k, a.map[k]])
}

/** FM식 1~20점: 30~99 척도를 바꾼다 (99 → 20, 85 → 15, 70 → 10, 55 → 5) */
export const to20 = (v) => Math.max(1, Math.min(20, Math.round((v - 40) / 3)))

/** 카드·목록에 보여줄 핵심 능력치 3개를 1~20점으로 */
export const keyAttrs20 = (p) => keyAttrs(p).map(([k, v]) => [k, to20(v)])

// 역할별로 중요한 능력치 비중 (FM의 역할 적합도처럼)
const W_WIDE_FW = { 공격: 0.35, 기술: 0.3, 창의성: 0.25, 전술: 0.05, 수비: 0.05 }
const W_WIDE_MF = { 기술: 0.3, 창의성: 0.25, 공격: 0.2, 전술: 0.15, 수비: 0.1 }
const W_FB = { 수비: 0.45, 전술: 0.25, 기술: 0.15, 공격: 0.15 }
const W_WB = { 수비: 0.3, 공격: 0.25, 기술: 0.25, 전술: 0.2 }
export const ROLE_W = {
  ST: { 공격: 0.5, 기술: 0.2, 창의성: 0.15, 전술: 0.1, 수비: 0.05 },
  LW: W_WIDE_FW, RW: W_WIDE_FW,
  AM: { 창의성: 0.35, 기술: 0.3, 공격: 0.25, 전술: 0.1 },
  LM: W_WIDE_MF, RM: W_WIDE_MF,
  CM: { 기술: 0.3, 전술: 0.3, 창의성: 0.2, 수비: 0.1, 공격: 0.1 },
  DM: { 전술: 0.35, 수비: 0.35, 기술: 0.2, 창의성: 0.1 },
  LB: W_FB, RB: W_FB, LWB: W_WB, RWB: W_WB,
  CB: { 수비: 0.6, 전술: 0.3, 기술: 0.1 },
  GK: { 선방: 0.55, 예측: 0.25, 공중볼: 0.12, 빌드업: 0.08 },
}

/** 그 역할에서의 능력 (30~99): 역할별 비중으로 세부 능력치를 더한다 */
export function roleScore(p, role) {
  const a = attrsOf(p)
  const w = ROLE_W[role]
  if (!w || a.gk !== (role === 'GK')) return playerOvrOf(p)
  let s = 0
  for (const k in w) s += w[k] * (a.map[k] ?? playerOvrOf(p))
  return s
}

/** 현재 능력·잠재력 별점 (0.5 ~ 5, 반 개 단위) — FM의 코치 평가처럼 숫자 대신 보여준다 */
export function starsOf(v) {
  const steps = [60, 64, 68, 72, 76, 79, 82, 85, 88]
  let s = 0.5
  for (const t of steps) if (v >= t) s += 0.5
  return s
}
