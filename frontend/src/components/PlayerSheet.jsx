// 선수 상세: 상태(컨디션·사기·폼·부상·징계), 시즌 기록, 선발 넣기/빼기, 개별 면담
import { useEffect, useState } from 'react'
import { fetchProfile } from '../game/wiki.js'
import PlayerCard from './PlayerCard.jsx'
import AttrRadar from './AttrRadar.jsx'
import { AbilityStars } from './Stars.jsx'
import { Flag, nationName } from './Badges.jsx'
import Rating, { CondBar } from './Rating.jsx'
import { PLAYER_TALKS, moraleLabel } from '../game/season.js'
import { personality, personalityText } from '../game/speech.js'
import TalkRoom from './TalkRoom.jsx'
import { applyDeal, situationOf } from '../game/aiTalk.js'
import { eur, yearsLeft } from '../game/finance.js'
import { useGame } from '../store.jsx'

export default function PlayerSheet({ player, onClose, inLineup, onToggle }) {
  const { status, save, talkTo, myTeam, teams, finishTalk, totalRounds, contractOf, renewalAsk, renew, releaseCost, release, forceSell, addPromise, isLoanIn, loanOptions, loanOut, transferWindow, clearNotForSale, buyLoan } = useGame()
  const [optMsg, setOptMsg] = useState('')
  const [nego, setNego] = useState(null) // 연봉 협상 대화 (재계약)
  const [negoMsg, setNegoMsg] = useState('')
  const [battle, setBattle] = useState(false)
  const [deal, setDeal] = useState(null)
  const [reply, setReply] = useState('')
  const [profile, setProfile] = useState(null)
  useEffect(() => {
    if (!player) return
    let alive = true
    setProfile(null)
    fetchProfile(player).then((p) => alive && setProfile(p))
    return () => { alive = false }
  }, [player?.id])
  if (!player) return null
  const st = status[player.id] || {}
  const ps = save.pstats?.[player.id]
  const [face, mLabel, mTone] = moraleLabel(st.morale)
  const mine = myTeam?.players.some((p) => p.id === player.id)
  const talked = save.status?.[player.id]?.talkRound === save.round

  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{player.name}</h3>
          <button className="btn ghost small" onClick={onClose}>닫기</button>
        </div>
        <div className="ps-top">
          <PlayerCard player={player} size="lg" color={teams.find((t) => t.players.some((p) => p.id === player.id))?.color} />
          <div className="ps-status">
            <div className="ps-row ps-stars"><AbilityStars player={player} /></div>
            {(player.height || profile?.height) && <div className="ps-row"><span>키</span><b>{player.height || profile.height}cm</b></div>}
            <div className="ps-row"><span>나이 · 국적</span><b>{player.age}세 <Flag nation={player.nation} size={16} /> {nationName(player.nation)}</b></div>
            <div className="ps-row"><span>컨디션</span><b><CondBar value={st.cond} /> {Math.round(st.cond ?? 100)}%</b></div>
            <div className="ps-row"><span>사기</span><b className={`mood ${mTone}`}>{face} {mLabel}</b></div>
            <div className="ps-row"><span>최근 폼</span><b className="ps-form">{(st.fr || []).length ? st.fr.map((r, i) => <Rating key={i} value={r} />) : <span className="muted small">기록 없음</span>}</b></div>
            {st.inj > 0 && <div className="ps-row bad"><span>부상</span><b>🚑 {st.injKind || '부상'} · {st.inj}경기 결장</b></div>}
            {st.susp > 0 && <div className="ps-row bad"><span>징계</span><b>🟥 {st.suspWhy || '징계'} · {st.susp}경기 출전 정지</b></div>}
            {st.wantsOut && <div className="ps-row bad"><span>상태</span><b>✈️ 이적 요청</b></div>}
            {(st.promises || []).map((pr) => <div key={pr.kind} className="ps-row"><span>약속</span><b>{pr.text}</b></div>)}
          </div>
        </div>

        <h4>세부 능력치 <span className="muted small">1~20점 · {player.role || player.pos} 기준</span></h4>
        <AttrRadar player={player} color={teams.find((t) => t.players.some((p) => p.id === player.id))?.color} sta={player.sta} />


        <h4>이번 시즌</h4>
        <div className="ps-season">
          {[['경기', ps?.apps ?? 0], ['골', ps?.g ?? 0], ['도움', ps?.a ?? 0], ['평점', ps?.apps ? (ps.rsum / ps.apps).toFixed(2) : '-'], ['MOM', ps?.mom ?? 0], ['경고', ps?.yc ?? 0]].map(([l, v]) => (
            <div key={l}><b>{v}</b><span>{l}</span></div>
          ))}
        </div>

        {mine && (
          <>
            {onToggle && (
              <button className={`btn wide ${inLineup ? 'ghost' : ''}`} disabled={!inLineup && (st.inj > 0 || st.susp > 0)} onClick={onToggle}>
                {inLineup ? '선발에서 빼기' : st.inj > 0 || st.susp > 0 ? '출전 불가' : '선발에 넣기'}
              </button>
            )}
            {isLoanIn(player.id) ? (
              <div className="contract-box">
                <h4>임대 선수</h4>
                <p className="small">🔁 {save.loans[player.id].club}에서 시즌 끝까지 임대 왔습니다. 연봉 {Math.round((save.loans[player.id].share ?? 1) * 100)}% 부담 ({eur(contractOf(player).wage)}/년). 시즌이 끝나면 돌아가며, 재계약·판매·방출은 할 수 없습니다.</p>
                {save.loans[player.id].option ? (
                  <>
                    <p className="small">✍️ 완전 영입 옵션: <b>{eur(save.loans[player.id].option)}</b>을 내면 시즌이 끝나기 전 언제든 완전히 데려올 수 있습니다 (3년 계약).</p>
                    <button className="btn small wide" onClick={() => { if (!confirm(`${player.name}을(를) ${eur(save.loans[player.id].option)}에 완전 영입할까요?`)) return; const r = buyLoan(player, 3); setOptMsg(r.ok ? `✍️ 완전 영입 완료 — 연봉 ${eur(r.wage)}/년` : r.reason) }}>✍️ 완전 영입 옵션 행사 ({eur(save.loans[player.id].option)})</button>
                  </>
                ) : null}
                {optMsg && <p className="small notice">{optMsg}</p>}
              </div>
            ) : (
              <>
                <ContractBox player={player} save={save} contractOf={contractOf} renewalAsk={renewalAsk} renew={renew} releaseCost={releaseCost}
                  onNego={(ask) => { setNegoMsg(''); setNego(ask) }} negoMsg={negoMsg}
                  onRelease={() => { if (confirm(`${player.name}을(를) 방출할까요? 위약금 ${eur(releaseCost(player))}`)) { release(player); onClose() } }}
                  onSell={() => { if (confirm(`${player.name}을(를) 감독·선수 의사와 상관없이 즉시 팔까요? (가치의 60~120%)`)) { setDeal(forceSell(player)) } }} />
                {optMsg && <p className="small notice">{optMsg}</p>}
                {save.sellOnOwed?.[player.id] && <p className="small notice">📎 셀온 약속: 이 선수를 팔면 이적료의 {save.sellOnOwed[player.id].pct}%를 {save.sellOnOwed[player.id].club}에 줘야 합니다.</p>}
                {save.notForSale?.[player.id] === (save.seasonNo || 1) && (
                  <p className="small notice">🔒 판매 불가 선언 중 — 이번 시즌 이 선수에게 오는 이적 제안을 모두 거절합니다. <button className="linkish" onClick={() => clearNotForSale(player.id)}>해제</button></p>
                )}
                <LoanOutBox player={player} open={transferWindow.open} options={loanOptions} onLoan={(o, withOption) => { const r = loanOut(player, o, withOption); if (r.ok) onClose(); else alert(r.reason) }} />
              </>
            )}
            {nego && (
              <TalkRoom player={player} team={myTeam} status={st} topic="contract" totalRounds={totalRounds} wage={contractOf(player).wage}
                deal={{ kind: 'renew', ask: nego.wage, current: contractOf(player).wage, maxYears: nego.maxYears }}
                reason="재계약 조건을 이야기하러 왔음"
                situation={situationOf(player, myTeam, st, { contractYears: yearsLeft(save, contractOf(player)), inLineup, round: save.round, apps: save.pstats?.[player.id]?.apps ?? 0 })}
                onClose={() => setNego(null)}
                onFinish={(r) => {
                  finishTalk(player.id, r)
                  if (r.deal) { const x = applyDeal({ player, deal: r.deal, renew, addPromise, round: save.round }); setNegoMsg(x.ok ? `✍️ 재계약 합의: 연봉 €${r.deal.wage}M × ${r.deal.years}년${r.deal.raise ? ' · 활약 시 인상 약속' : ''}` : `⚠️ ${x.reason}`) }
                  setNego(null)
                }} />
            )}
            {deal && <p className="notice ok">💸 {deal.buyer}에 {eur(deal.fee)}에 팔았습니다. <button className="linkish" onClick={onClose}>닫기</button></p>}
            <h4>개별 면담 <span className="muted small">{talked ? '이번 라운드 면담 완료' : '라운드당 1회 · 최근 폼에 맞는 말을 해야 효과가 있습니다'}</span></h4>
            <div className="options">
              {PLAYER_TALKS.map(([k, label, desc]) => (
                <button key={k} className="option" disabled={talked} onClick={() => setReply(talkTo(player.id, k))}>
                  <strong>{label}</strong><span className="small muted">{desc}</span>
                </button>
              ))}
            </div>
            {reply && <p className="notice">{reply}</p>}
            <h4>대화 면담 <span className="muted small">성격: {personalityText(personality(player)).join(' · ')}</span></h4>
            <button className="btn wide talk-start" disabled={talked} onClick={() => setBattle(true)}>🗣️ {talked ? '이번 라운드 면담 완료' : st.wantsOut ? '이적 문제로 면담하기' : '면담하기'}</button>
            {battle && (
              <TalkRoom player={player} team={myTeam} status={st} topic={st.wantsOut ? 'transfer' : 'general'}
                wage={contractOf(player).wage} totalRounds={totalRounds}
                situation={situationOf(player, myTeam, st, { contractYears: yearsLeft(save, contractOf(player)), inLineup, round: save.round, apps: save.pstats?.[player.id]?.apps ?? 0 })}
                onClose={() => setBattle(false)}
                onFinish={(r) => { finishTalk(player.id, r); setBattle(false) }} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

// 위키백과 프로필: 사진·한글 이름·소개·키·생년월일·출생지·실제 포지션

// 계약: 남은 기간·연봉, 재계약 제안, 방출, 강제 매각
/** 임대 보내기: 출전 기회가 있는 구단 후보 (상대가 연봉 전부 부담, 시즌 끝나면 복귀) */
function LoanOutBox({ player, open, options, onLoan }) {
  const [show, setShow] = useState(false)
  if (!show) return <button className="btn ghost small wide" onClick={() => setShow(true)}>🔁 임대 보내기</button>
  const list = options(player)
  return (
    <div className="contract-box">
      <h4>임대 보내기 <span className="muted small">시즌 끝까지 · 상대가 연봉 전부 부담</span></h4>
      {!open ? <p className="small bad-text">이적 시장이 닫혀 있습니다.</p>
        : !list.length ? <p className="small muted">이 선수에게 출전 기회를 줄 구단이 리그 안에 없습니다.</p>
          : list.map((o) => (
            <div key={o.team.id} className="row loan-opt">
              <span className="small"><b>{o.team.name}</b> · {o.role} · 임대료 {eur(o.fee)}</span>
              <button className="btn small" onClick={() => { if (confirm(`${player.name}을(를) ${o.team.name}에 시즌 끝까지 임대 보낼까요? (임대료 ${eur(o.fee)})`)) onLoan(o, false) }}>보내기</button>
              <button className="btn small ghost" title="시즌이 끝날 때 그 구단이 선수를 마음에 들어 하면 미리 정한 금액(지금 몸값의 110%)에 완전히 데려갑니다" onClick={() => { if (confirm(`${player.name}을(를) ${o.team.name}에 완전 영입 옵션을 붙여 임대 보낼까요? 시즌이 끝날 때 그 구단이 원하면 지금 몸값의 110%를 내고 완전히 데려갑니다.`)) onLoan(o, true) }}>옵션 포함</button>
            </div>
          ))}
      <p className="small muted">어린 선수·후보 선수는 출전 기회가 생겨 반기지만, 주전급 베테랑은 서운해합니다. '옵션 포함'으로 보내면 시즌이 끝날 때 그 구단이 선수를 완전히 사 갈 수 있습니다(지금 몸값의 110%).</p>
    </div>
  )
}

function ContractBox({ player, save, contractOf, renewalAsk, renew, onRelease, onSell, releaseCost, onNego, negoMsg }) {
  const c = contractOf(player)
  const left = yearsLeft(save, c)
  const ask = renewalAsk(player)
  const [years, setYears] = useState(Math.min(2, ask.maxYears || 1))
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  return (
    <div className="contract-box">
      <h4>계약</h4>
      <div className="ct-grid">
        <div><span>연봉 <em className={`wage-src ${c.real ? 'real' : ''}`} title={c.real ? '실제 보도 연봉' : '능력·구단 규모로 추정한 연봉'}>{c.real ? '실제 보도' : c.renewed ? '재계약' : '추정'}</em></span><b>{eur(c.wage)}</b></div>
        <div><span>남은 기간</span><b className={left <= 1 ? 'bad-text' : ''}>{left <= 1 ? '이번 시즌까지' : `${left}년`}</b></div>
        <div><span>방출 위약금</span><b>{eur(releaseCost(player))}</b></div>
      </div>
      {ask.refuse ? <p className="small bad-text">재계약 불가: {ask.refuse}</p> : !done ? (
        <div className="renew">
          <span className="small">재계약 요구 연봉 <b>{eur(ask.wage)}</b>/년 ·</span>
          <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
            {Array.from({ length: ask.maxYears }, (_, i) => i + 1).map((y) => <option key={y} value={y}>{y}년 연장</option>)}
          </select>
          <button className="btn small" onClick={() => { const r = renew(player, years, ask.wage); if (r?.ok === false) setErr(r.reason); else setDone(true) }}>재계약</button>
        </div>
      ) : <p className="small good-text">✍️ 재계약 완료</p>}
      {err && <p className="small bad-text">{err}</p>}
      {!ask.refuse && <button className="btn small talk-start" onClick={() => onNego?.(ask)}>🗣️ 대화로 연봉 협상 (금액·기간·인상 약속)</button>}
      {negoMsg && <p className="small notice">{negoMsg}</p>}
      <div className="row">
        <button className="btn ghost small" onClick={onRelease}>🚪 방출</button>
        <button className="btn ghost small" onClick={onSell}>💸 강제 매각</button>
      </div>
    </div>
  )
}
