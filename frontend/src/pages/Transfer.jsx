// 이적 시장: 이적료로 영입(상대 구단 AI와 협상) · 판매 목록 등록(제안은 메시지함으로) · FA
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import FreeAgents from './FreeAgents.jsx'
import { Crest, Flag } from '../components/Badges.jsx'
import NeedTeam from './NeedTeam.jsx'
import { CondBar } from '../components/Rating.jsx'
import { PATIENCE, money, potentialStars, valueOf } from '../game/trade.js'
import { eur, wageBill, wageBudget } from '../game/finance.js'
import { playerOvr, short, useGame } from '../store.jsx'

const POS = ['전체', 'GK', 'DF', 'MF', 'FW']
const SORTS = [['ovr', 'OVR'], ['value', '가치'], ['pot', '잠재력'], ['age', '나이']]
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n)

export default function Transfer() {
  const { myTeam, teams, teamsById, status, save, data, transferWindow, totalRounds, toggleSale, valueFor, setAskPrice } = useGame()
  const [params] = useSearchParams()
  const [tab, setTab] = useState(params.get('tab') || 'buy')
  const [pos, setPos] = useState('전체')
  const [teamFilter, setTeamFilter] = useState('all')
  const [sort, setSort] = useState('ovr')
  const [q, setQ] = useState('')
  const [pick, setPick] = useState(null) // { p, t }

  const market = useMemo(() => {
    if (!myTeam) return []
    return teams.filter((t) => t.id !== myTeam.id).flatMap((t) => t.players.map((p) => ({ p, t, v: valueFor(p), pot: potentialStars(p) })))
  }, [teams, myTeam, status, save.pstats])
  if (!myTeam) return <NeedTeam />

  const sorter = { ovr: (a, b) => playerOvr(b.p) - playerOvr(a.p), value: (a, b) => b.v - a.v, pot: (a, b) => b.pot - a.pot || a.p.age - b.p.age, age: (a, b) => a.p.age - b.p.age }[sort]
  const list = market
    .filter(({ p, t }) => (pos === '전체' || p.pos === pos) && (teamFilter === 'all' || t.id === teamFilter) && (!q || p.name.toLowerCase().includes(q.toLowerCase())))
    .sort(sorter)
    .slice(0, 60)
  const mineList = [...myTeam.players].map((p) => ({ p, v: valueFor(p), pot: potentialStars(p) })).sort((a, b) => playerOvr(b.p) - playerOvr(a.p))
  const byId = Object.fromEntries(teams.flatMap((t) => t.players).map((p) => [p.id, p]))
  const f = save.finance || {}
  const bill = wageBill(save, myTeam, data.leagueId)
  const room = Math.max(0, wageBudget(f) - bill)
  const banned = f.ban === (save.seasonNo || 1)

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>이적 시장</h1>
          <p className="muted">이적료로 사고팝니다 · 상대 구단은 핵심 선수를 비싸게 부릅니다</p>
        </div>
        <span className={`pill ${transferWindow.open ? 'ok' : 'bad'}`}>{transferWindow.open ? `🟢 ${transferWindow.label}` : '🔒 닫힘'}</span>
      </div>
      <div className="budget-strip">
        <div><span>현금(이적 자금)</span><b className={(f.cash ?? 0) < 0 ? 'bad-text' : ''}>{eur(f.cash ?? 0)}</b></div>
        <div><span>임금 예산 여유</span><b className={room <= 0 ? 'bad-text' : ''}>{eur(room)}/년</b></div>
        <div><span>판매 목록</span><b>{(save.forSale || []).length}명</b></div>
      </div>
      {banned && <p className="notice bad">⚖️ FFP 위반 징계로 이번 시즌 영입이 금지돼 있습니다. 판매는 가능합니다.</p>}
      {!transferWindow.open && (
        <p className="notice">지금은 이적 시장이 닫혀 있습니다. {transferWindow.next !== null ? `${transferWindow.next + 1}라운드부터 겨울 이적 시장이 열립니다.` : '시즌이 끝나고 다음 시즌 초반에 다시 열립니다.'} 선수 탐색과 판매 목록 등록은 할 수 있습니다.</p>
      )}

      <div className="tabs-line">
        <button className={tab === 'buy' ? 'on' : ''} onClick={() => setTab('buy')}>영입</button>
        <button className={tab === 'sell' ? 'on' : ''} onClick={() => setTab('sell')}>판매</button>
        <button className={tab === 'fa' ? 'on' : ''} onClick={() => setTab('fa')}>FA 시장</button>
      </div>

      {tab === 'fa' && <FreeAgents />}

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
                  <button className="mk-row" onClick={() => setPick({ p, t })}>
                    <Crest team={t} />
                    <span className="mk-name"><strong><Flag nation={p.nation} size={14} /> {p.name}</strong><small>{short(t)} · {p.role || p.pos} · {p.age}세{status[p.id]?.inj > 0 ? ' · 🚑' : ''}</small></span>
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
        <>
          <p className="small muted">판매 목록에 올리고 희망 가격을 정하면, 이적 시장 기간에 다른 구단 제안이 메시지함으로 옵니다. 제안이 낮으면 '더 달라고 하기'로 협상하세요. 너무 높게 부르면 결렬될 수 있습니다. 급하게 팔려면 선수 상세의 "강제 매각"(몸값의 75~100%)을 쓰세요.</p>
          <div className="card flush">
            <ul className="mk">
              {mineList.map(({ p, v, pot }) => {
                const listed = (save.forSale || []).includes(p.id)
                return (
                  <li key={p.id}>
                    <div className={`mk-row ${listed ? 'on' : ''}`}>
                      <span className="lu-pos">{p.role || p.pos}</span>
                      <span className="mk-name"><strong><Flag nation={p.nation} size={14} /> {p.name}{status[p.id]?.wantsOut ? ' ✈️' : ''}</strong><small>{p.age}세 · 출전 {save.pstats?.[p.id]?.apps ?? 0}경기 <CondBar value={status[p.id]?.cond} /></small></span>
                      <span className="mk-ovr">{playerOvr(p)}</span>
                      <span className="mk-val">{money(v)}</span>
                      {listed && (
                        <label className="ask-price" title="희망 가격 (몸값 대비)">
                          <select value={Math.round(((save.askPrice?.[p.id] ?? v * 1.2) / v) * 10) / 10} onChange={(e) => setAskPrice(p.id, Math.round(v * Number(e.target.value) * 10) / 10)}>
                            {[0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5, 1.8, 2].map((k) => <option key={k} value={k}>{money(Math.round(v * k * 10) / 10)} ({Math.round(k * 100)}%)</option>)}
                          </select>
                        </label>
                      )}
                      <button className={`btn small ${listed ? '' : 'ghost'}`} onClick={() => { if (!listed && !save.askPrice?.[p.id]) setAskPrice(p.id, Math.round(v * 1.2 * 10) / 10); toggleSale(p.id) }}>{listed ? '판매 중' : '판매 등록'}</button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}

      {(save.tradeLog || []).some((t) => t.fee !== undefined) && (
        <div className="card">
          <h3>이번 시즌 이적</h3>
          <ul className="trade-log">
            {save.tradeLog.filter((t) => t.fee !== undefined).slice().reverse().map((t, i) => (
              <li key={i}><span className="muted small">{t.round + 1}R</span> {t.in ? <>📥 {byId[t.in]?.name ?? t.in} ← <Crest team={teamsById[t.from]} size={16} /></> : <>📤 {byId[t.out]?.name ?? t.out} → <Crest team={teamsById[t.to]} size={16} /></>} <b>{eur(t.fee)}</b></li>
            ))}
          </ul>
        </div>
      )}
      <p className="muted small">잠재력 ★은 스카우트 평가입니다 · 총 {totalRounds}라운드 중 초반 4라운드·중반 4라운드에 이적 시장이 열립니다.</p>
      {pick && <BidSheet p={pick.p} t={pick.t} onClose={() => setPick(null)} />}
    </section>
  )
}

/** 영입 협상: 이적료 제시 → 상대 구단 답 → 수락되면 계약 기간 정하고 확정 */
function BidSheet({ p, t, onClose }) {
  const { bidFor, signTransfer, wageFor, transferWindow, valueFor } = useGame()
  const v = valueFor(p)
  const [fee, setFee] = useState(Math.round(v * 10) / 10)
  const [years, setYears] = useState(p.age >= 31 ? 2 : 4)
  const [reply, setReply] = useState(null)
  const [done, setDone] = useState(null)
  const wage = Math.round(wageFor(p) * 1.15 * 10) / 10
  const offer = () => { setDone(null); setReply(bidFor(t.id, p.id, fee)) }
  const sign = () => setDone(signTransfer(t.id, p.id, reply.verdict === 'counter' ? reply.ask : fee, years))
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h3><Crest team={t} size={20} /> {p.name} 영입 협상</h3><button className="btn ghost small" onClick={onClose}>닫기</button></div>
        <p className="small muted" style={{ marginTop: 0 }}>{t.name} · {p.role || p.pos} · {p.age}세 · OVR {playerOvr(p)} · 선수 가치 {money(v)} · 요구 연봉 약 {eur(wage)}/년</p>
        {!done?.ok && (
          <>
            <label className="tp-slider">
              <span className="tp-row"><b>제시 이적료</b><em>{money(fee)} ({Math.round((fee / v) * 100)}%)</em></span>
              <input type="range" min={Math.round(v * 5) / 10} max={Math.round(v * 25) / 10} step={0.1} value={fee} onChange={(e) => { setFee(Number(e.target.value)); setReply(null) }} />
              <span className="tp-ends"><small>가치의 50%</small><small>250%</small></span>
            </label>
            <div className="row">
              <span className="small">계약 기간</span>
              <select value={years} onChange={(e) => setYears(Number(e.target.value))}>{[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{y}년</option>)}</select>
              <button className="btn" disabled={!transferWindow.open || reply?.verdict === 'accept'} onClick={offer}>제안하기</button>
            </div>
          </>
        )}
        {reply && (
          <div className={`deal-reply ${reply.verdict}`}>
            <strong>{t.name}{reply.tries ? <span className="muted small"> · 협상 {reply.tries}/{PATIENCE}</span> : null}</strong>
            <p>{reply.reason}</p>
            {reply.verdict === 'accept' && !done?.ok && <button className="btn wide" onClick={sign}>✍️ {money(fee)}에 계약 확정</button>}
            {reply.verdict === 'counter' && !done?.ok && <button className="btn wide" onClick={sign}>✍️ {money(reply.ask)}에 맞춰 계약 확정</button>}
          </div>
        )}
        {done && <p className={`notice ${done.ok ? 'ok' : 'bad'}`}>{done.ok ? `✍️ 영입 완료! 연봉 ${eur(done.wage)}/년 · ${years}년 계약` : done.reason}</p>}
      </div>
    </div>
  )
}
