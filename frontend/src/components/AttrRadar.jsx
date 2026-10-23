// 세부 능력치 레이더 (필드 5각형 · 골키퍼 4각형) + 숫자 막대
import { attrsOf } from '../game/attributes.js'

const tone = (v) => (v >= 85 ? 'elite' : v >= 78 ? 'good' : v >= 70 ? 'ok' : 'low')

export default function AttrRadar({ player, color = '#7c5cff', sta = null }) {
  const a = attrsOf(player)
  const n = a.values.length
  const R = 44
  const pt = (i, v) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n
    const r = (Math.max(30, Math.min(99, v)) - 30) / 69 * R
    return [50 + r * Math.cos(ang), 50 + r * Math.sin(ang)]
  }
  const ring = (v) => a.values.map((_, i) => pt(i, v).join(',')).join(' ')
  const shape = a.values.map((v, i) => pt(i, v).join(',')).join(' ')
  return (
    <div className="attr-radar">
      <svg viewBox="-14 -8 128 116" role="img" aria-label={`세부 능력치 ${a.labels.map((l, i) => `${l} ${a.values[i]}`).join(', ')}`}>
        {[50, 70, 90].map((v) => <polygon key={v} points={ring(v)} className="ar-ring" />)}
        {a.values.map((_, i) => { const [x, y] = pt(i, 99); return <line key={i} x1="50" y1="50" x2={x} y2={y} className="ar-axis" /> })}
        <polygon points={shape} className="ar-shape" style={{ '--c': color }} />
        {a.labels.map((l, i) => {
          const [x, y] = pt(i, 112)
          return <text key={l} x={x} y={y} className="ar-label" textAnchor="middle" dominantBaseline="middle">{l}</text>
        })}
      </svg>
      <ul className="ar-list">
        {a.labels.map((l, i) => (
          <li key={l}><span>{l}</span><i className={tone(a.values[i])} style={{ width: `${((a.values[i] - 30) / 69) * 100}%` }} /><b>{a.values[i]}</b></li>
        ))}
        {sta !== null && <li><span>체력</span><i className={tone(sta)} style={{ width: `${((sta - 30) / 69) * 100}%` }} /><b>{sta}</b></li>}
      </ul>
      {a.est && <p className="ar-est small muted">추정값 — 실제 데이터(SportsAPI 레이더)를 받으면 바뀝니다</p>}
    </div>
  )
}
