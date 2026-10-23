import { playerOvr } from '../store.jsx'
import { Flag, Kit } from './Badges.jsx'
import { fitTone, roleOf } from '../engine/formation.js'
import { unavailable } from '../game/season.js'
import { keyAttrs } from '../game/attributes.js'

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
/** slot을 주면 본 포지션과 다른 자리에서 뛸 때 'ST→LB'처럼 표시 (색 = 적합도) */
export default function PlayerCard({ player, selected = false, onClick, size = 'sm', status = null, color = null, slot = null }) {
  const ovr = playerOvr(player)
  const tier = tierOf(ovr)
  const out = status ? unavailable(status) : null
  const keys = { list: keyAttrs(player), est: !player.rad && !player.gk } // 포지션별 핵심 능력치 3개
  return (
    <button
      type="button"
      className={`pcard tier-${tier} ${size} ${selected ? 'on' : ''} ${out ? `out ${out.kind}` : ''}`}
      onClick={onClick}
      aria-pressed={onClick ? selected : undefined}
      title={`${player.name} · ${player.pos} · OVR ${ovr} · ${player.age}세${out ? ` · ${out.label}: ${out.text}` : ''}`}
    >
      <span className="pc-top">
        <span className="pc-ovr">{ovr}</span>
        <span className="pc-pos">{roleOf(player)}{slot && slot.role !== roleOf(player) && <i className={`pc-slot ${fitTone(slot.fit)}`} title={`${slot.role} 자리 · 능력 ${Math.round(slot.fit * 100)}% 발휘`}>→{slot.role}</i>}</span>
        <span className="pc-flag-img"><Flag nation={player.nation} size={size === 'lg' ? 18 : 14} /></span>
      </span>
      {color ? <span className="pc-kit"><Kit color={color} number={player.number} size={size === 'lg' ? 52 : 40} /></span> : <span className="pc-badge" aria-hidden="true">{player.number}</span>}
      <span className="pc-name">{lastName(player.name)}</span>
      <span className="pc-stats" title={keys.est ? '추정 능력치' : 'SportsAPI 레이더 기반'}>
        {keys.list.map(([k, v]) => <span key={k}><b>{v}</b><em>{k}</em></span>)}
      </span>
      {selected && <span className="pc-check" aria-hidden="true">✓</span>}
      {out && (
        <span className={`pc-out ${out.kind}`}>
          <b>{out.icon} {out.label}</b>
          {out.why !== out.label && <small>{out.why}</small>}
          <em>{out.games}경기</em>
        </span>
      )}
      {status && (
        <span className="pc-state">
          <span className="pc-cond"><i style={{ width: `${Math.round(status.cond ?? 100)}%` }} className={(status.cond ?? 100) >= 80 ? 'hi' : (status.cond ?? 100) >= 60 ? 'mid' : 'lo'} /></span>
          {!out && (status.morale ?? 60) < 40 && <em className="pc-flag">{(status.morale ?? 60) < 25 ? '😠' : '🙁'}</em>}
        </span>
      )}
    </button>
  )
}
