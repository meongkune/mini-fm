import { useEffect, useState } from 'react'
import { useGame } from '../store.jsx'
import { TALK_ACTIONS } from '../game/season.js'
import NeedTeam from './NeedTeam.jsx'
import TalkRoom from '../components/TalkRoom.jsx'
import { situationOf } from '../game/aiTalk.js'
import TalkLog, { talkOf } from '../components/TalkLog.jsx'

const NL = String.fromCharCode(10)
export const ICON = { 'talk-log': '🗣️', offer: '💰', contract: '📝', finance: '💼', owner: '🏢', press: '📰', talk: '💬', promise: '💔', request: '✈️', sulk: '😤', injury: '🚑', susp: '🟥', mom: '🏅', board: '🏛️', trade: '🔄', season: '🏁', youth: '🌱', cup: '🏆' }
// 메시지 분류: 색·필터
export const CAT = {
  squad: ['선수단', ['injury', 'susp', 'mom', 'sulk', 'request', 'talk', 'talk-log', 'promise', 'youth', 'contract']],
  transfer: ['이적', ['offer', 'trade']],
  club: ['재정·구단', ['finance', 'owner', 'board', 'press']],
  season: ['시즌·대회', ['season', 'cup']],
}
export const catOf = (type) => Object.entries(CAT).find(([, [, ts]]) => ts.includes(type))?.[0] || 'club'
/** 답(선택)이 필요한 메시지 */
export const needsAnswer = (m) => !m.resolved && (m.type === 'talk' || !!m.actions)
/** 미리보기 한 줄 */
export const preview = (m, n = 70) => { const t = (m.type === 'talk-log' ? (m.body || '').split(NL)[0] : m.body || '').replace(/\s+/g, ' '); return t.length > n ? `${t.slice(0, n)}…` : t }

export default function Inbox() {
  const { myTeam, save, readInbox, answerTalk, answerOffer, finishTalk, ignoreTalk, status, totalRounds, contractOf } = useGame()
  const [battle, setBattle] = useState(null) // 면담 요청 메일
  const [log, setLog] = useState(null) // 다시 볼 면담 기록
  const [filter, setFilter] = useState('all')
  const [open, setOpen] = useState(null) // 펼친 메시지
  const items = save.inbox || []
  // 열어 보면 (선택이 필요한 메시지를 빼고) 읽음 처리
  useEffect(() => {
    if (items.some((x) => !x.read && !needsAnswer(x))) {
      const t = setTimeout(() => items.filter((x) => !x.read && !needsAnswer(x)).forEach((x) => readInbox(x.id)), 600)
      return () => clearTimeout(t)
    }
  }, [items.length])
  if (!myTeam) return <NeedTeam />

  const todo = items.filter(needsAnswer)
  const shown = items.filter((m) => (filter === 'all' ? !needsAnswer(m) : filter === 'todo' ? needsAnswer(m) : catOf(m.type) === filter && !needsAnswer(m)))
  const count = (k) => items.filter((m) => !needsAnswer(m) && catOf(m.type) === k).length
  // 라운드별로 묶기
  const groups = []
  for (const m of shown) { const g = groups.at(-1); if (g && g.round === m.round) g.list.push(m); else groups.push({ round: m.round, list: [m] }) }

  const Mail = ({ m }) => {
    const t = talkOf(m)
    const isOpen = open === m.id || needsAnswer(m)
    return (
      <li className={`mail2 cat-${catOf(m.type)} ${m.read ? '' : 'unread'} ${needsAnswer(m) ? 'todo' : ''}`}>
        <button className="m2-head" onClick={() => setOpen(isOpen && !needsAnswer(m) ? null : m.id)}>
          <span className="m2-ico">{ICON[m.type] || '📩'}</span>
          <span className="m2-title"><strong>{m.title}</strong>{!isOpen && <small>{preview(m)}</small>}</span>
          {needsAnswer(m) ? <em className="m2-badge">답 필요</em> : !m.read && <i className="m2-dot" />}
        </button>
        {isOpen && (
          <div className="m2-body">
            {t ? (
              <div className="talk-sum">
                <span>{m.type === 'talk-log' ? (m.body || '').split(NL)[0] : m.reply}</span>
                <button className="btn small" onClick={() => setLog(t)}>💬 대화 보기 ({t.lines.length})</button>
              </div>
            ) : <p>{m.body}</p>}
            {m.actions && !m.resolved && m.type !== 'talk' && (
              <div className="options">
                {m.actions.map(([k, label, desc]) => (
                  <button key={k} className="option" onClick={() => (m.offer ? answerOffer(m.id, k) : answerTalk(m.id, k))}>
                    <strong>{label}</strong><span className="small muted">{desc}</span>
                  </button>
                ))}
              </div>
            )}
            {m.offer && !m.resolved && m.actions?.some(([k]) => k === 'counter') && <AskBox offer={m.offer} onAsk={(v) => answerOffer(m.id, 'counter', v)} />}
            {!m.resolved && m.type === 'talk' && (
              <>
                <div className="row talk-choice">
                  <button className="btn talk-start" onClick={() => setBattle(m)}>🗣️ 지금 면담하기</button>
                  <button className="btn ghost" onClick={() => ignoreTalk(m.id)}>🙅 넘기기</button>
                </div>
                <p className="small muted" style={{ margin: '4px 0 0' }}>다음 경기 전에 답하지 않으면 넘긴 것으로 처리됩니다 (그 선수 사기 −4).</p>
              </>
            )}
            {m.resolved === 'ignored' && (
              <div className="ignored-note">
                <span>🙅 {m.ignoredByChoice ? '넘김' : '답하지 않음'} · {(m.ignoredAt ?? m.round) + 1}라운드 · 사기 −4</span>
                {myTeam.players.some((p) => p.id === m.playerId) && <button className="btn small ghost" onClick={() => setBattle(m)}>지금이라도 면담</button>}
              </div>
            )}
            {m.said && !t && <p className="small muted">내가 한 말: "{m.said}"</p>}
            {m.resolved && m.resolved !== 'ignored' && m.reply && !t && <p className="notice">{(m.actions || TALK_ACTIONS).find((a) => a[0] === m.resolved)?.[1] ?? '답변'} → {m.reply}</p>}
          </div>
        )}
      </li>
    )
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>메시지함</h1>
          <p className="muted">줄을 누르면 내용이 펼쳐집니다.</p>
        </div>
      </div>
      {items.length === 0 && <div className="card muted">아직 소식이 없습니다. 경기를 치르면 하나둘 도착합니다.</div>}

      {todo.length > 0 && filter === 'all' && (
        <div className="card todo-box">
          <h3>⚡ 답이 필요한 메시지 <b>{todo.length}</b></h3>
          <ul className="inbox2">{todo.map((m) => <Mail key={m.id} m={m} />)}</ul>
        </div>
      )}

      <div className="chips-scroll inbox-filter">
        <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>전체</button>
        {todo.length > 0 && <button className={`chip ${filter === 'todo' ? 'on' : ''}`} onClick={() => setFilter('todo')}>⚡ 답 필요 {todo.length}</button>}
        {Object.entries(CAT).map(([k, [label]]) => count(k) > 0 && <button key={k} className={`chip cat-chip cat-${k} ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{label} {count(k)}</button>)}
      </div>

      {groups.map((g) => (
        <div key={`${g.round}-${g.list[0].id}`} className="inbox-group">
          <h4 className="ig-head">{g.round + 1}라운드</h4>
          <ul className="inbox2">{g.list.map((m) => <Mail key={m.id} m={m} />)}</ul>
        </div>
      ))}

      {battle && (() => {
        const p = myTeam.players.find((x) => x.id === battle.playerId)
        if (!p) return null
        return (
          <TalkRoom player={p} team={myTeam} status={status[p.id]} reason={battle.body} topic={battle.topic || 'minutes'}
            wage={contractOf(p).wage} totalRounds={totalRounds}
            situation={situationOf(p, myTeam, status[p.id] || {}, { inLineup: save.lineup.includes(p.id), round: save.round, apps: save.pstats?.[p.id]?.apps ?? 0 })}
            onClose={() => setBattle(null)}
            onFinish={(r) => { finishTalk(p.id, r, battle.id); setBattle(null) }} />
        )
      })()}
      {log && <TalkLog talk={log} onClose={() => setLog(null)} />}
    </section>
  )
}

/** 판매 제안에 직접 원하는 금액을 적어 역제안 */
function AskBox({ offer, onAsk }) {
  const [v, setV] = useState(Math.round((offer.ask ?? offer.fee * 1.2) * 10) / 10)
  return (
    <div className="ask-box">
      <span className="small">💬 직접 금액 요구</span>
      <input type="number" min={0} step={0.5} value={v} onChange={(e) => setV(Number(e.target.value))} />
      <span className="small muted">€M</span>
      <button className="btn small" disabled={!(v > 0)} onClick={() => onAsk(v)}>이 금액 요구</button>
      <small className="muted">제안 {offer.fee}M · 너무 높게 부르면 협상이 깨질 수 있습니다</small>
    </div>
  )
}
