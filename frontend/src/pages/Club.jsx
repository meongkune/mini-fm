// 구단주 사무실: 재정, 팬 민심, 티켓 가격, 구단주 결정, 계약 현황
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ROSTER_MAX, TICKETS, eur, wageBill, yearsLeft } from '../game/finance.js'
import { DECISIONS, decisionReady, fanLabel } from '../game/owner.js'
import { playerOvr, useGame } from '../store.jsx'
import PlayerSheet from '../components/PlayerSheet.jsx'
import NeedTeam from './NeedTeam.jsx'

export default function Club() {
  const { myTeam, save, data, ownerDecide, setTicket, contractOf } = useGame()
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

      <div className="card">
        <h3>티켓 가격</h3>
        <div className="options">
          {TICKETS.map(([k, label, mult, dFans, desc]) => (
            <button key={k} className={`option ${f.ticket === k ? 'on' : ''}`} onClick={() => setTicket(k)}>
              <strong>{label} <span className="muted small">×{mult}</span></strong>
              <span className="small muted">{desc}{dFans ? ` (홈경기마다 민심 ${dFans > 0 ? '+' : ''}${dFans})` : ''}</span>
            </button>
          ))}
        </div>
      </div>

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
