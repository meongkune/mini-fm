import { playerOvr } from '../store.jsx'

const POS_KO = { GK: 'GK', DF: 'DF', MF: 'MF', FW: 'FW' }

// OVR 기준 선수 등급 — 카드 색을 정한다
export function tierOf(ovr) {
  if (ovr >= 88) return 'elite'
  if (ovr >= 82) return 'gold'
  if (ovr >= 76) return 'silver'
  return 'bronze'
}

// 이름이 길면 성 + 마지막 단어만 (예: "가브리엘 마갈량이스" 그대로, "알렉산데르 이사크" 그대로, 3단어 이상만 줄임)
const shortName = (name) => {
  const parts = name.split(' ')
  return parts.length > 2 ? `${parts[0]} ${parts[parts.length - 1]}` : name
}

/** 선수 카드. size: 'sm'(스쿼드 그리드) | 'lg'(홈 핵심 선수) */
export default function PlayerCard({ player, selected = false, onClick, size = 'sm' }) {
  const ovr = playerOvr(player)
  const tier = tierOf(ovr)
  return (
    <button
      type="button"
      className={`pcard tier-${tier} ${size} ${selected ? 'on' : ''}`}
      onClick={onClick}
      aria-pressed={onClick ? selected : undefined}
      title={`${player.name} · ${player.pos} · OVR ${ovr}`}
    >
      <span className="pc-head">
        <span className="pc-ovr">{ovr}</span>
        <span className="pc-pos">{POS_KO[player.pos]}</span>
      </span>
      <span className="pc-num">{player.number}</span>
      <span className="pc-name">{shortName(player.name)}</span>
      <span className="pc-stats">
        <span><em>공</em>{player.att}</span>
        <span><em>수</em>{player.def}</span>
        <span><em>체</em>{player.sta}</span>
      </span>
      {selected && <span className="pc-check" aria-hidden="true">✓</span>}
    </button>
  )
}
