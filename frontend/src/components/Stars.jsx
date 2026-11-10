// 별점 (0.5~5, 반 개 단위) — FM처럼 OVR 숫자 대신 코치 평가로 보여준다
import { playerOvrOf } from '../engine/engine.js'
import { starsOf } from '../game/attributes.js'
import { potentialOf } from '../game/trade.js'

/** 현재 능력·잠재력 별점 */
export const abilityStars = (p) => starsOf(playerOvrOf(p))
export const potentialStarsOf = (p) => Math.max(abilityStars(p), starsOf(potentialOf(p)))
export const starText = (v) => `★${Number.isInteger(v) ? v : v.toFixed(1)}`

/** compact: '★3.5'처럼 짧게 (좁은 칸) · 아니면 별 5개 */
export default function Stars({ value, compact = false, tone = 'cur', title }) {
  if (compact) return <span className={`stars compact ${tone}`} title={title}>{starText(value)}</span>
  return (
    <span className={`stars ${tone}`} title={title ?? `${value} / 5`} aria-label={`별 ${value}개`}>
      {[1, 2, 3, 4, 5].map((i) => <i key={i} className={value >= i ? 'full' : value >= i - 0.5 ? 'half' : ''}>★</i>)}
    </span>
  )
}

/** 현재 능력 + 잠재력 두 줄 */
export function AbilityStars({ player }) {
  const cur = abilityStars(player)
  const pot = potentialStarsOf(player)
  return (
    <span className="ability-stars">
      <span><em>현재 능력</em><Stars value={cur} /></span>
      <span><em>잠재력</em><Stars value={pot} tone="pot" /></span>
    </span>
  )
}
