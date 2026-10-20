import { useEffect } from 'react'
import { useGame } from '../store.jsx'
import { TALK_ACTIONS } from '../game/season.js'
import NeedTeam from './NeedTeam.jsx'
import SayBox from '../components/SayBox.jsx'

const ICON = { talk: '💬', promise: '💔', request: '✈️', injury: '🚑', susp: '🟥', mom: '⭐', board: '🏛️', trade: '🔄', season: '🏁', youth: '🌱' }

export default function Inbox() {
  const { myTeam, save, readInbox, answerTalk, answerOffer, sayTo } = useGame()
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
              {m.actions && !m.resolved && (
                <div className="options">
                  {m.actions.map(([k, label, desc]) => (
                    <button key={k} className="option" onClick={() => (m.offer ? answerOffer(m.id, k) : answerTalk(m.id, k))}>
                      <strong>{label}</strong><span className="small muted">{desc}</span>
                    </button>
                  ))}
                </div>
              )}
              {m.actions && !m.resolved && m.type === 'talk' && <SayBox placeholder="또는 직접 답하기 (예: 꼬우면 이적해라)" onSay={(t) => sayTo(m.playerId, t, m.id)} />}
              {m.said && <p className="small muted">내가 한 말: "{m.said}"</p>}
              {m.resolved && m.reply && <p className="notice">{(m.actions || TALK_ACTIONS).find((a) => a[0] === m.resolved)?.[1] ?? '답변'} → {m.reply}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
