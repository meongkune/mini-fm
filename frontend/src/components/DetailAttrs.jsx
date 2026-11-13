// 세부 능력치 3층 (실제 경기 기록 기반) — 1~20점 막대. 기록이 없어 레이더로 추정한 항목은 ~ 표시
import { detailOf, to20 } from '../game/attributes.js'

const tone = (v) => (v >= 85 ? 'elite' : v >= 78 ? 'good' : v >= 70 ? 'ok' : 'low')

export default function DetailAttrs({ player }) {
  const d = detailOf(player)
  const anyEst = d.est.some(Boolean)
  return (
    <div className="detail-attrs">
      <ul className="ar-list da-list">
        {d.labels.map((l, i) => (
          <li key={l} className={d.est[i] ? 'est' : ''}>
            <span>{l}</span>
            <i className={tone(d.values[i])} style={{ width: `${((d.values[i] - 30) / 69) * 100}%` }} />
            <b>{to20(d.values[i])}{d.est[i] ? '~' : ''}</b>
          </li>
        ))}
      </ul>
      {anyEst && <p className="small muted da-note">~ 표시: 실제 기록이 부족해 레이더로 추정한 값</p>}
    </div>
  )
}
