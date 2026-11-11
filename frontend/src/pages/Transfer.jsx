// 이적 시장: 이적료로 영입(상대 구단 AI와 협상) · 판매 목록 등록(제안은 메시지함으로) · FA
import TalkRoom from '../components/TalkRoom.jsx'
import Avatar from '../components/Avatar.jsx'
import Stars, { abilityStars, potentialStarsOf, starText } from '../components/Stars.jsx'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import FreeAgents from './FreeAgents.jsx'
import { Crest, Flag } from '../components/Badges.jsx'
import NeedTeam from './NeedTeam.jsx'
import { CondBar } from '../components/Rating.jsx'
import { PATIENCE, money, potentialStars, valueOf } from '../game/trade.js'
import { eur, transferFunds, wageBill, wageBudget, yearsLeft } from '../game/finance.js'
import { sayToClub } from '../game/aiTalk.js'
import { playerOvr, short, useGame } from '../store.jsx'
import { keyAttrs20 } from '../game/attributes.js'
import { roleOf } from '../engine/formation.js'
import CurrencyToggle from '../components/CurrencyToggle.jsx'
// 받침에 따라 '로/으로'
const ro = (w) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return w + (c < 0 || c > 11171 ? '(으)로' : c % 28 === 0 || c % 28 === 8 ? '로' : '으로') }

const POS = ['전체', 'GK', 'DF', 'MF', 'FW']
const SORTS = [['ovr', '능력'], ['value', '가치'], ['pot', '잠재력'], ['age', '나이']]
const AGES = [['all', '전 연령'], ['u21', '21세 이하'], ['prime', '22~29세'], ['vet', '30세 이상']]
const ageOk = (a, k) => k === 'all' || (k === 'u21' ? a <= 21 : k === 'prime' ? a >= 22 && a <= 29 : a >= 30)
const LINE = { GK: 'gk', DF: 'df', MF: 'mf', FW: 'fw' }

export default function Transfer() {
  const { myTeam, teams, teamsById, status, save, data, transferWindow, totalRounds, toggleSale, valueFor, setAskPrice, worldTeams, wageFor } = useGame()
  const [params] = useSearchParams()
  const [tab, setTab] = useState(params.get('tab') || 'buy')
  const [pos, setPos] = useState('전체')
  const [teamFilter, setTeamFilter] = useState('all')
  const [leagueFilter, setLeagueFilter] = useState('all') // all | mine | 리그ID
  const [sort, setSort] = useState('ovr')
  const [desc, setDesc] = useState(true) // 정렬 방향 (같은 버튼을 다시 누르면 반대로)
  const [q, setQ] = useState('')
  const [age, setAge] = useState('all')
  const [afford, setAfford] = useState(false) // 살 수 있는 선수만 (이적료 ≤ 현금, 연봉 ≤ 임금 예산 여유)
  const [shown, setShown] = useState(40)
  const [pick, setPick] = useState(null) // { p, t }

  const market = useMemo(() => {
    if (!myTeam) return []
    // 전 세계 이적 시장: 내 리그 다른 구단 + 다른 리그 구단(K리그 포함) 선수 전부
    const mineLeague = data.index.leagues.find((l) => l.id === data.leagueId)?.name
    const local = teams.filter((t) => t.id !== myTeam.id).map((t) => ({ lid: data.leagueId, league: mineLeague, team: t }))
    return [...local, ...worldTeams].flatMap(({ lid, league, team: t }) => t.players.map((p) => ({ p, t, lid, league, v: valueFor(p), pot: potentialStars(p) })))
  }, [teams, myTeam, status, save.pstats, worldTeams.length, save.gone, save.abroad])
  if (!myTeam) return <NeedTeam />

  const sorter = { ovr: (a, b) => playerOvr(b.p) - playerOvr(a.p), value: (a, b) => b.v - a.v, pot: (a, b) => b.pot - a.pot || a.p.age - b.p.age, age: (a, b) => a.p.age - b.p.age }[sort]
  const f0 = save.finance || {}
  const room0 = Math.max(0, wageBudget(f0) - wageBill(save, myTeam, data.leagueId))
  const canPay = (p, v) => v <= transferFunds(f0) // 이적료를 이적 자금으로 낼 수 있나
  const wageOk = (p) => wageFor(p) * 1.15 <= room0 // 연봉이 임금 예산 여유 안인가
  const canBuy = (p, v) => canPay(p, v) && wageOk(p)
  const filtered = market
    .filter(({ p, t, lid, v }) => (leagueFilter === 'all' || (leagueFilter === 'mine' ? lid === data.leagueId : lid === leagueFilter)) && (pos === '전체' || p.pos === pos) && ageOk(p.age, age) && (!afford || canPay(p, v)) && (teamFilter === 'all' || `${lid}/${t.id}` === teamFilter) && (!q || `${p.name} ${p.nameEn || ''}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (desc ? sorter(a, b) : -sorter(a, b)))
  const list = filtered.slice(0, shown)
  const mineList = [...myTeam.players].map((p) => ({ p, v: valueFor(p), pot: potentialStars(p) })).sort((a, b) => playerOvr(b.p) - playerOvr(a.p))
  const byId = Object.fromEntries([...teams, ...worldTeams.map((w) => w.team)].flatMap((t) => t.players).concat(save.signed || []).concat(Object.values(save.abroad || {}).map((a) => a.player)).map((p) => [p.id, p]))
  const clubName = (id, lid) => (lid && lid !== data.leagueId ? worldTeams.find((w) => w.lid === lid && w.team.id === id)?.team : teamsById[id])
  const f = save.finance || {}
  const bill = wageBill(save, myTeam, data.leagueId)
  const room = Math.max(0, wageBudget(f) - bill)
  const banned = f.ban === (save.seasonNo || 1)

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>이적 시장</h1>
          <p className="muted">전 세계 9개 리그 + K리그 선수를 이적료로 사고팝니다 · 상대 구단은 핵심 선수를 비싸게 부릅니다</p>
        </div>
        <span className={`pill ${transferWindow.open ? 'ok' : 'bad'}`}>{transferWindow.open ? `🟢 ${transferWindow.label}` : '🔒 닫힘'}</span>
      </div>
      <CurrencyToggle />
      <div className="budget-strip">
        <div><span>이적 자금</span><b className={transferFunds(f) <= 0 ? 'bad-text' : ''}>{eur(transferFunds(f))}</b></div>
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
            <select value={leagueFilter} onChange={(e) => { setLeagueFilter(e.target.value); setTeamFilter('all') }}>
              <option value="all">🌍 전체 리그</option>
              <option value="mine">내 리그</option>
              {data.index.leagues.filter((l) => l.id !== data.leagueId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option value="all">전체 구단</option>
              {[...new Map(market.filter(({ lid }) => leagueFilter === 'all' || (leagueFilter === 'mine' ? lid === data.leagueId : lid === leagueFilter)).map(({ t, lid }) => [`${lid}/${t.id}`, t.name])).entries()].map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </div>
          <Guide items={[
            ['★ 노란 별', '현재 능력 (5개 = 월드클래스, 3개 = 중위권 주전)'],
            ['★ 파란 별', '잠재력 — 앞으로 클 수 있는 최대치'],
            ['숫자 3개', '그 포지션의 핵심 능력치 (1~20, 16 이상이면 정상급)'],
            ['초록 금액', '선수 가치(이적료 기준). 아래 작은 글씨는 요구 연봉'],
            ['✔ 영입 가능', '이적료를 이적 자금으로 낼 수 있는 선수 (이적 자금·임금 예산은 구단 운영에서 맞바꿀 수 있다)'],
            ['➕ 선수 끼워 넣기', '우리 선수를 얹으면 상대가 매긴 값어치만큼 현금을 덜 낸다. 그 포지션이 부족한 구단일수록 비싸게 쳐준다'],
            ['🔁 임대', '시즌 끝까지 빌려 온다. 임대료 + 연봉 일부 부담. 핵심·주전 선수는 빌려주지 않는다. 내 선수 임대 보내기는 선수 상세 → 계약'],
            ['🗣️ 단장과 협상', '상대 단장(AI)에게 근거를 들어 말하면 다음 제안 때 금액을 조금(최대 8%) 낮춰 준다'],
          ]} />
          <div className="mk-filters">
            <div className="chips-scroll">
              {POS.map((x) => <button key={x} className={`chip ${pos === x ? 'on' : ''}`} onClick={() => { setPos(x); setShown(40) }}>{x}</button>)}
              <span className="chip-sep" />
              {AGES.map(([k, l]) => <button key={k} className={`chip ${age === k ? 'on' : ''}`} onClick={() => { setAge(k); setShown(40) }}>{l}</button>)}
            </div>
            <div className="chips-scroll">
              <span className="muted small">정렬</span>
              {SORTS.map(([k, l]) => <button key={k} className={`chip ${sort === k ? 'on' : ''}`} onClick={() => { if (sort === k) setDesc(!desc); else { setSort(k); setDesc(true) } }}>{l}순{sort === k ? (desc === (k !== 'age') ? ' ▼' : ' ▲') : ''}</button>)}
              <span className="chip-sep" />
              <button className={`chip ${afford ? 'on' : ''}`} onClick={() => { setAfford(!afford); setShown(40) }}>💰 이적료 낼 수 있는 선수만</button>
            </div>
            <p className="small muted mk-count">{filtered.length.toLocaleString()}명 중 {list.length}명 · 줄을 누르면 영입 제안</p>
            {room0 <= 0.05 && <p className="notice bad small">💼 임금 예산 여유가 없습니다 (연봉 총액이 예산을 꽉 채움). 이적료를 낼 수 있어도 새 연봉 때문에 영입이 막힙니다 → 구단 운영에서 임금 예산을 올리거나, 연봉 높은 선수를 판 뒤 영입하세요.</p>}
          </div>
          <div className="mk-cards">
            {list.map(({ p, t, lid, league, v }) => {
              const ok = canBuy(p, v)
              const wage = Math.round(wageFor(p) * 1.15 * 10) / 10
              return (
                <button key={p.id} className={`mk-card line-${LINE[p.pos]}`} onClick={() => setPick({ p, t, lid })}>
                  <span className="mkc-pos"><Avatar player={p} color={t.color} size={34} number={false} /><em>{roleOf(p)}</em></span>
                  <span className="mkc-main">
                    <strong><Flag nation={p.nation} size={14} /> {p.name}{status[p.id]?.inj > 0 ? ' 🚑' : ''}</strong>
                    <small><Crest team={t} size={14} /> {short(t)}{lid !== data.leagueId ? ` · ${league}` : ''} · {p.age}세</small>
                    <span className="mkc-attrs">{keyAttrs20(p).map(([k, x]) => <span key={k} className={x >= 16 ? 'hi' : x >= 12 ? 'mid' : 'lo'}><b>{x}</b>{k}</span>)}</span>
                  </span>
                  <span className="mkc-side">
                    <span className="mkc-stars"><Stars value={abilityStars(p)} /><Stars value={potentialStarsOf(p)} tone="pot" /></span>
                    <b className="mkc-val">{money(v)}</b>
                    <small className={ok ? 'good-text' : canPay(p, v) ? 'warn-text' : 'muted'}>{ok ? '✔ 영입 가능' : canPay(p, v) ? `연봉 예산 초과 · ${eur(wage)}` : `연봉 ${eur(wage)}`}</small>
                  </span>
                </button>
              )
            })}
          </div>
          {filtered.length > list.length && <button className="btn ghost wide" onClick={() => setShown(shown + 40)}>더 보기 ({filtered.length - list.length}명 남음)</button>}
          <p className="small muted">⭐ 노란 별 = 현재 능력 · 🔵 파란 별 = 잠재력 · 숫자 = 포지션 핵심 능력치(1~20)</p>
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
                      <span className="mk-ovr"><Stars value={abilityStars(p)} compact /></span>
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
              <li key={i}><span className="muted small">{t.round + 1}R</span> {t.in ? <>📥 {byId[t.in]?.name ?? t.in} ← <Crest team={clubName(t.from, t.lid)} size={16} /></> : <>📤 {byId[t.out]?.name ?? t.out} → <Crest team={clubName(t.to, t.lid)} size={16} /></>} <b>{eur(t.fee)}</b></li>
            ))}
          </ul>
        </div>
      )}
      <p className="muted small">잠재력 ★은 스카우트 평가입니다 · 총 {totalRounds}라운드 중 초반 4라운드·중반 4라운드에 이적 시장이 열립니다.</p>
      {(save.marketLog || []).length > 0 && (
        <div className="card market-log">
          <h3>📰 다른 구단 이적 소식 <span className="muted small">최근 {Math.min(12, save.marketLog.length)}건</span></h3>
          <ul>
            {save.marketLog.slice(0, 12).map((d, i) => (
              <li key={i}><b>{d.name}</b> <span className="muted">{d.pos} · {d.age}세</span> {d.from} → <b>{d.to}</b>{d.league ? <span className="muted"> ({d.league})</span> : null} <em>{money(d.fee)}</em></li>
            ))}
          </ul>
        </div>
      )}
      {pick && <BidSheet p={pick.p} t={pick.t} lid={pick.lid} onClose={() => setPick(null)} />}
    </section>
  )
}

/** 영입 협상: 이적료 제시 → 상대 구단 답 → 수락되면 계약 기간 정하고 확정 */
const r1 = (x) => Math.round(x * 10) / 10
const ROLE_TXT = (rank) => (rank < 3 ? '핵심 선수' : rank < 11 ? '주전' : rank < 18 ? '로테이션' : '후보')

function BidSheet({ p, t, lid, onClose }) {
  const { bidFor, loanBid, loanIn, loanWage, swapPreview, signTransfer, askWage, transferWindow, valueFor, save, myTeam, data, totalRounds, addPromise, isLoanIn, contractOf } = useGame()
  const cash = transferFunds(save.finance || {})
  const room = Math.max(0, wageBudget(save.finance || {}) - wageBill(save, myTeam, data.leagueId))
  const v = valueFor(p)
  const [mode, setMode] = useState('buy') // buy: 완전 이적 · loan: 임대
  const [fee, setFee] = useState(r1(v))
  const [loanFee, setLoanFee] = useState(r1(v * 0.06))
  const [share, setShare] = useState(1)
  const [swapId, setSwapId] = useState('')
  const [years, setYears] = useState(p.age >= 31 ? 2 : 4)
  const [reply, setReply] = useState(null)
  const [done, setDone] = useState(null)
  const [nego, setNego] = useState(false)
  const [talkCut, setTalkCut] = useState(0) // 단장과의 대화로 얻어 낸 양보 (0~8%)
  const wage = askWage(p, t, lid)
  const fullWage = loanWage(p, t, lid)
  const ref = { lid, id: t.id }
  const swap = mode === 'buy' && swapId ? swapPreview(ref, swapId) : null
  const swapList = [...myTeam.players].filter((x) => !isLoanIn(x.id)).sort((a, b) => playerOvr(b) - playerOvr(a))
  const rank = [...t.players].sort((a, b) => playerOvr(b) - playerOvr(a)).findIndex((x) => x.id === p.id)
  const reset = () => { setReply(null); setDone(null) }
  const ask = () => (mode === 'loan' ? { ...loanBid(ref, p.id, loanFee, share), mode } : { ...bidFor(ref, p.id, fee, { swapId: swapId || null, talk: talkCut }), mode })
  const offer = () => { setDone(null); setReply(ask()) }
  const cashFee = reply ? (reply.verdict === 'counter' ? reply.ask : reply.mode === 'loan' ? loanFee : fee) : 0
  const sign = () => setDone(reply.mode === 'loan' ? { ...loanIn(ref, p.id, cashFee, share), loan: true } : signTransfer(ref, p.id, cashFee, years, null, { swapId: reply.swapId }))
  const ok = reply && (reply.verdict === 'accept' || reply.verdict === 'counter') && !done?.ok
  // 단장에게 넘길 사실 (게임이 정한 결정 포함)
  const facts = (r) => ({
    club: t.name, player: p.name, age: p.age, pos: p.role || p.pos, ovr: playerOvr(p), role: ROLE_TXT(rank), years: yearsLeft(save, contractOf(p)),
    wantsOut: !!save.status?.[p.id]?.wantsOut, value: r1(v), tries: r?.tries ?? 0, patience: PATIENCE, loan: mode === 'loan',
    ...(r ? { offer: { fee: mode === 'loan' ? loanFee : fee, share, ...(swap ? { swap: swap.player.name, swapCredit: swap.credit, swapNote: swap.note } : {}) }, verdict: r.verdict, ask: r.ask, reason: r.verdict === 'reject' ? r.reason : '' } : {}),
  })
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h3><Crest team={t} size={20} /> {p.name} 영입 협상</h3><button className="btn ghost small" onClick={onClose}>닫기</button></div>
        <div className="bid-info">
          <div className="bi-who">
            <Avatar player={p} color={t.color} size={52} number={false} />
            <span><strong>{p.name}</strong><small>{t.name} · {p.role || p.pos} · {p.age}세 · 팀 내 {ROLE_TXT(rank)}</small></span>
          </div>
          <div className="bi-grid">
            <div><span>현재 능력</span><b><Stars value={abilityStars(p)} /></b></div>
            <div><span>잠재력</span><b><Stars value={potentialStarsOf(p)} tone="pot" /></b></div>
            <div><span>선수 가치</span><b className="good-text">{money(v)}</b></div>
            <div><span>{mode === 'loan' ? '지금 연봉' : '요구 연봉'}</span><b>{eur(mode === 'loan' ? fullWage : wage)}<small>/년</small></b></div>
            <div><span>이적 자금</span><b className={cash < (mode === 'loan' ? loanFee : fee) ? 'bad-text' : ''}>{eur(cash)}</b></div>
            <div><span>임금 예산 여유</span><b className={room < (mode === 'loan' ? fullWage * share : wage) ? 'bad-text' : ''}>{eur(room)}<small>/년</small></b></div>
          </div>
          <div className="bi-keys">{keyAttrs20(p).map(([k, x]) => <span key={k} className={x >= 16 ? 'hi' : x >= 12 ? 'mid' : 'lo'}><b>{x}</b>{k}</span>)}</div>
        </div>
        {!done?.ok && (
          <>
            <div className="seg deal-mode">
              <button className={mode === 'buy' ? 'on' : ''} onClick={() => { setMode('buy'); reset() }}>✍️ 완전 이적</button>
              <button className={mode === 'loan' ? 'on' : ''} onClick={() => { setMode('loan'); reset() }}>🔁 임대 (시즌 끝까지)</button>
            </div>
            {mode === 'buy' ? (
              <>
                <label className="tp-slider">
                  <span className="tp-row"><b>현금</b><em>{money(fee)} ({Math.round((fee / v) * 100)}%)</em></span>
                  <input type="range" min={0} max={Math.round(v * 25) / 10} step={0.1} value={fee} onChange={(e) => { setFee(Number(e.target.value)); reset() }} />
                  <span className="tp-ends"><small>0</small><small>가치의 250%</small></span>
                </label>
                <div className="swap-pick">
                  <span className="small">➕ 우리 선수 끼워 넣기</span>
                  <select value={swapId} onChange={(e) => { setSwapId(e.target.value); reset() }}>
                    <option value="">없음 (현금만)</option>
                    {swapList.map((x) => <option key={x.id} value={x.id}>{x.pos} {x.name} · {x.age}세 · {starText(abilityStars(x))}</option>)}
                  </select>
                  {swap && <p className="small">{t.name} 평가: <b className="good-text">{money(swap.credit)}</b> — {swap.note}. 현금 {money(fee)} + {swap.player.name} = 총 {money(r1(fee + swap.credit))}</p>}
                </div>
                <div className="row">
                  <span className="small">계약 기간</span>
                  <select value={years} onChange={(e) => setYears(Number(e.target.value))}>{[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{y}년</option>)}</select>
                  {talkCut > 0 && <span className="small good-text">단장 양보 −{Math.round(talkCut * 100)}%</span>}
                  <button className="btn" disabled={!transferWindow.open || reply?.verdict === 'accept'} onClick={offer}>제안하기</button>
                </div>
              </>
            ) : (
              <>
                <label className="tp-slider">
                  <span className="tp-row"><b>임대료</b><em>{money(loanFee)}</em></span>
                  <input type="range" min={0} max={Math.max(1, Math.round(v * 3) / 10)} step={0.1} value={loanFee} onChange={(e) => { setLoanFee(Number(e.target.value)); reset() }} />
                  <span className="tp-ends"><small>0</small><small>가치의 30%</small></span>
                </label>
                <div className="row">
                  <span className="small">연봉 부담</span>
                  <select value={share} onChange={(e) => { setShare(Number(e.target.value)); reset() }}>{[1, 0.75, 0.5].map((x) => <option key={x} value={x}>{Math.round(x * 100)}% ({eur(r1(fullWage * x))}/년)</option>)}</select>
                  <button className="btn" disabled={!transferWindow.open || reply?.verdict === 'accept'} onClick={offer}>제안하기</button>
                </div>
                <p className="small muted">임대 선수는 시즌이 끝나면 원래 구단으로 돌아갑니다. 연봉을 적게 부담할수록 임대료를 더 요구합니다. 핵심·주전 선수는 임대해 주지 않습니다.</p>
              </>
            )}
          </>
        )}
        {reply && (
          <div className={`deal-reply ${reply.verdict}`}>
            <strong>{t.name}{reply.tries ? <span className="muted small"> · 협상 {reply.tries}/{PATIENCE}</span> : null}</strong>
            <p>{reply.reason}</p>
            {ok && reply.mode === 'loan' && <button className="btn wide" onClick={sign}>🔁 임대료 {money(cashFee)} · 연봉 {Math.round(share * 100)}% 부담으로 임대 확정</button>}
            {ok && reply.mode === 'buy' && <button className="btn wide" onClick={sign}>✍️ 현금 {money(cashFee)}{reply.swapId ? ' + 선수' : ''}에 계약 확정 (요구 연봉 {eur(wage)} 그대로)</button>}
            {ok && reply.mode === 'buy' && <button className="btn wide ghost talk-start" onClick={() => setNego(true)}>🗣️ 선수와 연봉 협상 후 계약</button>}
          </div>
        )}
        {!done?.ok && transferWindow.open && <DirectorTalk t={t} facts={facts} ask={ask} onReply={setReply} onCut={(c) => setTalkCut((x) => Math.min(0.08, x + c))} />}
        {nego && (
          <TalkRoom player={p} team={t} status={{}} topic="contract" totalRounds={totalRounds}
            deal={{ kind: 'sign', ask: wage, current: null, maxYears: p.age >= 31 ? 2 : 5 }}
            reason={`${myTeam.name}로 이적하는 개인 조건을 이야기하러 왔음 (구단 간 이적료는 합의됨)`}
            situation="이적 협상 중 — 두 구단이 이적료에 합의했고, 이제 연봉·계약 기간을 정하면 이적이 확정된다"
            onClose={() => setNego(false)}
            onFinish={(r) => {
              setNego(false)
              if (!r.deal) return
              const x = signTransfer(ref, p.id, cashFee, r.deal.years, r.deal.wage, { swapId: reply.swapId })
              if (x?.ok && r.deal.raise) addPromise(p.id, { kind: 'raise', cond: 6.9, minApps: 10, target: r1(r.deal.wage * 1.25), made: save.round, text: `이번 시즌 활약(평균 평점 6.9·10경기 이상)하면 다음 시즌 €${r1(r.deal.wage * 1.25)}M으로 인상` })
              setDone(x)
            }} />
        )}
        {done && <p className={`notice ${done.ok ? 'ok' : 'bad'}`}>{!done.ok ? done.reason : done.loan ? `🔁 임대 완료! 연봉 부담 ${eur(done.wage)}/년 · 시즌이 끝나면 ${ro(t.name)} 돌아갑니다` : `✍️ 영입 완료! 연봉 ${eur(done.wage)}/년 · ${years}년 계약`}</p>}
      </div>
    </div>
  )
}

/**
 * 상대 구단 단장과 대화 (AI): 수락·역제안·거절은 게임이 정하고, 단장은 그 결정을 자기 말로 전한다.
 * 설득력 있는 근거(후보 선수·계약 만료 임박·필요한 포지션 선수를 끼워 줌)를 대면 다음 제안 때 원하는 금액을 조금(최대 8%) 낮춰 준다.
 */
function DirectorTalk({ t, facts, ask, onReply, onCut }) {
  const [open, setOpen] = useState(false)
  const [lines, setLines] = useState([]) // { role: 'manager'|'club', text, mood?, cut? }
  const [input, setInput] = useState('')
  const [attach, setAttach] = useState(true)
  const [busy, setBusy] = useState(false)
  const [walked, setWalked] = useState(false)
  const turns = lines.filter((l) => l.role === 'manager').length
  const MAX = 8
  async function send() {
    const message = input.trim()
    if (!message || busy || walked || turns >= MAX) return
    setBusy(true); setInput('')
    const before = lines
    setLines([...before, { role: 'manager', text: message }])
    const r = attach ? ask() : null // 조건을 함께 내밀면 협상 1회로 센다
    if (r) onReply(r)
    const res = await sayToClub({ message, history: before.map(({ role, text }) => ({ role, text })), club: facts(r), fallback: r?.reason })
    if (res.concession > 0) onCut(res.concession / 100)
    if (res.walk) setWalked(true)
    setLines((ls) => [...ls, { role: 'club', text: res.reply, mood: res.mood, cut: res.concession, ai: res.ai }])
    setBusy(false)
  }
  if (!open) return <button className="btn wide ghost talk-start" onClick={() => setOpen(true)}>🗣️ {t.name} 단장과 직접 협상 (AI)</button>
  return (
    <div className="director">
      <div className="dr-head"><Crest team={t} size={18} /> <b>{t.name} 단장</b><span className="muted small"> · {turns}/{MAX}</span></div>
      <div className="dr-log">
        {!lines.length && <p className="small muted">근거를 들어 설득해 보세요. 예: "이 선수는 계약이 1년 남았고 후보잖아요", "미드필더가 부족하시죠? 우리 선수를 얹을게요". 설득력 있으면 다음 제안 때 금액을 낮춰 줍니다.</p>}
        {lines.map((l, i) => (
          <p key={i} className={`dr-line ${l.role}`}>
            {l.role === 'club' && <em>{l.mood}</em>}{l.text}
            {l.cut > 0 && <span className="dr-cut">양보 −{l.cut}%</span>}
          </p>
        ))}
        {busy && <p className="dr-line club muted">…</p>}
        {walked && <p className="small bad-text">단장이 대화를 접었습니다.</p>}
      </div>
      <div className="dr-input">
        <input value={input} maxLength={250} placeholder="단장에게 할 말" disabled={walked || turns >= MAX} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button className="btn small" disabled={busy || walked || !input.trim() || turns >= MAX} onClick={send}>보내기</button>
      </div>
      <label className="small dr-attach"><input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} /> 지금 화면의 조건도 함께 제안 (협상 횟수 1회 사용)</label>
    </div>
  )
}

/** 화면 위 '보는 법' 안내 (접었다 폈다) */
export function Guide({ items, title = '❓ 보는 법' }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`guide ${open ? 'open' : ''}`}>
      <button className="guide-head" onClick={() => setOpen(!open)}>{title} <span>{open ? '접기 ▲' : '펼치기 ▼'}</span></button>
      {open && <dl>{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
    </div>
  )
}
