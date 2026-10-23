// 지난 면담 다시 보기: 면담실과 같은 말풍선 화면, 읽기 전용 (다음 라운드에 다시 면담할 수 있다)
import { OUTCOME_LABEL } from '../game/aiTalk.js'

/** 예전 방식(텍스트로만 저장된 대화)도 말풍선으로 바꿔 보여준다 */
export function talkOf(m) {
  if (m.talk) return m.talk
  const text = m.transcript || (m.type === 'talk-log' ? (m.body || '').split('\n\n').slice(1).join('\n\n') : '')
  if (!text) return null
  const lines = text.split('\n').filter(Boolean).map((l) => {
    const i = l.indexOf(': ')
    const who = i > 0 ? l.slice(0, i) : ''
    return { role: who === '감독' ? 'manager' : 'player', text: i > 0 ? l.slice(i + 2) : l }
  })
  const head = (m.type === 'talk-log' ? m.body : m.reply || '').split('\n')[0]
  return { player: m.title.replace(/^🗣️\s*/, '').split(' 면담')[0], topic: '', outcome: head, icon: '', lines, legacy: true }
}

export default function TalkLog({ talk, onClose }) {
  const res = OUTCOME_LABEL[Object.keys(OUTCOME_LABEL).find((k) => OUTCOME_LABEL[k][1] === talk.outcome)]
  const short = talk.player.split(' ').at(-1)
  return (
    <div className="tr-wrap" role="dialog" aria-label={`${talk.player} 면담 기록`} onClick={onClose}>
      <div className="tr-panel tl-panel" onClick={(e) => e.stopPropagation()}>
        <header className="tr-head">
          <span className="tr-topic">🗣️ {talk.player}{talk.topic ? ` · ${talk.topic}` : ''} 면담 기록</span>
          {talk.round !== undefined && <span className="muted small">{talk.round + 1}라운드</span>}
          <button className="tr-x" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        {!talk.legacy && (
          <div className="tl-sum">
            <strong>{res ? `${res[0]} ${res[1]}` : talk.outcome}</strong>
            <span>감독 신뢰 {talk.trustStart} → {talk.trustEnd}</span>
            <span className={talk.dMorale >= 0 ? 'good-text' : 'bad-text'}>사기 {talk.dMorale >= 0 ? '+' : ''}{talk.dMorale}</span>
            {talk.promise && <span className="warn-text">약속: {talk.promise}</span>}
            {!talk.ai && <span className="muted">규칙 기반 대화</span>}
          </div>
        )}
        {talk.legacy && <div className="tl-sum"><strong>{talk.outcome}</strong></div>}
        <div className="tr-log">
          {talk.lines.map((l, i) => (
            <div key={i} className={`tr-msg ${l.role}`}>
              <span className="tr-who">{l.role === 'manager' ? '감독' : short}{l.mood && <em> · {l.mood}</em>}</span>
              <p>{l.text}</p>
              {l.delta ? <span className={`tr-delta ${l.delta > 0 ? 'up' : 'down'}`}>신뢰 {l.delta > 0 ? '+' : ''}{l.delta}</span> : null}
            </div>
          ))}
        </div>
        <p className="tl-foot small muted">면담이 끝난 대화입니다. 다음 라운드에 다시 면담할 수 있습니다.</p>
      </div>
    </div>
  )
}
