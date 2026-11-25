// 세부 능력치 3층 (실제 경기 기록 기반) — 플레이 스타일 태그 + 1~20점 막대. 기록이 없어 레이더로 추정한 항목은 ~ 표시
import { detailOf, styleTags, to20 } from '../game/attributes.js'

const tone = (v) => (v >= 85 ? 'elite' : v >= 78 ? 'good' : v >= 70 ? 'ok' : 'low')
// 뒤의 4개는 '결과 능력치'(속도·활동량·공격성처럼 직접 잴 수 없는 능력을 기록이 남긴 흔적으로)
const RESULT = new Set(['침투', '운반', '압박', '투쟁심'])

export default function DetailAttrs({ player }) {
  const d = detailOf(player)
  const tags = styleTags(player)
  const anyEst = d.est.some(Boolean)
  return (
    <div className="detail-attrs">
      {tags.length > 0 && (
        <div className="da-tags" aria-label="플레이 스타일">
          {tags.map((t) => <span key={t.tag} className="chip on" title={`${t.label} ${to20(t.v)}`}>{t.tag}</span>)}
        </div>
      )}
      <ul className="ar-list da-list">
        {d.labels.map((l, i) => (
          <li key={l} className={`${d.est[i] ? 'est' : ''} ${RESULT.has(l) ? 'res' : ''}`}>
            <span>{l}</span>
            <i className={tone(d.values[i])} style={{ width: `${((d.values[i] - 30) / 69) * 100}%` }} />
            <b>{to20(d.values[i])}{d.est[i] ? '~' : ''}</b>
          </li>
        ))}
      </ul>
      <p className="small muted da-note">
        침투·운반·압박·투쟁심은 속도·활동량처럼 직접 잴 수 없는 능력을 경기 기록으로 매긴 값입니다.{anyEst ? ' ~ 표시는 기록이 부족해 추정한 값입니다.' : ''}
      </p>
    </div>
  )
}
