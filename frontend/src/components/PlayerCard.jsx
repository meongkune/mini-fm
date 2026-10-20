import { playerOvr } from '../store.jsx'
import { Flag, Kit } from './Badges.jsx'
import { roleOf } from '../engine/formation.js'

// OVR 기준 선수 등급 — 카드 색을 정한다
export function tierOf(ovr) {
  if (ovr >= 88) return 'elite'
  if (ovr >= 82) return 'gold'
  if (ovr >= 76) return 'silver'
  return 'bronze'
}

// 카드에는 성(마지막 단어)만 크게 — 전체 이름은 툴팁
const lastName = (name) => name.split(' ').at(-1)

/** FC 스타일 세로형 선수 카드. size: 'sm'(스쿼드 그리드) | 'lg'(홈 가로 스크롤) */
/** status를 주면 카드 아래에 컨디션 막대와 부상·징계·사기 표시 */
export default function PlayerCard({ player, selected = false, onClick, size = 'sm', status = null, color = null }) {
  const ovr = playerOvr(player)
  const tier = tierOf(ovr)
  return (
    <button
      type="button"
      className={`pcard tier-${tier} ${size} ${selected ? 'on' : ''} ${status && (status.inj > 0 || status.susp > 0) ? 'out' : ''}`}
      onClick={onClick}
      aria-pressed={onClick ? selected : undefined}
      title={`${player.name} · ${player.pos} · OVR ${ovr} · ${player.age}세`}
    >
      <span className="pc-top">
        <span className="pc-ovr">{ovr}</span>
        <span className="pc-pos">{roleOf(player)}</span>
        <span className="pc-flag-img"><Flag nation={player.nation} size={size === 'lg' ? 18 : 14} /></span>
      </span>
      {color ? <span className="pc-kit"><Kit color={color} number={player.number} size={size === 'lg' ? 52 : 40} /></span> : <span className="pc-badge" aria-hidden="true">{player.number}</span>}
      <span className="pc-name">{lastName(player.name)}</span>
      <span className="pc-stats">
        <span><b>{player.att}</b><em>공격</em></span>
        <span><b>{player.def}</b><em>수비</em></span>
        <span><b>{player.sta}</b><em>체력</em></span>
      </span>
      {selected && <span className="pc-check" aria-hidden="true">✓</span>}
      {status && (
        <span className="pc-state">
          <span className="pc-cond"><i style={{ width: `${Math.round(status.cond ?? 100)}%` }} className={(status.cond ?? 100) >= 80 ? 'hi' : (status.cond ?? 100) >= 60 ? 'mid' : 'lo'} /></span>
          {status.inj > 0 && <em className="pc-flag">🚑{status.inj}</em>}
          {status.susp > 0 && <em className="pc-flag">🟥{status.susp}</em>}
          {!(status.inj > 0) && !(status.susp > 0) && (status.morale ?? 60) < 40 && <em className="pc-flag">{(status.morale ?? 60) < 25 ? '😠' : '🙁'}</em>}
        </span>
      )}
    </button>
  )
}
