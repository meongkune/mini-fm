import { useState } from 'react'
import { Link } from 'react-router-dom'
import PlayerCard from '../components/PlayerCard.jsx'
import PlayerSheet from '../components/PlayerSheet.jsx'
import Rating, { CondBar } from '../components/Rating.jsx'
import { Flag } from '../components/Badges.jsx'
import { moraleLabel, unavailable } from '../game/season.js'
import { bestEmptySlot, formationNeeds, lineupOvr, playerOvr, teamOvr, useGame } from '../store.jsx'
import { buildSlots, fitOf, fitTone, roleOf } from '../engine/formation.js'
import NeedTeam from './NeedTeam.jsx'

const POS_LABEL = { GK: '골키퍼', DF: '수비수', MF: '미드필더', FW: '공격수' }

export default function Squad() {
  const { myTeam, save, update, autoPick, status } = useGame()
  const [msg, setMsg] = useState('')
  const [view, setView] = useState('card')
  const [detail, setDetail] = useState(null)
  if (!myTeam) return <NeedTeam />

  const needs = formationNeeds(save.formation)
  const slotCount = buildSlots(save.formation).length
  const lineup = Array.from({ length: slotCount }, (_, i) => save.lineup[i] ?? null)
  const selected = new Set(lineup.filter(Boolean))
  // 자리 기준: 선수가 지금 뛰는 자리와 그 자리 적합도
  const slotRoles = buildSlots(save.formation).map((s) => s.role)
  const byId = Object.fromEntries(myTeam.players.map((p) => [p.id, p]))
  const slotOf = Object.fromEntries(lineup.map((id, i) => [id, i]).filter(([id]) => id && byId[id]))
  const placed = (p) => (slotOf[p.id] !== undefined ? { role: slotRoles[slotOf[p.id]], fit: fitOf(p, slotRoles[slotOf[p.id]]) } : null)
  const misfits = lineup.map((id, i) => byId[id] && { p: byId[id], role: slotRoles[i], fit: fitOf(byId[id], slotRoles[i]) }).filter((x) => x && x.fit < 0.82)
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 }
  myTeam.players.forEach((p) => { if (selected.has(p.id)) counts[p.pos]++ })
  const ok = selected.size === 11 && !misfits.length
  const nowOvr = lineupOvr(myTeam, save.formation, lineup)
  const bestOvr = teamOvr(myTeam)
  const out = (id) => status[id]?.inj > 0 || status[id]?.susp > 0
  const blocked = lineup.filter((id) => id && out(id))
  const tired = lineup.filter((id) => id && (status[id]?.cond ?? 100) < 70 && !out(id))

  const toggle = (p) => {
    if (selected.has(p.id)) return update({ lineup: lineup.map((id) => (id === p.id ? null : id)) })
    if (out(p.id)) return setMsg(`${p.name} 선수는 출전할 수 없습니다 — ${unavailable(status[p.id]).label}: ${unavailable(status[p.id]).text}`)
    const i = bestEmptySlot(save.formation, lineup, p)
    if (i < 0) return setMsg('빈 자리가 없습니다. 먼저 다른 선수를 빼거나 전술 화면에서 자리를 바꾸세요.')
    const next = [...lineup]
    next[i] = p.id
    update({ lineup: next })
    setMsg(`${p.name} → ${buildSlots(save.formation)[i].role} 자리`)
  }

  const auto = () => {
    update({ lineup: autoPick(save.formation) })
    setMsg(`${save.formation}에 맞춰 컨디션까지 고려한 베스트 11을 골랐습니다.`)
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>스쿼드</h1>
          <p className="muted">{view === 'card' ? '카드를 눌러 선발에 넣거나 뺍니다' : '선수를 누르면 상세 정보와 면담'} · {save.formation}</p>
        </div>
        <button className="btn" onClick={auto}>⚡ 자동 선발</button>
      </div>

      <div className={`card lineup-status ${ok && !blocked.length ? 'ok' : 'warn'}`}>
        <div className="ls-ovr">
          <span><small>라인업 OVR</small><b className={nowOvr < bestOvr - 2 ? 'bad-text' : ''}>{nowOvr}</b></span>
          <span className="muted"><small>최고 전력</small><b>{bestOvr}</b></span>
          <strong className="grow">선발 {selected.size} / 11</strong>
        </div>
        {misfits.length > 0 && (
          <ul className="ls-misfit">
            {misfits.map(({ p, role, fit }) => (
              <li key={p.id} className={fitTone(fit)}>⚠️ <b>{p.name.split(' ').at(-1)}</b> 본 포지션 {roleOf(p)} → <b>{role}</b> 자리 · 능력 {Math.round(fit * 100)}%만 발휘</li>
            ))}
          </ul>
        )}
        {blocked.length > 0 && <span className="small bad-text">출전 불가 {blocked.length}명 포함</span>}
        {!blocked.length && tired.length > 0 && <span className="small">지친 선수 {tired.length}명 (컨디션 70% 미만)</span>}
        {!blocked.length && !tired.length && !misfits.length && <span className="small">{selected.size === 11 ? '모든 선수가 맞는 자리에 있습니다' : `${11 - selected.size}자리가 비어 있습니다`}</span>}
      </div>
      {msg && <p className="toast" onAnimationEnd={() => setMsg('')}>{msg}</p>}

      <div className="row between" style={{ marginBottom: 10 }}>
        <div className="seg small inline">
          <button className={view === 'card' ? 'on' : ''} onClick={() => setView('card')}>카드</button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>상태표</button>
        </div>
        <Link className="link" to="/transfer">🔄 이적 시장 →</Link>
      </div>

      {view === 'card' && (
        <>
          <div className="tier-legend">
            <span><i style={{ background: 'var(--tier-elite)' }} />엘리트 88+</span>
            <span><i style={{ background: 'var(--tier-gold)' }} />골드 82+</span>
            <span><i style={{ background: 'var(--tier-silver)' }} />실버 76+</span>
            <span><i style={{ background: 'var(--tier-bronze)' }} />브론즈</span>
          </div>
          {['GK', 'DF', 'MF', 'FW'].map((pos) => {
            const players = myTeam.players.filter((p) => p.pos === pos).sort((a, b) => playerOvr(b) - playerOvr(a))
            return (
              <div key={pos} className="squad-group">
                <h3>{POS_LABEL[pos]} <span className="muted small">선발 {counts[pos]}명 · 이 전형은 {needs[pos]}자리</span></h3>
                <div className="card-grid">
                  {players.map((p) => <PlayerCard key={p.id} player={p} color={myTeam.color} status={status[p.id]} selected={selected.has(p.id)} slot={placed(p)} onClick={() => toggle(p)} />)}
                </div>
              </div>
            )
          })}
        </>
      )}

      {view === 'list' && (
        <div className="card flush">
          <table className="sq">
            <thead><tr><th /><th className="left">선수</th><th>OVR</th><th>컨디션</th><th>사기</th><th>폼</th><th>G/A</th></tr></thead>
            <tbody>
              {['GK', 'DF', 'MF', 'FW'].flatMap((pos) => myTeam.players.filter((p) => p.pos === pos).sort((a, b) => playerOvr(b) - playerOvr(a))).map((p) => {
                const st = status[p.id] || {}
                const ps = save.pstats?.[p.id]
                return (
                  <tr key={p.id} className={`${selected.has(p.id) ? 'sel' : ''} ${out(p.id) ? 'out' : ''}`} onClick={() => setDetail(p)}>
                    <td className="sq-sel">{placed(p) ? <span className={`slot-tag ${fitTone(placed(p).fit)}`}>{placed(p).role}</span> : ''}</td>
                    <td className="left">
                      <div className="sq-name">
                        <span className="lu-pos">{roleOf(p)}</span>
                        <Flag nation={p.nation} size={14} /><strong>{p.name}</strong>
                        {st.wantsOut && <em>✈️</em>}
                      </div>
                      {unavailable(st) && <span className={`out-tag ${unavailable(st).kind}`}>{unavailable(st).icon} {unavailable(st).text}</span>}
                    </td>
                    <td><b>{playerOvr(p)}</b></td>
                    <td><CondBar value={st.cond} /></td>
                    <td>{moraleLabel(st.morale)[0]}</td>
                    <td>{st.fr?.length ? <Rating value={st.form} /> : <span className="muted">-</span>}</td>
                    <td className="muted">{ps ? `${ps.g}/${ps.a}` : '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {detail && <PlayerSheet player={detail} onClose={() => setDetail(null)} inLineup={selected.has(detail.id)} onToggle={() => toggle(detail)} />}
    </section>
  )
}
