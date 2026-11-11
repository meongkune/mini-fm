// 개인 매치업 표: 통로(왼쪽·오른쪽 측면, 중앙, 공중볼)마다 맞붙는 선수와 유불리를 보여 준다
// 경기 전(경기 화면·전술 화면)과 경기 중(전술 창)에 같이 쓴다. 경기 중에는 체력이 반영돼 지친 쪽이 불리해진다
import { matchupsOf } from '../engine/match.js'
import { to20 } from '../game/attributes.js'

const last = (n) => String(n || '').split(' ').at(-1)
const EDGE = 4 // 이 이상 차이 나면 유리/불리로 표시 (1~20 척도로 1점 남짓)

function Row({ c, mine }) {
  // 내 공격은 값이 클수록, 상대 공격은 값이 작을수록 우리에게 좋다
  const v = mine ? c.rel : -c.rel
  const tone = v >= EDGE ? 'good' : v <= -EDGE ? 'bad' : 'even'
  return (
    <li className={tone}>
      <span className="mu-lane">{c.label}</span>
      <span className="mu-duel">
        <b>{last(c.a?.name)}</b> <i>{to20(c.a?.v ?? 60)}</i>
        <em>vs</em>
        {c.d ? <><b>{last(c.d.name)}</b> <i>{to20(c.d.v)}</i></> : <b>빈 측면</b>}
      </span>
      <span className="mu-tag">{tone === 'good' ? '▲ 유리' : tone === 'bad' ? '▼ 불리' : '비슷'}</span>
      {c.note && <span className="mu-note">{c.note}</span>}
    </li>
  )
}

export default function Matchups({ match, ctx, myIdx, neutral = false }) {
  const mu = matchupsOf(match, ctx, myIdx, { neutral })
  if (!mu.attack.length && !mu.defend.length) return null
  const best = [...mu.attack].sort((a, b) => b.rel - a.rel)[0]
  const worst = [...mu.defend].sort((a, b) => b.rel - a.rel)[0]
  return (
    <div className="mu">
      <h4>내 공격 <span className="muted small">내 선수 vs 상대 수비</span></h4>
      <ul className="mu-list">{mu.attack.map((c) => <Row key={c.key} c={c} mine />)}</ul>
      <h4>상대 공격 <span className="muted small">상대 선수 vs 내 수비</span></h4>
      <ul className="mu-list">{mu.defend.map((c) => <Row key={c.key} c={c} mine={false} />)}</ul>
      <p className="small muted mu-tip">
        {best && best.rel >= EDGE ? `💡 ${best.label} 쪽이 뚫립니다 — ${best.key === 'air' ? '길게 올리는 패스' : best.key === 'center' ? '중앙 공격 집중' : '측면 공격 집중·넓은 폭'}으로 더 자주 쓸 수 있습니다. ` : ''}
        {worst && worst.rel >= EDGE ? `⚠️ 상대 ${worst.label}${worst.a ? `(${last(worst.a.name)})` : ''}에 밀립니다 — 그 자리 수비를 바꾸거나 체력을 확인하세요.` : ''}
        {!(best && best.rel >= EDGE) && !(worst && worst.rel >= EDGE) ? '뚜렷하게 기우는 매치업은 없습니다. 찬스는 유리한 통로에서 더 자주, 더 좋게 납니다.' : ''}
      </p>
    </div>
  )
}
