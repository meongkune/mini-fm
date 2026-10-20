import { useState } from 'react'
import { Kit, Flag } from '../components/Badges.jsx'
import { CondBar } from '../components/Rating.jsx'
import { PRESETS, ROLE_LABEL, buildSlots, fitOf, fitTone, parseShape, roleOf } from '../engine/formation.js'
import { alignLineup, autoSlots, lineupOvr, playerOvr, teamOvr, useGame } from '../store.jsx'
import { unavailable } from '../game/season.js'
import NeedTeam from './NeedTeam.jsx'

export const MENTALITY = [
  ['defensive', '🛡️ 수비적', '실점은 줄이고 역습을 노립니다'],
  ['balanced', '⚖️ 균형', '공수 밸런스를 유지합니다'],
  ['attacking', '🔥 공격적', '득점력이 오르지만 뒷공간이 열립니다'],
]
export const PRESSING = [
  ['low', '낮음', '체력 소모가 적습니다'],
  ['normal', '보통', '기본 압박'],
  ['high', '강함', '점유율이 오르지만 후반에 지칩니다'],
]
export const LINE_OPTS = [
  ['low', '내려서기', '수비가 두꺼워지지만 중원 싸움이 약해집니다'],
  ['normal', '보통', '기본 위치'],
  ['high', '높게', '중원을 장악하고 상대 오프사이드를 유도'],
]
export const TEMPO_OPTS = [
  ['slow', '느리게', '점유하며 패스를 아낍니다'],
  ['normal', '보통', '기본 템포'],
  ['fast', '빠르게', '공격 속도가 오르지만 패스 실수·체력 소모 증가'],
]
export const FIT_LABEL = { best: '본 포지션', good: '비슷한 포지션', ok: '어색함', bad: '부적합' }

export function OptionGroup({ options, value, onChange, cols }) {
  return (
    <div className="options" style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}>
      {options.map(([key, label, desc]) => (
        <button key={key} className={`option ${value === key ? 'on' : ''}`} onClick={() => onChange(key)}>
          <strong>{label}</strong>
          {desc && <span className="small muted">{desc}</span>}
        </button>
      ))}
    </div>
  )
}

/** 포메이션 고르기: 프리셋 칩 + 직접 입력 */
export function FormationPicker({ value, onChange }) {
  const [custom, setCustom] = useState('')
  const [err, setErr] = useState('')
  const isPreset = PRESETS.some(([f]) => f === value)
  const apply = () => {
    const v = custom.trim().replace(/[^0-9-]/g, '')
    if (!parseShape(v)) { setErr('숫자를 -로 이어 필드 플레이어 10명이 되게 적어 주세요 (예: 4-2-3-1, 3-4-2-1)'); return }
    setErr(''); setCustom(''); onChange(v)
  }
  return (
    <>
      <div className="chips-scroll">
        {PRESETS.map(([f]) => <button key={f} className={`chip ${value === f ? 'on' : ''}`} onClick={() => onChange(f)}>{f}</button>)}
        {!isPreset && <button className="chip on">{value} (직접)</button>}
      </div>
      <p className="small muted" style={{ margin: '0 0 8px' }}>{PRESETS.find(([f]) => f === value)?.[1] ?? '직접 만든 전형'}</p>
      <div className="custom-shape">
        <input className="search" value={custom} placeholder="직접 입력 (예: 4-2-3-1, 3-4-1-2)" inputMode="numeric" onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} />
        <button className="btn small" onClick={apply} disabled={!custom.trim()}>적용</button>
      </div>
      {err && <p className="small bad-text">{err}</p>}
    </>
  )
}

/** 세로 경기장 위의 포메이션 자리. 자리를 누르면 onSlot(i) */
export function SlotPitch({ team, formation, lineup, onSlot, active = null, status = {} }) {
  const slots = buildSlots(formation)
  const byId = Object.fromEntries(team.players.map((p) => [p.id, p]))
  return (
    <div className="slot-pitch">
      <div className="sp-lines" aria-hidden="true"><i className="half" /><i className="circle" /><i className="box top" /><i className="box bottom" /></div>
      {slots.map((s, i) => {
        const p = byId[lineup[i]]
        const fit = p ? fitOf(p, s.role) : 0
        const out = p && unavailable(status[p.id])
        return (
          <button key={i} className={`slot ${p ? `fit-${fitTone(fit)}` : 'empty'} ${active === i ? 'active' : ''} ${out ? 'out' : ''}`}
            style={{ left: `${s.x}%`, top: `${100 - s.y}%` }} onClick={() => onSlot(i)} title={ROLE_LABEL[s.role]}>
            {p ? <Kit color={team.color} number={p.number} size={30} /> : <span className="slot-plus">+</span>}
            <span className="slot-role">{s.role}</span>
            {p && <span className="slot-name">{p.name.split(' ').at(-1)}</span>}
            {p && <span className="slot-ovr">{Math.round(playerOvr(p) * fit)}</span>}
            {out && <span className={`slot-out ${out.kind}`}>{out.icon} {out.label}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** 자리 하나에 넣을 선수 고르기 */
export function SlotSheet({ team, formation, lineup, index, status, onPick, onClear, onClose }) {
  const slot = buildSlots(formation)[index]
  const current = lineup[index]
  const where = Object.fromEntries(lineup.map((id, i) => [id, i]).filter(([id]) => id))
  const slots = buildSlots(formation)
  const list = team.players
    .map((p) => ({ p, fit: fitOf(p, slot.role) }))
    .sort((a, b) => playerOvr(b.p) * b.fit - playerOvr(a.p) * a.fit)
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{slot.role} <span className="muted small">{ROLE_LABEL[slot.role]} 자리</span></h3>
          <button className="btn ghost small" onClick={onClose}>닫기</button>
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>오른쪽 숫자는 이 자리에서 실제로 내는 능력치입니다 (OVR × 적합도). <b>선발</b> 표시가 붙은 선수를 고르면 두 선수가 자리를 맞바꿉니다.</p>
        <ul className="pick-list">
          {list.map(({ p, fit }) => {
            const st = status[p.id] || {}
            const out = unavailable(st)
            const tone = fitTone(fit)
            return (
              <li key={p.id}>
                <button className={`pick ${current === p.id ? 'on' : ''} ${where[p.id] !== undefined ? 'in-xi' : ''}`} disabled={out} onClick={() => onPick(p.id)}>
                  <span className={`role-chip ${tone}`}>{roleOf(p)}</span>
                  <span className="lu-name"><Flag nation={p.nation} size={13} /> {p.name}
                    {out && <span className={`out-tag ${out.kind}`}>{out.icon} {out.label} · {out.text}</span>}
                  </span>
                  {current === p.id && <em className="xi-tag here">이 자리</em>}
                  {where[p.id] !== undefined && where[p.id] !== index && <em className="xi-tag">선발 {slots[where[p.id]].role}</em>}
                  <span className={`fit-label ${tone}`}>{FIT_LABEL[tone]}</span>
                  <CondBar value={st.cond} />
                  <b className="pick-ovr">{Math.round(playerOvr(p) * fit)}</b>
                </button>
              </li>
            )
          })}
        </ul>
        {current && <button className="btn ghost wide" onClick={onClear}>이 자리 비우기</button>}
      </div>
    </div>
  )
}

/** 자리 배정 변경: 다른 자리에 있던 선수면 서로 맞바꾼다 */
export function placeInSlot(lineup, index, playerId) {
  const next = [...lineup]
  const from = next.indexOf(playerId)
  if (from >= 0) next[from] = next[index] ?? null
  next[index] = playerId
  return next
}

export default function Tactics() {
  const { myTeam, save, update, status } = useGame()
  const [slot, setSlot] = useState(null)
  if (!myTeam) return <NeedTeam />

  const formation = save.formation
  const slots = buildSlots(formation)
  const lineup = Array.from({ length: slots.length }, (_, i) => save.lineup[i] ?? null)
  const byId = Object.fromEntries(myTeam.players.map((p) => [p.id, p]))
  const filled = lineup.filter(Boolean)
  const avgFit = filled.length ? Math.round((filled.reduce((s, id, i) => s + fitOf(byId[id], slots[lineup.indexOf(id)].role), 0) / filled.length) * 100) : 0
  const bench = myTeam.players.filter((p) => !lineup.includes(p.id)).sort((a, b) => playerOvr(b) - playerOvr(a))

  const changeFormation = (f) => update({ formation: f, lineup: (() => {
    // 고른 선수는 그대로 두고 새 전형의 자리로 옮긴 뒤, 빈 자리만 채운다
    // 단, 새 자리에서 같은 포지션 계열(적합도 0.82) 미만이 되는 선수는 빼고 알맞은 선수로 채운다
    const kept = alignLineup(myTeam, f, lineup)
    const roles = buildSlots(f).map((s) => s.role)
    const keep = Object.fromEntries(kept.map((id, i) => [i, id]).filter(([i, id]) => id && fitOf(byId[id], roles[i]) >= 0.82))
    return autoSlots(myTeam, f, status, keep)
  })() })

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>전술</h1>
          <p className="muted">경기장의 자리를 눌러 선수를 배치하세요 · 적합도 {avgFit}% · 라인업 OVR <b className={lineupOvr(myTeam, formation, lineup) < teamOvr(myTeam) - 2 ? 'bad-text' : ''}>{lineupOvr(myTeam, formation, lineup)}</b></p>
        </div>
        <button className="btn small" onClick={() => update({ lineup: autoSlots(myTeam, formation, status) })}>⚡ 자동 배치</button>
      </div>

      <div className="card">
        <h3>포메이션 <span className="muted small">{formation}</span></h3>
        <FormationPicker value={formation} onChange={changeFormation} />
      </div>

      <div className="card">
        <SlotPitch team={myTeam} formation={formation} lineup={lineup} onSlot={setSlot} active={slot} status={status} />
        <div className="fit-legend">
          {Object.entries(FIT_LABEL).map(([k, l]) => <span key={k}><i className={`fit-dot ${k}`} />{l}</span>)}
        </div>
      </div>

      <div className="card">
        <h3>벤치 <span className="muted small">{bench.length}명</span></h3>
        <div className="bench">
          {bench.map((p) => (
            <span key={p.id} className={`bench-chip ${unavailable(status[p.id]) ? `out ${unavailable(status[p.id]).kind}` : ''}`} title={unavailable(status[p.id])?.text}>
              <span className="role-chip">{roleOf(p)}</span>{p.name.split(' ').at(-1)} <b>{playerOvr(p)}</b>
              {unavailable(status[p.id]) && <i className="bench-out">{unavailable(status[p.id]).icon} {unavailable(status[p.id]).games}경기</i>}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>팀 지시</h3>
        <h4>경기 운영</h4>
        <OptionGroup options={MENTALITY} value={save.mentality} onChange={(mentality) => update({ mentality })} />
        <h4>압박 강도</h4>
        <OptionGroup options={PRESSING} value={save.pressing} onChange={(pressing) => update({ pressing })} />
        <h4>수비 라인</h4>
        <OptionGroup options={LINE_OPTS} value={save.line || 'normal'} onChange={(line) => update({ line })} />
        <h4>템포</h4>
        <OptionGroup options={TEMPO_OPTS} value={save.tempo || 'normal'} onChange={(tempo) => update({ tempo })} />
      </div>

      {slot !== null && (
        <SlotSheet team={myTeam} formation={formation} lineup={lineup} index={slot} status={status}
          onPick={(id) => { update({ lineup: placeInSlot(lineup, slot, id) }); setSlot(null) }}
          onClear={() => { const next = [...lineup]; next[slot] = null; update({ lineup: next }); setSlot(null) }}
          onClose={() => setSlot(null)} />
      )}
    </section>
  )
}
