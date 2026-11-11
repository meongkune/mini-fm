// 구단주 사무실: 재정, 팬 민심, 티켓 가격, 구단주 결정, 계약 현황
import Stars, { abilityStars } from '../components/Stars.jsx'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ROSTER_MAX, eur, ffpStatus, gateModel, ticketPct, wageBill, wageBudget, yearsLeft, transferFunds, shiftRange, revenueOf } from '../game/finance.js'
import { DECISIONS, decisionReady, fanLabel } from '../game/owner.js'
import { playerOvr, useGame } from '../store.jsx'
import PlayerSheet from '../components/PlayerSheet.jsx'
import CurrencyToggle from '../components/CurrencyToggle.jsx'
import NeedTeam from './NeedTeam.jsx'

export default function Club() {
  const { myTeam, save, data, ownerDecide, setTicket, setWageRatio, setBudgetShift, contractOf, totalRounds } = useGame()
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
      <CurrencyToggle />

      <div className="owner-top">
        <div className={`card own-cash ${f.cash < 0 ? 'neg' : ''}`}>
          <span>현금 (통장 잔고)</span><strong>{eur(f.cash)}</strong>
          {f.fm >= 5 && <small>그중 이적 자금 <b>{eur(transferFunds(f))}</b> · 임금 예산 {eur(wageBudget(f))}/년</small>}
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
            <>
              <p className="small muted ledger-title">최근 {ledger.length}경기 수지 — 막대 하나가 한 경기의 (수입 − 지출). 위로 초록 = 흑자, 아래로 빨강 = 적자</p>
              <div className="ledger2" aria-label="최근 경기 수지">
                {ledger.map((x, i) => (
                  <div key={i} className="lg-col" title={`${x.r + 1}라운드: ${x.net >= 0 ? '+' : ''}${eur(x.net)}`}>
                    <div className="lg-up">{x.net >= 0 && <i className="plus" style={{ height: `${(Math.abs(x.net) / maxAbs) * 100}%` }} />}</div>
                    <div className="lg-down">{x.net < 0 && <i className="minus" style={{ height: `${(Math.abs(x.net) / maxAbs) * 100}%` }} />}</div>
                    <small>{x.r + 1}R</small>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <FinancePanel f={f} bill={bill} save={save} setTicket={setTicket} setWageRatio={setWageRatio} setBudgetShift={setBudgetShift} fans={fans} totalRounds={totalRounds} />

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
        <p className="small muted" style={{ marginTop: 0 }}>연봉 <em className="wage-src real">실제</em> 실제 보도 연봉 · <em className="wage-src">추정</em> 능력·구단 규모로 추정</p>
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
                  <Stars value={abilityStars(p)} compact />
                  <span className="ct-wage">{eur(c.wage)}/년<em className={`wage-src ${c.real ? 'real' : ''}`}>{c.real ? '실제' : c.renewed ? '재계약' : '추정'}</em></span>
                  <span className={`ct-left ${left <= 1 ? 'warn' : ''}`}>{left <= 1 ? '만료 임박' : `${left}년`}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {detail && <PlayerSheet player={detail} onClose={() => setDetail(null)} />}
    </section>
  )
}

/** 재정 패널: 한눈에 보는 재정 상태(신호등·할 일) · 핵심 지표 · FFP 게이지 · 항목별 수입/지출 · 임금 예산 · 티켓 가격 */
/**
 * 이사회 예산: 이적 자금(이적료·임대료·계약금에 쓰는 돈)과 임금 예산(1년 연봉 총액 한도)
 * 막대로 둘을 맞바꾼다 — 임금 예산 €1M/년을 늘리면 이적 자금이 €2M 줄고, 반대도 된다. 공짜로 늘어나는 돈은 없다.
 */
function BudgetCard({ f, bill, setBudgetShift }) {
  const { min, max } = shiftRange(f, bill)
  const shift = Math.max(min, Math.min(max, f.shift || 0))
  const wb = wageBudget(f)
  const tf = transferFunds(f)
  const room = Math.round((wb - bill) * 10) / 10
  return (
    <div className="card budget-card">
      <h3>이사회 예산 <span className="muted small">시즌마다 이사회가 정해 줍니다 · 예상 매출 {eur(revenueOf(f))}/년</span></h3>
      <div className="bud-two">
        <div><span>💰 이적 자금</span><b>{eur(tf)}</b><small>이적료·임대료·계약금에 쓰는 돈 (한 번 쓰면 줄어듦)</small></div>
        <div><span>🧾 임금 예산</span><b className={room < 0 ? 'bad-text' : ''}>{eur(wb)}<em>/년</em></b><small>지금 연봉 총액 {eur(bill)} · {room >= 0 ? `여유 ${eur(room)}` : `초과 ${eur(-room)} — 영입·인상 재계약 불가`}</small></div>
      </div>
      <label className="tp-slider">
        <span className="tp-row"><b>맞바꾸기</b><em>{shift === 0 ? '이사회가 준 그대로' : shift > 0 ? `이적 자금 ${eur(shift * 2)} → 임금 예산 +${eur(shift)}/년` : `임금 예산 ${eur(-shift)}/년 → 이적 자금 +${eur(-shift * 2)}`}</em></span>
        <input type="range" min={min} max={max} step={0.5} value={shift} disabled={min === max} onChange={(e) => setBudgetShift(Number(e.target.value))} />
        <span className="tp-ends"><small>← 이적 자금 늘리기</small><small>임금 예산 늘리기 →</small></span>
      </label>
      <div className="ratio-bar"><i style={{ width: `${Math.min(100, (bill / Math.max(1, wb)) * 100)}%` }} className={bill > wb ? 'lo' : bill > wb * 0.92 ? 'mid' : 'hi'} /></div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        현금(통장)과 예산은 다릅니다. 통장에 돈이 있어도 이사회가 허락한 이적 자금까지만 선수 영입에 쓸 수 있고, 연봉 총액은 임금 예산을 넘을 수 없습니다.
        선수를 팔면 받은 돈의 80%가 이적 자금으로 돌아옵니다. 이적료는 통장에서는 바로 나가지만 FFP 손익에는 계약 기간으로 나눠 잡힙니다.
      </p>
    </div>
  )
}

function FinancePanel({ f, bill, save, setTicket, setWageRatio, setBudgetShift, fans, totalRounds }) {
  const pct = ticketPct(f)
  const g = gateModel(f, fans, save, pct)
  const perGame = ((f.base || 40) * 0.3) / (totalRounds / 2) * g.revenueK
  const ffp = ffpStatus(f, bill)
  const budget = wageBudget(f)
  const ss = f.season || { rev: 0, exp: 0 }
  const banned = f.ban === (save.seasonNo || 1)
  // 시즌 말 예상 손익: 최근 경기 정산 평균으로 남은 라운드를 채운다
  const recent = (f.ledger || []).slice(-Math.max(1, Math.min(10, save.round || 1)))
  const matchNet = recent.length ? recent.reduce((a, x) => a + x.net, 0) / recent.length : 0
  const left = Math.max(0, totalRounds - (save.round || 0))
  const projected = ffp.cur + matchNet * left
  const room = ffp.allowance + ffp.total // 3시즌 허용 적자까지 남은 여유
  const used = Math.max(0, -ffp.total) / ffp.allowance // 허용 적자 사용률
  // 할 일 (위험한 것부터)
  const todo = []
  if (f.cash < 0) todo.push(['bad', `현금이 ${eur(f.cash)}입니다. 선수 판매나 구단주 결정(스폰서 등)으로 메우세요.`])
  if (ffp.ratio > 1) todo.push(['bad', `연봉이 예상 매출의 ${Math.round(ffp.ratio * 100)}% — FFP 위반입니다. 연봉 높은 벤치 선수를 파세요.`])
  else if (ffp.ratio > 0.85) todo.push(['warn', `연봉이 예상 매출의 ${Math.round(ffp.ratio * 100)}% — 85%를 넘었습니다. 새 영입은 연봉을 보고 고르세요.`])
  if (ffp.total < -ffp.allowance) todo.push(['bad', `최근 3시즌 적자 ${eur(-ffp.total)}가 허용(${eur(ffp.allowance)})을 넘었습니다. 이적료 지출을 멈추고 선수를 파세요.`])
  else if (used >= 0.6) todo.push(['warn', `허용 적자의 ${Math.round(used * 100)}%를 썼습니다. 남은 여유 ${eur(room)}.`])
  if (recent.length >= 3 && projected < -ffp.allowance * 0.5) todo.push(['warn', `이대로면 시즌 말 손익 ${eur(projected)} 예상 — 티켓 가격·임금 예산을 점검하세요.`])
  if (fans < 35) todo.push(['warn', `팬 민심 ${fans} — 티켓 가격을 내리면 민심이 회복됩니다.`])
  const health = todo.some((t) => t[0] === 'bad') ? 'bad' : todo.length ? 'warn' : 'ok'
  const HEALTH = {
    ok: ['🟢', '재정 건전', `영입 여유: 3시즌 허용 적자까지 ${eur(Math.max(0, room))} · 임금 예산 여유 ${eur(Math.max(0, budget - bill))}/년`],
    warn: ['🟡', '주의 필요', '아래 항목을 확인하세요'],
    bad: ['🔴', '위험', '시즌 말 FFP 심사에서 징계를 받을 수 있습니다'],
  }[health]
  // 항목별 시즌 수입·지출
  const cats = Object.entries(ss.cats || {}).filter(([, v]) => Math.abs(v) >= 0.05)
  const inc = cats.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  const out = cats.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1])
  const maxCat = Math.max(1, ...cats.map(([, v]) => Math.abs(v)))
  return (
    <>
      <div className={`card fin-health ${health}`}>
        <div className="fh-head">
          <span className="fh-light">{HEALTH[0]}</span>
          <div><strong>{HEALTH[1]}</strong><small>{HEALTH[2]}</small></div>
          <span className={`ffp-badge ${ffp.level}`}>FFP {ffp.label}</span>
        </div>
        {todo.length > 0 && <ul className="fh-todo">{todo.map(([tone, text], i) => <li key={i} className={tone}>{tone === 'bad' ? '⛔' : '⚠️'} {text}</li>)}</ul>}
        {banned && <p className="small bad-text" style={{ margin: '6px 0 0' }}>⚖️ FFP 징계: 이번 시즌 선수 영입 금지</p>}
      </div>

      <div className="fin-kpis">
        <div className={`card kpi ${ffp.cur >= 0 ? 'good' : 'bad'}`}><span>이번 시즌 손익</span><b>{ffp.cur >= 0 ? '+' : ''}{eur(ffp.cur)}</b><small>시즌 말 예상 {projected >= 0 ? '+' : ''}{eur(projected)}</small></div>
        <div className={`card kpi ${ffp.ratio > 1 ? 'bad' : ffp.ratio > 0.85 ? 'warn' : 'good'}`}><span>매출 대비 연봉</span><b>{Math.round(ffp.ratio * 100)}%</b><small>연봉 {eur(bill)} / 매출 {eur(ffp.revenue)}</small></div>
        <div className={`card kpi ${room < 0 ? 'bad' : used >= 0.6 ? 'warn' : 'good'}`}><span>FFP 적자 여유</span><b>{eur(Math.max(0, room))}</b><small>3시즌 손익 {eur(ffp.total)} · 허용 -{eur(ffp.allowance)}</small></div>
        <div className={`card kpi ${bill > budget ? 'bad' : bill > budget * 0.9 ? 'warn' : 'good'}`}><span>임금 예산 여유</span><b>{eur(budget - bill)}</b><small>예산 {eur(budget)}/년</small></div>
      </div>

      <div className={`card ffp ${ffp.level}`}>
        <h3>FFP 게이지 <span className="muted small">🟩 안전 · 🟨 주의 · 🟥 위반 — 시즌이 끝나면 심사</span></h3>
        <Gauge label="매출 대비 연봉" value={ffp.ratio * 100} max={130} marks={[[85, '85%'], [100, '100%']]} text={`${Math.round(ffp.ratio * 100)}%`} />
        <Gauge label="3시즌 허용 적자 사용" value={used * 100} max={130} marks={[[60, '60%'], [100, '100%']]} text={`${Math.round(used * 100)}%`} />
        {(f.history || []).length > 0 && <p className="small muted">지난 시즌: {(f.history || []).slice(-3).map((h) => `${h.seasonNo}시즌 ${h.net >= 0 ? '+' : ''}${eur(h.net)}`).join(' · ')}</p>}
        <p className="small muted" style={{ margin: 0 }}>위반하면 벌금과 다음 시즌 영입 금지, 두 번째 위반부터 승점 6점 감점.</p>
      </div>

      <div className="card">
        <h3>이번 시즌 수입 · 지출 <span className="muted small">수입 {eur(ss.rev)} · 지출 {eur(ss.exp)}</span></h3>
        {!cats.length && <p className="small muted">아직 항목별 기록이 없습니다. 다음 경기부터 항목별로 쌓입니다.</p>}
        <div className="fin-cats">
          {inc.length > 0 && <h4 className="good-text">수입</h4>}
          {inc.map(([k, v]) => <CatBar key={k} label={k} v={v} max={maxCat} />)}
          {out.length > 0 && <h4 className="bad-text">지출</h4>}
          {out.map(([k, v]) => <CatBar key={k} label={k} v={v} max={maxCat} />)}
        </div>
      </div>

      {f.fm >= 5 ? <BudgetCard f={f} bill={bill} setBudgetShift={setBudgetShift} /> : (
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
      )}

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

/** 구간이 있는 게이지: 초록(안전) · 노랑(주의) · 빨강(위반) */
function Gauge({ label, value, max, marks, text }) {
  const at = (v) => `${Math.min(100, (v / max) * 100)}%`
  const tone = value >= marks[1][0] ? 'bad' : value >= marks[0][0] ? 'warn' : 'good'
  return (
    <div className="gauge">
      <div className="gauge-head"><span>{label}</span><b className={`${tone}-text`}>{text}</b></div>
      <div className="gauge-bar" style={{ '--w': at(marks[0][0]), '--r': at(marks[1][0]) }}>
        <i className={tone} style={{ width: at(Math.max(0, value)) }} />
        {marks.map(([v, l]) => <em key={v} style={{ left: at(v) }}><small>{l}</small></em>)}
      </div>
    </div>
  )
}

/** 항목별 수입·지출 막대 */
function CatBar({ label, v, max }) {
  return (
    <div className="cat-bar">
      <span>{label}</span>
      <div><i className={v >= 0 ? 'plus' : 'minus'} style={{ width: `${(Math.abs(v) / max) * 100}%` }} /></div>
      <b className={v >= 0 ? 'good-text' : 'bad-text'}>{v >= 0 ? '+' : '-'}{eur(Math.abs(v))}</b>
    </div>
  )
}
