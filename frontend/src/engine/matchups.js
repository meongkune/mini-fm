// 개인 매치업: 팀 단위 전술 상성(tactics.js edges)과 별개로, 실제로 맞붙는 선수끼리 세부 능력치를 비교한다.
//   통로 4개 — 왼쪽 측면(우리 왼쪽 윙 vs 상대 오른쪽 수비), 오른쪽 측면, 중앙(공격수 vs 센터백), 공중볼(타깃 vs 센터백 높이)
//   엔진은 유리한 통로로 찬스가 더 자주·더 좋게 나게 하고, 화면은 "어디가 유리/불리한지"를 보여 준다.
//   선수 값은 경기 중 실효 능력치(체력·사기 반영, 30~99 척도)다 → 지친 풀백 쪽이 후반에 뚫린다.

const at = (p, k) => p.A?.[k] ?? (k === '수비' || k === '전술' ? p.def : p.att)
const avg = (v) => v.reduce((s, x) => s + x, 0) / v.length
// 돌파·크로스(측면 공격) / 마크(수비) / 마무리(중앙 공격)
export const wingOf = (p) => at(p, '공격') * 0.3 + at(p, '기술') * 0.4 + at(p, '창의성') * 0.3
export const markOf = (p) => at(p, '수비') * 0.6 + at(p, '전술') * 0.4
export const finishOf = (p) => at(p, '공격') * 0.6 + at(p, '기술') * 0.4
// 공중볼: 수비력·공격력·체력 + 자리(센터백·스트라이커가 강하고 윙어·공격형 미드가 약하다)
const AERIAL_ROLE = { CB: 8, ST: 5, DM: 2, CM: 0, LB: -3, RB: -3, LWB: -3, RWB: -3, LM: -4, RM: -4, AM: -5, LW: -7, RW: -7 }
export const aerialOf = (p) => p.def * 0.45 + p.att * 0.35 + (p.sta ?? 70) * 0.2 + (AERIAL_ROLE[p.slot] ?? 0)

export const CHANNEL_LABEL = { left: '왼쪽 측면', right: '오른쪽 측면', center: '중앙', air: '공중볼' }
// 측면에서 가장 앞에 서는 선수 / 그 쪽을 막는 선수 (없으면 다음 순서)
const WIDE_ATT = (s) => [`${s}W`, `${s}M`, `${s}WB`, `${s}B`]
const WIDE_DEF = (s) => [`${s}B`, `${s}WB`, `${s}M`]
const firstBy = (xi, roles) => { for (const r of roles) { const p = xi.find((x) => x.slot === r); if (p) return p } return null }
const who = (p, v) => (p ? { id: p.id, name: p.name, slot: p.slot, v } : null)

/**
 * 공격 팀(att) → 수비 팀(def)의 통로별 매치업
 *  att/def: 출전 선수 배열(xiOf의 xi — slot·A·att·def), tac: 공격 팀 전술(tacOf 결과: focus·width·passing)
 *  → [{ key, w(전술이 그 통로를 쓰는 비중), diff(공격 − 수비), adv(자기 통로 평균 대비), a, d, note }]
 */
export function channels(att, def, tac = {}) {
  const A = att.filter((p) => p.pos !== 'GK')
  const D = def.filter((p) => p.pos !== 'GK')
  const out = []
  const cbs = D.filter((p) => p.slot === 'CB')
  const back = cbs.length ? cbs : D.filter((p) => p.pos === 'DF')
  const backMark = back.length ? avg(back.map(markOf)) : 55
  const wideBias = ((tac.width ?? 50) - 50) / 50 * 0.4 + (tac.focus === 'wings' ? 0.5 : tac.focus === 'center' ? -0.3 : 0)
  for (const [key, mine, theirs] of [['left', 'L', 'R'], ['right', 'R', 'L']]) {
    const a = firstBy(A, WIDE_ATT(mine))
    if (!a) continue
    const d = firstBy(D, WIDE_DEF(theirs))
    // 그 쪽에 측면 수비수가 없으면 센터백이 끌려 나와 막는다 (불리)
    const dv = d ? markOf(d) * (d.slot.endsWith('M') ? 0.94 : 1) : backMark - 6
    out.push({ key, w: Math.max(0.3, 1 + wideBias), diff: wingOf(a) - dv, a: who(a, wingOf(a)), d: who(d, dv), note: d ? null : '측면 수비수가 없다' })
  }
  const sts = A.filter((p) => p.slot === 'ST')
  const fw = sts.length ? sts : A.filter((p) => p.slot === 'AM')
  if (fw.length && back.length) {
    const best = [...fw].sort((x, y) => finishOf(y) - finishOf(x))[0]
    const worst = [...back].sort((x, y) => markOf(x) - markOf(y))[0]
    // 숫자 싸움: 투톱 vs 센터백 둘이면 공격 쪽이 유리, 원톱 vs 스리백이면 불리
    const numbers = (fw.length - back.length + 1) * 2
    out.push({ key: 'center', w: 1.3 + (tac.focus === 'center' ? 0.6 : tac.focus === 'wings' ? -0.4 : 0), diff: avg(fw.map(finishOf)) - backMark + numbers, a: who(best, finishOf(best)), d: who(worst, markOf(worst)), note: numbers > 0 ? '공격수 숫자가 많다' : numbers < 0 ? '센터백 숫자가 많다' : null })
    const target = [...fw].sort((x, y) => aerialOf(y) - aerialOf(x))[0]
    const high = [...back].sort((x, y) => aerialOf(y) - aerialOf(x)).slice(0, 2)
    out.push({ key: 'air', w: Math.max(0.2, 0.6 + ((tac.passing ?? 50) - 50) / 50 * 0.6 + wideBias * 0.4), diff: aerialOf(target) - avg(high.map(aerialOf)), a: who(target, aerialOf(target)), d: who(high[0], aerialOf(high[0])), note: null })
  }
  const mean = out.length ? avg(out.map((c) => c.diff)) : 0
  for (const c of out) c.adv = c.diff - mean
  return out
}
