// 구단주 사무실: 재정, 팬 민심, 티켓 가격, 구단주 결정, 계약 현황
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ROSTER_MAX, eur, ffpStatus, gateModel, ticketPct, wageBill, wageBudget, yearsLeft } from '../game/finance.js'
import { DECISIONS, decisionReady, fanLabel } from '../game/owner.js'
import { playerOvr, useGame } from '../store.jsx'
import PlayerSheet from '../components/PlayerSheet.jsx'
import NeedTeam from './NeedTeam.jsx'

export default function Club() {
  const { myTeam, save, data, ownerDecide, setTicket, setWageRatio, contractOf, totalRounds } = useGame()
  const [last, setLast] = useState(null)
  const [detail, setDetail] = useState(null)
  if (!myTeam) return <NeedTeam />
  const f = save.finance
  if (!f) return <div className="card muted">구단 재정을 준비하는 중…</div>
  const fans = save.fans ?? 60
  const [face, fanText, tone] = fanLabel(fans)
  const bill = wageBill(save, myTeam, data.leagueId)
  const expiring = myTeam.players.map((p) => ({ p, c: contractOf(p) })).filter(({ c }) => yearsLeft(save, c) <= 1).sort((a, b) => playerOvr(b.p) - playerOvr(a.p))
  const ledger = (f.ledger || []).slice(-12)
  const maxAbs = Math.max(1, ...ledger.map((x) => Math.abs(x.net)))

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>구단 운영</h1>
          <p className="muted">구단주는 당신입니다. 무엇이든 할 수 있지만, 결과는 장담할 수 없습니다.</p>
        </div>
      </div>

      <div className="owner-top">
        <div className={`card own-cash ${f.cash < 0 ? 'neg' : ''}`}>
          <span>현금</span><strong>{eur(f.cash)}</strong>
          <small>연봉 총액 {eur(bill)}/년{save.owner?.wageCut ? ' (15% 삭감 중)' : ''}{save.owner?.debt ? ` · 사채 ${eur(save.owner.debt)}` : ''}</small>
          {f.warn > 0 && <em className="bad-text">💸 재정 위기 {f.warn}/5라운드</em>}
        </div>
        <div className={`card own-fans ${tone}`}>
          <span>팬 민심</span><strong>{face} {fans}</strong>
          <small>{fanText}</small>
          <div className="conf-bar"><i style={{ width: `${fans}%` }} className={fans >= 60 ? 'hi' : fans >= 35 ? 'mid' : 'lo'} /></div>
        </div>
      </div>

      {f.last && (
        <div className="card">
          <h3>지난 경기 정산 <span className={`small ${f.last.net >= 0 ? 'good-text' : 'bad-text'}`}>{f.last.net >= 0 ? '+' : ''}{eur(f.last.net)}</span></h3>
          <div className="ledger-items">{f.last.items.map(([k, v]) => <span key={k} className={v >= 0 ? 'plus' : 'minus'}>{k} {v >= 0 ? '+' : ''}{eur(v)}</span>)}</div>
          {ledger.length > 1 && (
            <div className="ledger-chart" aria-label="최근 경기 수지">
              {ledger.map((x, i) => <i key={i} className={x.net >= 0 ? 'plus' : 'minus'} style={{ height: `${(Math.abs(x.net) / maxAbs) * 100}%` }} title={`${x.r + 1}R ${eur(x.net)}`} />)}
            </div>
          )}
        </div>
      )}

      <FinancePanel f={f} bill={bill} save={save} setTicket={setTicket} setWageRatio={setWageRatio} fans={fans} totalRounds={totalRounds} />

      <div className="card">
        <h3>구단주 결정</h3>
        <p className="small muted" style={{ marginTop: 0 }}>결과는 운에 따라 달라집니다. 대박이 날 수도, 쫄딱 망할 수도 있습니다.</p>
        <div className="decisions">
          {DECISIONS.map(([k, label, desc, , risk]) => {
            const ready = decisionReady(save, k)
            return (
              <button key={k} className={`decision risk-${risk}`} disabled={!ready.ok} onClick={() => { if (confirm(`${label}\n\n${desc}\n\n실행할까요?`)) setLast(ownerDecide(k)) }}>
                <strong>{label}</strong>
                <span className="small muted">{desc}</span>
                <em>{ready.ok ? `위험도 ${risk}` : ready.why}</em>
              </button>
            )
          })}
        </div>
        {last && <div className={`notice ${last.good ? 'ok' : 'bad'}`}><b>{last.title}</b><p className="small" style={{ margin: '4px 0 0' }}>{last.text}</p></div>}
      </div>

      <div className="card">
        <div className="row between">
          <h3>선수단 · 계약</h3>
          <span className="muted small">{myTeam.players.length}/{ROSTER_MAX}명 · <Link className="link" to="/transfer?tab=fa">FA 시장 →</Link></span>
        </div>
        {expiring.length > 0 && <p className="small bad-text">이번 시즌 끝나면 계약 만료: {expiring.length}명 — 선수를 눌러 재계약하세요.</p>}
        <ul className="contract-list">
          {[...myTeam.players].sort((a, b) => playerOvr(b) - playerOvr(a)).map((p) => {
            const c = contractOf(p)
            const left = yearsLeft(save, c)
            return (
              <li key={p.id}>
                <button className="contract-row" onClick={() => setDetail(p)}>
                  <span className="lu-pos">{p.pos}</span>
                  <span className="lu-name">{p.name}</span>
                  <b>{playerOvr(p)}</b>
                  <span className="ct-wage">{eur(c.wage)}/년</span>
                  <span className={`ct-left ${left <= 1 ? 'warn' : ''}`}>{left <= 1 ? '만료 임박' : `${left}년`}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      <p className="small muted center"><Link className="link" to="/deploy">📡 서버·배포 상태 보기</Link></p>
      {detail && <PlayerSheet player={detail} onClose={() => setDetail(null)} />}
    </section>
  )
}

/** 재정 패널: 시즌 손익 · FFP · 임금 예산 · 티켓 가격(%) */
function FinancePanel({ f, bill, save, setTicket, setWageRatio, fans, totalRounds }) {
  const pct = ticketPct(f)
  const g = gateModel(f, fans, save, pct)
  const perGame = ((f.base || 40) * 0.3) / (totalRounds / 2) * g.revenueK
  const ffp = ffpStatus(f, bill)
  const budget = wageBudget(f)
  const ss = f.season || { rev: 0, exp: 0 }
  const banned = f.ban === (save.seasonNo || 1)
  return (
    <>
      <div className={`card ffp ${ffp.level}`}>
        <div className="row between"><h3>재정 · FFP</h3><span className={`ffp-badge ${ffp.level}`}>FFP {ffp.label}</span></div>
        <div className="ffp-grid">
          <div><span>이번 시즌 수입</span><b className="good-text">{eur(ss.rev)}</b></div>
          <div><span>이번 시즌 지출</span><b className="bad-text">{eur(ss.exp)}</b></div>
          <div><span>시즌 손익</span><b className={ffp.cur >= 0 ? 'good-text' : 'bad-text'}>{ffp.cur >= 0 ? '+' : ''}{eur(ffp.cur)}</b></div>
          <div><span>최근 3시즌 손익</span><b className={ffp.total >= -ffp.allowance ? '' : 'bad-text'}>{eur(ffp.total)}</b><small>허용 -{eur(ffp.allowance)}</small></div>
        </div>
        <div className="ffp-ratio">
          <span className="small">매출 대비 연봉 <b className={ffp.ratio > 1 ? 'bad-text' : ffp.ratio > 0.85 ? 'warn-text' : 'good-text'}>{Math.round(ffp.ratio * 100)}%</b> <span className="muted">(85% 넘으면 주의, 100% 넘으면 위반)</span></span>
          <div className="ratio-bar"><i style={{ width: `${Math.min(100, ffp.ratio * 100)}%` }} className={ffp.ratio > 1 ? 'lo' : ffp.ratio > 0.85 ? 'mid' : 'hi'} /><em style={{ left: '85%' }} /><em style={{ left: '99%' }} /></div>
        </div>
        {banned && <p className="small bad-text">⚖️ FFP 징계: 이번 시즌 선수 영입 금지</p>}
        {(f.history || []).length > 0 && <p className="small muted">지난 시즌: {(f.history || []).slice(-3).map((h) => `${h.seasonNo}시즌 ${h.net >= 0 ? '+' : ''}${eur(h.net)}`).join(' · ')}</p>}
        <p className="small muted" style={{ margin: 0 }}>시즌이 끝나면 심사합니다. 위반하면 벌금과 다음 시즌 영입 금지, 두 번째 위반부터 승점 6점 감점.</p>
      </div>

      <div className="card">
        <h3>임금 예산 <span className="muted small">연봉 총액 {eur(bill)} / 예산 {eur(budget)}</span></h3>
        <label className="tp-slider">
          <span className="tp-row"><b>예상 매출 대비</b><em>{Math.round((f.wageRatio ?? 0.85) * 100)}%</em></span>
          <input type="range" min={40} max={110} step={5} value={Math.round((f.wageRatio ?? 0.85) * 100)} onChange={(e) => setWageRatio(Number(e.target.value) / 100)} />
          <span className="tp-ends"><small>짠물 운영 40%</small><small>110% (FFP 위험)</small></span>
        </label>
        <div className="ratio-bar"><i style={{ width: `${Math.min(100, (bill / Math.max(1, budget)) * 100)}%` }} className={bill > budget ? 'lo' : bill > budget * 0.9 ? 'mid' : 'hi'} /></div>
        <p className="small muted" style={{ marginBottom: 0 }}>예산을 넘는 영입·재계약은 막힙니다. 예산을 늘리면 FFP 위험이 커집니다.</p>
      </div>

      <div className="card">
        <h3>티켓 가격 <span className="muted small">기준 대비 {pct > 0 ? '+' : ''}{pct}%</span></h3>
        <input className="ticket-range" type="range" min={-50} max={100} step={5} value={pct} onChange={(e) => setTicket(Number(e.target.value))} />
        <div className="tp-ends"><small>-50% 반값</small><small>기준</small><small>+100% 두 배</small></div>
        <div className="ffp-grid">
          <div><span>예상 관중</span><b>{Math.round(g.att * 100)}%</b></div>
          <div><span>홈경기당 관중 수입</span><b>{eur(perGame)}</b></div>
          <div><span>홈경기마다 민심</span><b className={g.dFans < 0 ? 'bad-text' : g.dFans > 0 ? 'good-text' : ''}>{g.dFans > 0 ? '+' : ''}{g.dFans}</b></div>
        </div>
        {f.last?.att !== undefined && <p className="small muted" style={{ marginBottom: 0 }}>지난 홈경기: 관중 {Math.round(f.last.att * 100)}% (가격 {f.last.pct > 0 ? '+' : ''}{f.last.pct}%)</p>}
      </div>
    </>
  )
}
