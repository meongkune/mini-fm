import { useMemo, useState } from 'react'
import { Crest } from './League.jsx'
import NeedTeam from './NeedTeam.jsx'
import { CondBar } from '../components/Rating.jsx'
import { MAX_PER_SIDE, PATIENCE, money, potentialStars, valueOf } from '../game/trade.js'
import { playerOvr, short, useGame } from '../store.jsx'

const POS = ['전체', 'GK', 'DF', 'MF', 'FW']
const SORTS = [['ovr', 'OVR'], ['value', '가치'], ['pot', '잠재력'], ['age', '나이']]
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n)

export default function Transfer() {
  const { myTeam, teams, teamsById, status, save, update, proposeTrade, doTrade, transferWindow, totalRounds } = useGame()
  const [tab, setTab] = useState('buy')
  const [pos, setPos] = useState('전체')
  const [teamFilter, setTeamFilter] = useState('all')
  const [sort, setSort] = useState('ovr')
  const [q, setQ] = useState('')
  const [give, setGive] = useState([])
  const [get, setGet] = useState([])
  const [theirId, setTheirId] = useState(null)
  const [reply, setReply] = useState(null)
  const [toast, setToast] = useState('')

  const market = useMemo(() => {
    if (!myTeam) return []
    return teams.filter((t) => t.id !== myTeam.id).flatMap((t) => t.players.map((p) => ({ p, t, v: valueOf(p, status[p.id]), pot: potentialStars(p) })))
  }, [teams, myTeam, status])
  if (!myTeam) return <NeedTeam />

  const sorter = { ovr: (a, b) => playerOvr(b.p) - playerOvr(a.p), value: (a, b) => b.v - a.v, pot: (a, b) => b.pot - a.pot || a.p.age - b.p.age, age: (a, b) => a.p.age - b.p.age }[sort]
  const list = market
    .filter(({ p, t }) => (pos === '전체' || p.pos === pos) && (teamFilter === 'all' || t.id === teamFilter) && (!q || p.name.toLowerCase().includes(q.toLowerCase())))
    .sort(sorter)
    .slice(0, 60)
  const mineList = [...myTeam.players].map((p) => ({ p, v: valueOf(p, status[p.id]), pot: potentialStars(p) })).sort((a, b) => playerOvr(b.p) - playerOvr(a.p))
  const byId = Object.fromEntries(teams.flatMap((t) => t.players).map((p) => [p.id, p]))
  const sum = (ids) => ids.reduce((s, id) => s + valueOf(byId[id], status[id]), 0)
  const talkKey = `${save.seasonNo || 1}-${transferWindow.label}-${[...get].sort().join(',')}`
  const tries = save.tradeTalks?.[talkKey] || 0

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2200) }
  const toggleGet = (p, t) => {
    setReply(null)
    if (get.includes(p.id)) { setGet(get.filter((x) => x !== p.id)); if (get.length === 1) setTheirId(null); return }
    if (theirId && theirId !== t.id) { setGet([p.id]); setTheirId(t.id); flash(`${short(t)} 선수로 바꿨습니다 (한 번에 한 구단과만 협상)`); return }
    if (get.length >= MAX_PER_SIDE) return flash(`받을 선수는 최대 ${MAX_PER_SIDE}명입니다`)
    setGet([...get, p.id]); setTheirId(t.id)
  }
  const toggleGive = (p) => {
    setReply(null)
    if (give.includes(p.id)) return setGive(give.filter((x) => x !== p.id))
    if (give.length >= MAX_PER_SIDE) return flash(`줄 선수는 최대 ${MAX_PER_SIDE}명입니다`)
    setGive([...give, p.id])
  }
  const propose = () => {
    if (tries >= PATIENCE) return
    const r = proposeTrade(theirId, give, get)
    const n = tries + 1
    update({ tradeTalks: { ...(save.tradeTalks || {}), [talkKey]: n } })
    setReply(n >= PATIENCE && r.verdict !== 'accept' ? { ...r, verdict: 'reject', reason: `${r.reason} 더 이상 협상하지 않겠다고 합니다. (협상 결렬)` } : r)
  }
  const confirmDeal = (extra = []) => {
    const finalGive = [...give, ...extra]
    doTrade(theirId, finalGive, get)
    flash(`트레이드 완료: ${get.map((id) => byId[id].name).join(', ')} 영입!`)
    setGive([]); setGet([]); setTheirId(null); setReply(null)
  }
  const reset = () => { setGive([]); setGet([]); setTheirId(null); setReply(null) }
  const their = theirId ? teamsById[theirId] : null
  const offerV = sum(give)
  const askV = sum(get)

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>이적 시장</h1>
          <p className="muted">이적료 없이 선수끼리 맞바꾸는 트레이드 · 한 번에 최대 {MAX_PER_SIDE}대{MAX_PER_SIDE}</p>
        </div>
        <span className={`pill ${transferWindow.open ? 'ok' : 'bad'}`}>{transferWindow.open ? `🟢 ${transferWindow.label}` : '🔒 닫힘'}</span>
      </div>
      {!transferWindow.open && (
        <p className="notice">지금은 이적 시장이 닫혀 있습니다. {transferWindow.next !== null ? `${transferWindow.next + 1}라운드부터 겨울 이적 시장이 열립니다.` : '시즌이 끝나고 다음 시즌 초반에 다시 열립니다.'} 선수 탐색은 계속할 수 있습니다.</p>
      )}

      {/* 협상 테이블 */}
      <div className="card deal">
        <div className="deal-cols">
          <div>
            <span className="eyebrow">받을 선수 {their && <>· <Crest team={their} size={16} /> {short(their)}</>}</span>
            {get.length ? get.map((id) => <DealChip key={id} p={byId[id]} v={valueOf(byId[id], status[id])} onRemove={() => toggleGet(byId[id], their)} />) : <p className="muted small">아래 목록에서 영입할 선수를 고르세요</p>}
          </div>
          <span className="deal-arrow">⇄</span>
          <div>
            <span className="eyebrow">줄 선수 · {short(myTeam)}</span>
            {give.length ? give.map((id) => <DealChip key={id} p={byId[id]} v={valueOf(byId[id], status[id])} onRemove={() => toggleGive(byId[id])} />) : <p className="muted small">"내 선수 내보내기" 탭에서 고르세요</p>}
          </div>
        </div>
        {(get.length > 0 || give.length > 0) && (
          <div className="deal-value">
            <div className="dv-bar"><span style={{ width: `${Math.min(100, askV ? (offerV / (askV * 1.12)) * 100 : 0)}%` }} className={offerV >= askV * 1.12 ? 'ok' : offerV >= askV * 0.8 ? 'mid' : 'lo'} /></div>
            <div className="dv-labels"><span>내 제안 {money(offerV)}</span><span>상대 선수 가치 {money(askV)}</span></div>
          </div>
        )}
        {reply && (
          <div className={`deal-reply ${reply.verdict}`}>
            <strong>{their?.name}</strong>
            <p>{reply.reason}</p>
            {reply.verdict === 'accept' && <button className="btn wide" onClick={() => confirmDeal()}>✍️ 계약 확정</button>}
            {reply.verdict === 'counter' && (
              <div className="row">
                <button className="btn" onClick={() => confirmDeal(reply.ask)}>{byId[reply.ask[0]].name} 추가해서 확정</button>
                <button className="btn ghost" onClick={() => setReply(null)}>거절</button>
              </div>
            )}
          </div>
        )}
        <div className="row">
          <button className="btn ghost small" onClick={reset} disabled={!get.length && !give.length}>초기화</button>
          <button className="btn" disabled={!transferWindow.open || !get.length || !give.length || tries >= PATIENCE || reply?.verdict === 'accept'} onClick={propose}>
            {tries >= PATIENCE ? '협상 결렬' : `제안하기${tries ? ` (${tries}/${PATIENCE})` : ''}`}
          </button>
        </div>
      </div>
      {toast && <p className="toast">{toast}</p>}

      <div className="tabs-line">
        <button className={tab === 'buy' ? 'on' : ''} onClick={() => setTab('buy')}>영입 대상 찾기</button>
        <button className={tab === 'sell' ? 'on' : ''} onClick={() => setTab('sell')}>내 선수 내보내기</button>
      </div>

      {tab === 'buy' && (
        <>
          <div className="filters">
            <input className="search" placeholder="선수 이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option value="all">전체 구단</option>
              {teams.filter((t) => t.id !== myTeam.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="chips-scroll">
            {POS.map((x) => <button key={x} className={`chip ${pos === x ? 'on' : ''}`} onClick={() => setPos(x)}>{x}</button>)}
            <span className="chip-sep" />
            {SORTS.map(([k, l]) => <button key={k} className={`chip ${sort === k ? 'on' : ''}`} onClick={() => setSort(k)}>{l}순</button>)}
          </div>
          <div className="card flush">
            <ul className="mk">
              {list.map(({ p, t, v, pot }) => (
                <li key={p.id}>
                  <button className={`mk-row ${get.includes(p.id) ? 'on' : ''}`} onClick={() => toggleGet(p, t)}>
                    <Crest team={t} />
                    <span className="mk-name"><strong>{p.name}</strong><small>{short(t)} · {p.pos} · {p.age}세{status[p.id]?.inj > 0 ? ' · 🚑' : ''}</small></span>
                    <span className="mk-pot" title="스카우트 잠재력 평가">{stars(pot)}</span>
                    <span className="mk-ovr">{playerOvr(p)}</span>
                    <span className="mk-val">{money(v)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {tab === 'sell' && (
        <div className="card flush">
          <ul className="mk">
            {mineList.map(({ p, v, pot }) => (
              <li key={p.id}>
                <button className={`mk-row ${give.includes(p.id) ? 'on' : ''}`} onClick={() => toggleGive(p)}>
                  <span className="lu-pos">{p.pos}</span>
                  <span className="mk-name"><strong>{p.name}{status[p.id]?.wantsOut ? ' ✈️' : ''}</strong><small>{p.age}세 · 출전 {save.pstats?.[p.id]?.apps ?? 0}경기 <CondBar value={status[p.id]?.cond} /></small></span>
                  <span className="mk-pot">{stars(pot)}</span>
                  <span className="mk-ovr">{playerOvr(p)}</span>
                  <span className="mk-val">{money(v)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(save.tradeLog || []).length > 0 && (
        <div className="card">
          <h3>이번 시즌 트레이드</h3>
          <ul className="trade-log">
            {save.tradeLog.slice().reverse().map((t, i) => (
              <li key={i}><span className="muted small">{t.round + 1}R</span> <Crest team={teamsById[t.with]} size={16} /> {t.get.map((id) => byId[id]?.name ?? id).join(', ')} ⇄ {t.give.map((id) => byId[id]?.name ?? id).join(', ')}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="muted small">잠재력 ★은 스카우트 평가입니다. 어린 선수일수록 실제 성장 폭이 큽니다 · 총 {totalRounds}라운드 중 초반 4라운드·중반 4라운드에 이적 시장이 열립니다.</p>
    </section>
  )
}

function DealChip({ p, v, onRemove }) {
  return (
    <button className="deal-chip" onClick={onRemove} title="빼기">
      <span className="lu-pos">{p.pos}</span>
      <strong>{p.name}</strong>
      <span className="mk-ovr">{playerOvr(p)}</span>
      <em>{money(v)}</em>
      <i>×</i>
    </button>
  )
}
