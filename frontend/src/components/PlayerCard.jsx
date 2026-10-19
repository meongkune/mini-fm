import { playerOvr } from '../store.jsx'

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
export default function PlayerCard({ player, selected = false, onClick, size = 'sm' }) {
  const ovr = playerOvr(player)
  const tier = tierOf(ovr)
  return (
    <button
      type="button"
      className={`pcard tier-${tier} ${size} ${selected ? 'on' : ''}`}
      onClick={onClick}
      aria-pressed={onClick ? selected : undefined}
      title={`${player.name} · ${player.pos} · OVR ${ovr} · ${player.age}세`}
    >
      <span className="pc-top">
        <span className="pc-ovr">{ovr}</span>
        <span className="pc-pos">{player.pos}</span>
      </span>
      <span className="pc-badge" aria-hidden="true">{player.number}</span>
      <span className="pc-name">{lastName(player.name)}</span>
      <span className="pc-stats">
        <span><b>{player.att}</b><em>공격</em></span>
        <span><b>{player.def}</b><em>수비</em></span>
        <span><b>{player.sta}</b><em>체력</em></span>
      </span>
      {selected && <span className="pc-check" aria-hidden="true">✓</span>}
    </button>
  )
}
