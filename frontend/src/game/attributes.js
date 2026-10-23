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
// 포지션별로 카드에 보여줄 핵심 능력치
const KEY = {
  GK: ['선방', '예측', '공중볼'],
  CB: ['수비', '전술', '기술'], LB: ['수비', '공격', '전술'], RB: ['수비', '공격', '전술'], LWB: ['공격', '수비', '전술'], RWB: ['공격', '수비', '전술'],
  DM: ['수비', '전술', '기술'], CM: ['기술', '전술', '창의성'], AM: ['창의성', '기술', '공격'], LM: ['기술', '공격', '창의성'], RM: ['기술', '공격', '창의성'],
  LW: ['공격', '기술', '창의성'], RW: ['공격', '기술', '창의성'], ST: ['공격', '기술', '창의성'],
}

/** 세부 능력치 → { labels, values, map(이름→값), est(추정 여부), gk } */
export function attrsOf(p) {
  const ovr = playerOvrOf(p)
  const role = roleOf(p)
  if (p.pos === 'GK' || role === 'GK') {
    const r = (k) => (hash(`${k}-${p.id}`) % 7) - 3
    const values = p.gk || [p.def, p.def - 1 + r('a'), ovr - 6 + r('b'), p.def - 2 + r('c')].map(clamp)
    return { labels: GK, values, map: Object.fromEntries(GK.map((l, i) => [l, values[i]])), est: !p.gk, gk: true }
  }
  let values = p.rad
  if (!values) {
    const [t, ta, c] = BIAS[role] || [0, 0, 0]
    const r = (k) => (hash(`${k}-${p.id}`) % 5) - 2
    values = [p.att, ovr + t + r('t'), ovr + ta + r('ta'), p.def, ovr + c + r('c')].map(clamp)
  }
  return { labels: FIELD, values, map: Object.fromEntries(FIELD.map((l, i) => [l, values[i]])), est: !p.rad, gk: false }
}

/** 카드에 보여줄 포지션 핵심 능력치 3개 [[이름, 값]] */
export function keyAttrs(p) {
  const a = attrsOf(p)
  return (KEY[roleOf(p)] || KEY.CM).map((k) => [k, a.map[k]])
}
