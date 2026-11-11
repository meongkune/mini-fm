import Avatar from '../components/Avatar.jsx'
import Stars, { abilityStars } from '../components/Stars.jsx'
import { baseOf, isCustom, layoutShift, roleAt } from '../engine/formation.js'
import { useMemo, useRef, useState } from 'react'
import Matchups from '../components/Matchups.jsx'
import { AI_STYLE, aiStyle, createMatch } from '../engine/match.js'
import { styleName } from '../engine/tactics.js'
import { Kit, Flag } from '../components/Badges.jsx'
import { CondBar } from '../components/Rating.jsx'
import { PRESETS, ROLE_LABEL, buildSlots, fitOf, fitTone, parseShape, roleOf } from '../engine/formation.js'
import { alignLineup, autoSlots, lineupOvr, myTactics, playerOvr, teamOvr, useGame } from '../store.jsx'
import TacticsPanel from '../components/TacticsPanel.jsx'
import { unavailable } from '../game/season.js'
import { keyAttrs20, roleScore } from '../game/attributes.js'
import NeedTeam from './NeedTeam.jsx'
import usePitchDrag from '../components/usePitchDrag.js'

export const MENTALITY = [
  ['parkbus', '🚌 버스 세우기', '골문 앞에 벽을 쌓습니다. 득점은 거의 포기'],
  ['defensive', '🛡️ 수비적', '실점은 줄이고 역습을 노립니다'],
  ['balanced', '⚖️ 균형', '공수 밸런스를 유지합니다'],
  ['attacking', '🔥 공격적', '득점력이 오르지만 뒷공간이 열립니다'],
  ['allout', '💥 노빠꾸', '전원 공격! 넣는 만큼 먹힐 수도 있습니다'],
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
export function SlotPitch({ team, formation, lineup, onSlot, active = null, status = {}, dnd = null, edit = false, onLayout = null }) {
  const base = buildSlots(formation)
  const [moving, setMoving] = useState(null) // 자리 조정 중: { i, pos: [{x,y}] }
  const ref = useRef(null)
  const slots = moving ? base.map((s, i) => (i === 0 ? s : { role: roleAt(moving.pos[i].x, moving.pos[i].y), x: moving.pos[i].x, y: moving.pos[i].y })) : base
  const byId = Object.fromEntries(team.players.map((p) => [p.id, p]))
  // 자리 조정: 누른 자리를 손가락·마우스를 따라 옮기고, 떼면 저장 (골키퍼는 고정)
  const startMove = (i, e) => {
    if (!edit || i === 0 || e.button > 0) return
    e.preventDefault()
    const pos = base.map((s) => ({ x: s.x, y: s.y }))
    const at = (ev) => {
      const r = ref.current.getBoundingClientRect()
      return { x: Math.round(Math.max(5, Math.min(95, ((ev.clientX - r.left) / r.width) * 100))), y: Math.round(Math.max(14, Math.min(90, 100 - ((ev.clientY - r.top) / r.height) * 100))) }
    }
    let cur = pos
    setMoving({ i, pos })
    const move = (ev) => { ev.preventDefault(); cur = cur.map((p, j) => (j === i ? at(ev) : p)); setMoving({ i, pos: cur }) }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setMoving(null)
      onLayout?.(cur)
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  return (
    <div className={`slot-pitch ${edit ? 'editing' : ''}`} ref={ref}>
      <div className="sp-lines" aria-hidden="true"><i className="half" /><i className="circle" /><i className="box top" /><i className="box bottom" /></div>
      {edit && [[32, '수비'], [42, '수비형 미드'], [62, '중원'], [76, '공격형 미드 · 윙어']].map(([y, l]) => <div key={y} className="zone-guide" style={{ top: `${100 - y}%` }}><small>{l} ↓</small></div>)}
      {slots.map((s, i) => {
        const p = byId[lineup[i]]
        const fit = p ? fitOf(p, s.role) : 0
        const out = p && unavailable(status[p.id])
        return (
          <button key={i} data-slot={i} className={`slot ${p ? `fit-${fitTone(fit)}` : 'empty'} ${active === i ? 'active' : ''} ${out ? 'out' : ''} ${dnd?.drag?.over === i ? 'drop' : ''} ${dnd?.drag && dnd.drag.id === p?.id ? 'lifted' : ''} ${moving?.i === i ? 'moving' : ''}`}
            style={{ left: `${s.x}%`, top: `${100 - s.y}%` }} title={ROLE_LABEL[s.role]}
            onPointerDown={edit ? (e) => startMove(i, e) : dnd ? (e) => dnd.startSlot(i, p?.id ?? null, e) : undefined}
            onClick={edit || dnd ? undefined : () => onSlot(i)}>
            {p ? <Kit color={team.color} number={p.number} size={30} /> : <span className="slot-plus">+</span>}
            <span className="slot-role">{s.role}</span>
            {p && <span className="slot-name">{p.name.split(' ').at(-1)}</span>}
            {p && <span className="slot-ovr" title={`이 자리 능력 (적합도 ${Math.round(fit * 100)}%)`}>{Math.round(roleScore(p, s.role) * fit)}<small>{Math.round(fit * 100)}%</small></span>}
            {out && <span className={`slot-out ${out.kind}`}>{out.icon} {out.label}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** 직접 조정한 배치가 전술에 주는 효과 */
function LayoutEffects({ formation }) {
  const g = layoutShift(formation)
  if (!g.d) return null
  const items = []
  if (Math.abs(g.d.dfY) >= 3) items.push(g.d.dfY > 0 ? ['mid', `수비 라인 높음 (+${Math.round(g.line)}): 압박·오프사이드 ↑, 상대 역습에 뒷공간 위험`] : ['mid', `수비 라인 낮음 (${Math.round(g.line)}): 뒷공간은 안전, 중원 장악력 ↓`])
  if (Math.abs(g.d.width) >= 3) items.push(g.d.width > 0 ? ['good', `폭 넓음 (+${Math.round(g.width)}): 측면 공격 ↑ (측면 자원이 적은 상대에 강함)`] : ['mid', `폭 좁음 (${Math.round(g.width)}): 중앙이 촘촘, 내려앉은 상대 공략은 어려움`])
  if (Math.abs(g.att) >= 0.5 || Math.abs(g.def) >= 0.5) items.push([g.att > g.def ? 'good' : 'mid', `팀 전진 정도·선수 간격: 공격 ${g.att >= 0 ? '+' : ''}${g.att.toFixed(1)} · 수비 ${g.def >= 0 ? '+' : ''}${g.def.toFixed(1)}`])
  if (!items.length) return <p className="small muted">기본 위치와 거의 같습니다.</p>
  return <ul className="layout-fx">{items.map(([t, x], i) => <li key={i} className={t}>📐 {x}</li>)}</ul>
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

// 전술 저장 칸에 담는 것: 전형(직접 조정한 위치 포함)·선발·팀 지시·세트피스
const SET_KEYS = ['formation', 'layout', 'lineup', 'mentality', 'pressing', 'line', 'tempo', 'width', 'passing', 'approach', 'focus', 'trap', 'tackling', 'corner', 'cornerDef', 'spTaker', 'penTaker']
/**
 * 전술 저장 칸 A·B·C: 지금 전술을 통째로 저장해 두고 언제든 불러온다 (다른 전형을 시험해도 공들인 배치를 잃지 않게)
 * 불러올 때 팀을 떠났거나 다치거나 징계 중인 선수 자리만 알맞은 선수로 채운다
 */
function TacSets({ save, update, team, status }) {
  const sets = save.tacSets || {}
  const ids = new Set(team.players.map((p) => p.id))
  const saveTo = (k) => {
    if (sets[k] && !confirm(`${k} 칸에 저장된 전술(${sets[k].formation})을 지금 전술로 덮어쓸까요?`)) return
    update({ tacSets: { ...sets, [k]: Object.fromEntries(SET_KEYS.map((x) => [x, save[x] ?? null])) }, tacSet: k })
  }
  const load = (k) => {
    const t = sets[k]
    if (!t) return
    const keep = Object.fromEntries((t.lineup || []).map((id, i) => [i, id]).filter(([, id]) => id && ids.has(id) && !unavailable(status[id])))
    const lineup = autoSlots(team, t.formation, status, keep)
    const missing = (t.lineup || []).filter((id) => id && !Object.values(keep).includes(id)).length
    update({ ...Object.fromEntries(SET_KEYS.filter((x) => x !== 'lineup').map((x) => [x, t[x] ?? undefined])), lineup, tacSet: k })
    if (missing) alert(`${k} 전술을 불러왔습니다. 팀을 떠났거나 뛸 수 없는 선수 ${missing}명의 자리는 알맞은 선수로 채웠습니다.`)
  }
  return (
    <div className="card tac-sets">
      <h3>전술 저장 <span className="muted small">지금 전형·선발·자리 조정·팀 지시를 통째로 저장해 두고 불러오기</span></h3>
      <div className="ts-row">
        {['A', 'B', 'C'].map((k) => (
          <div key={k} className={`ts-slot ${save.tacSet === k ? 'on' : ''}`}>
            <b>{k}</b>
            <small>{sets[k] ? `${baseOf(sets[k].formation)}${isCustom(sets[k].formation) ? ' · 직접 조정' : ''}` : '비어 있음'}</small>
            <span>
              <button className="btn small ghost" onClick={() => saveTo(k)}>저장</button>
              <button className="btn small" disabled={!sets[k]} onClick={() => load(k)}>불러오기</button>
            </span>
          </div>
        ))}
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
  const { myTeam, save, update, status, nextFixture } = useGame()
  // 다음 상대와의 개인 매치업: 지금 선발·전술로 경기 상태를 미리 만들어 본다 (선발이나 지시를 바꾸면 바로 다시 계산)
  const preview = useMemo(() => {
    if (!myTeam || !nextFixture?.homeTeam || !nextFixture?.awayTeam) return null
    const myCfg = { lineup: save.lineup, tactics: myTactics(save) }
    const isHome = nextFixture.isHome
    const match = createMatch({ home: nextFixture.homeTeam, away: nextFixture.awayTeam, homeCfg: isHome ? myCfg : {}, awayCfg: isHome ? {} : myCfg, status, myIdx: isHome ? 0 : 1, seed: 1 })
    return { match, ctx: { teams: [nextFixture.homeTeam, nextFixture.awayTeam], status }, myIdx: isHome ? 0 : 1, opp: isHome ? nextFixture.awayTeam : nextFixture.homeTeam }
  }, [myTeam, nextFixture, save, status])
  const [slot, setSlot] = useState(null)
  const [edit, setEdit] = useState(false) // 자리 조정 모드: 자리 표시를 끌어 위치를 바꾼다
  const lineupNow = () => Array.from({ length: buildSlots(save.formation).length }, (_, i) => save.lineup[i] ?? null)
  const dnd = usePitchDrag({
    onTap: (i) => setSlot(i),
    // 선발끼리: 두 자리 맞바꾸기 (빈 자리로 옮기기도 된다)
    onMove: (from, to) => { const next = lineupNow(); [next[from], next[to]] = [next[to], next[from]]; update({ lineup: next }) },
    // 벤치 → 자리: 그 자리 선수는 벤치로
    onPlace: (id, to) => { if (unavailable(status[id])) return; update({ lineup: placeInSlot(lineupNow(), to, id) }) },
  })
  if (!myTeam) return <NeedTeam />

  const formation = save.formation
  const slots = buildSlots(formation)
  const lineup = Array.from({ length: slots.length }, (_, i) => save.lineup[i] ?? null)
  const byId = Object.fromEntries(myTeam.players.map((p) => [p.id, p]))
  const filled = lineup.filter(Boolean)
  const avgFit = filled.length ? Math.round((filled.reduce((s, id, i) => s + fitOf(byId[id], slots[lineup.indexOf(id)].role), 0) / filled.length) * 100) : 0
  const bench = myTeam.players.filter((p) => !lineup.includes(p.id)).sort((a, b) => playerOvr(b) - playerOvr(a))

  const changeFormation = (f) => update({ formation: f, layout: null, lineup: (() => {
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

      <div className="tac-layout">
      <TacSets save={save} update={update} team={myTeam} status={status} />

      <div className="card tac-form">
        <h3>포메이션 <span className="muted small">{isCustom(formation) ? `${baseOf(formation)} · 직접 조정` : formation}</span></h3>
        <FormationPicker value={baseOf(formation)} onChange={changeFormation} />
      </div>

      <div className="card tac-pitch">
        <div className="row between layout-bar">
          <button className={`btn small ${edit ? '' : 'ghost'}`} onClick={() => setEdit(!edit)}>{edit ? '✔ 자리 조정 끝' : '📐 자리 조정'}</button>
          {isCustom(formation) && <button className="btn small ghost" onClick={() => update({ formation: baseOf(formation), layout: null })}>↺ 기본 위치로</button>}
        </div>
        <SlotPitch team={myTeam} formation={formation} lineup={lineup} onSlot={setSlot} active={slot} status={status} dnd={edit ? null : dnd} edit={edit}
          onLayout={(pos) => { const name = `${baseOf(formation)}*`; update({ formation: name, layout: { name, pos } }) }} />
        <p className="small muted dnd-hint">{edit ? '자리 표시를 끌어 원하는 위치로 옮기세요. 위치에 따라 역할이 바뀌고(예: 중앙 미드를 앞으로 → 공격형 미드), 수비 라인 높이·폭·간격이 전술에 반영됩니다.' : '선수를 끌어 다른 자리에 놓으면 맞바꾸고, 벤치 선수를 끌어 자리에 놓으면 투입합니다. 짧게 누르면 선수 목록이 열립니다.'}</p>
        <LayoutEffects formation={formation} />
        {dnd.drag && (() => { const p = byId[dnd.drag.id]; return p ? <div className="drag-ghost" style={{ left: dnd.drag.x, top: dnd.drag.y }}><Kit color={myTeam.color} number={p.number} size={30} /><span>{p.name.split(' ').at(-1)}</span></div> : null })()}
        <div className="fit-legend">
          {Object.entries(FIT_LABEL).map(([k, l]) => <span key={k}><i className={`fit-dot ${k}`} />{l}</span>)}
        </div>
      </div>

      <div className="card tac-bench">
        <h3>벤치 <span className="muted small">{bench.length}명</span></h3>
        {/* 벤치: 경기장 옆 교체 명단처럼 얼굴 카드 — 끌어서 자리에 놓는다 */}
        <div className="bench2">
          {['GK', 'DF', 'MF', 'FW'].map((pos) => {
            const list = bench.filter((p) => p.pos === pos)
            if (!list.length) return null
            return (
              <div key={pos} className={`bench-group line-${pos.toLowerCase()}`}>
                <span className="bg-label">{{ GK: '골키퍼', DF: '수비', MF: '미드필더', FW: '공격' }[pos]}</span>
                <div className="bg-cards">
                  {list.map((p) => {
                    const out = unavailable(status[p.id])
                    const cond = Math.round(status[p.id]?.cond ?? 100)
                    return (
                      <div key={p.id} className={`bench-card ${out ? `out ${out.kind}` : 'draggable'}`} title={out?.text ?? '끌어서 경기장 자리에 놓기'}
                        onPointerDown={out ? undefined : (e) => dnd.startBench(p.id, e)}>
                        <Avatar player={p} color={myTeam.color} size={42} />
                        <span className="bc-role">{roleOf(p)}</span>
                        <strong>{p.name.split(' ').at(-1)}</strong>
                        <b className="bc-ovr" title="능력 (OVR)">{playerOvr(p)}</b>
                        <span className="bc-keys">{keyAttrs20(p).map(([k, x]) => <i key={k} className={x >= 16 ? 'hi' : x >= 12 ? 'mid' : 'lo'} title={`${k} ${x}/20`}>{k[0]}{x}</i>)}</span>
                        <span className={`bc-cond ${cond >= 80 ? 'hi' : cond >= 60 ? 'mid' : 'lo'}`}><i style={{ width: `${cond}%` }} /></span>
                        {out && <em className="bc-out">{out.icon} {out.games}경기</em>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {preview && (
        <div className="card tac-matchups">
          <h3>다음 상대 매치업 <span className="muted small">{preview.opp.name} · {preview.match.sides[1 - preview.myIdx].tactics.formation} · {styleName(preview.match.sides[1 - preview.myIdx].tactics)}</span></h3>
          <p className="small muted">🧠 상대 감독 성향: <b>{AI_STYLE[aiStyle(preview.opp.id)][0]}</b> — {AI_STYLE[aiStyle(preview.opp.id)][1]}</p>
          <Matchups match={preview.match} ctx={preview.ctx} myIdx={preview.myIdx} neutral />
        </div>
      )}

      <div className="card tac-orders">
        <h3>팀 지시</h3>
        <TacticsPanel value={myTactics(save)} onChange={update} players={lineup.map((id) => myTeam.players.find((p) => p.id === id)).filter(Boolean)} />
      </div>
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
