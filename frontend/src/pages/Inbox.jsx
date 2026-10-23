import { useEffect, useState } from 'react'
import { useGame } from '../store.jsx'
import { TALK_ACTIONS } from '../game/season.js'
import NeedTeam from './NeedTeam.jsx'
import TalkRoom from '../components/TalkRoom.jsx'
import { situationOf } from '../game/aiTalk.js'

const ICON = { offer: '💰', contract: '📝', finance: '💼', press: '📰', talk: '💬', promise: '💔', request: '✈️', injury: '🚑', susp: '🟥', mom: '⭐', board: '🏛️', trade: '🔄', season: '🏁', youth: '🌱' }

export default function Inbox() {
  const { myTeam, save, readInbox, answerTalk, answerOffer, finishTalk, status, totalRounds, contractOf } = useGame()
  const [battle, setBattle] = useState(null) // 면담 요청 메일
  const items = save.inbox || []
  // 열어 보면 (선택이 필요한 면담을 빼고) 읽음 처리
  useEffect(() => {
    if (items.some((x) => !x.read && !(x.actions && !x.resolved))) {
      const t = setTimeout(() => items.filter((x) => !x.read && !(x.actions && !x.resolved)).forEach((x) => readInbox(x.id)), 600)
      return () => clearTimeout(t)
    }
  }, [items.length])
  if (!myTeam) return <NeedTeam />

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>받은 편지함</h1>
          <p className="muted">면담 요청·부상·징계·이적·보드 소식이 여기에 쌓입니다.</p>
        </div>
      </div>
      {items.length === 0 && <div className="card muted">아직 소식이 없습니다. 경기를 치르면 하나둘 도착합니다.</div>}
      <ul className="inbox">
        {items.map((m) => (
          <li key={m.id} className={`mail ${m.read ? '' : 'unread'} ${m.type}`}>
            <span className="mail-ico">{ICON[m.type] || '📩'}</span>
            <div className="mail-body">
              <div className="mail-head"><strong>{m.title}</strong><span className="muted small">{m.round + 1}R</span></div>
              <p>{m.body}</p>
              {m.actions && !m.resolved && m.type !== 'talk' && (
                <div className="options">
                  {m.actions.map(([k, label, desc]) => (
                    <button key={k} className="option" onClick={() => (m.offer ? answerOffer(m.id, k) : answerTalk(m.id, k))}>
                      <strong>{label}</strong><span className="small muted">{desc}</span>
                    </button>
                  ))}
                </div>
              )}
              {!m.resolved && m.type === 'talk' && <button className="btn wide talk-start" onClick={() => setBattle(m)}>🗣️ 면담하기</button>}
              {m.transcript && <details className="small muted"><summary>대화 내용</summary><pre className="transcript">{m.transcript}</pre></details>}
              {m.said && <p className="small muted">내가 한 말: "{m.said}"</p>}
              {m.resolved && m.reply && <p className="notice">{(m.actions || TALK_ACTIONS).find((a) => a[0] === m.resolved)?.[1] ?? '답변'} → {m.reply}</p>}
            </div>
          </li>
        ))}
      </ul>
      {battle && (() => {
        const p = myTeam.players.find((x) => x.id === battle.playerId)
        if (!p) return null
        return (
          <TalkRoom player={p} team={myTeam} status={status[p.id]} reason={battle.body} topic={battle.topic || 'minutes'}
            wage={contractOf(p).wage} totalRounds={totalRounds}
            situation={situationOf(p, myTeam, status[p.id] || {}, { inLineup: save.lineup.includes(p.id) })}
            onClose={() => setBattle(null)}
            onFinish={(r) => { finishTalk(p.id, r, battle.id); setBattle(null) }} />
        )
      })()}
    </section>
  )
}
