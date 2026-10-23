import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { buildSlots, fitOf, fitTone } from '../engine/formation.js'
import { MAX_SUBS, advance, benchOf, createMatch, dropInjured, fillVacant, moveToVacant, predict, ratings, reshape, step, substitute, summarize, swapPositions, tacticalEdges } from '../engine/match.js'
import { styleName } from '../engine/tactics.js'
import { TEAM_TALKS, teamTalkEffect, unavailable as outReason } from '../game/season.js'
import Rating, { CondBar } from '../components/Rating.jsx'
import { Crest, Flag, Kit } from '../components/Badges.jsx'
import { ink, kitColors, lineupOvr, myTactics, onDark, playerOvr, short, teamOvr, useGame } from '../store.jsx'
import TacticsPanel from '../components/TacticsPanel.jsx'
import MatchPitch from './MatchPitch.jsx'
import NeedTeam from './NeedTeam.jsx'
import { FormationPicker, LINE_OPTS, MENTALITY, OptionGroup, PRESSING, TEMPO_OPTS } from './Tactics.jsx'

const SPEEDS = { '1x': 220, '3x': 70 }
// 상황별로 1분이 흐르는 시간 배수 — 슈팅·골 장면은 천천히 보여준다
const TICK_MULT = { build: 1, card: 2.5, miss: 4.5, save: 4.5, goal: 10 }
const POS_ORDER = { GK: 0, DF: 1, MF: 2, FW: 3 }

export default function Match() {
  const { myTeam, save, update, nextFixture, teamsById, seasonOver, finishRound, status } = useGame()
  const navigate = useNavigate()
  const matchRef = useRef(null)
  const [, setVersion] = useState(0)
  const rerender = () => setVersion((v) => v + 1)
  const [phase, setPhase] = useState('pre') // pre → live → ht → live → ft
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState('1x')
  const [sheet, setSheet] = useState(null) // 'subs' | 'tactics'
  const [interrupt, setInterrupt] = useState(null)
  const [talk, setTalk] = useState(null)
  const [tab, setTab] = useState('stats')
  const [saving, setSaving] = useState(false)
  const logRef = useRef(null)

  const fixtureKey = nextFixture ? `${nextFixture.cup ? 'cup' : 'lg'}-${save.round}-${nextFixture.home}-${nextFixture.away}` : ''
  const isHome = nextFixture ? nextFixture.isHome : true
  const myIdx = isHome ? 0 : 1
  const ctx = useMemo(() => (nextFixture ? { teams: [nextFixture.homeTeam, nextFixture.awayTeam], status } : null), [fixtureKey, teamsById, status])

  // 킥오프 전: 양 팀 선발로 경기 상태를 미리 만들어 경기장에 세워 둔다
  useEffect(() => {
    if (!ctx || !myTeam) return
    // 경기가 시작된 뒤에는(전술 변경으로 save가 바뀌어도) 다시 만들지 않는다
    if (matchRef.current?.key === fixtureKey && matchRef.current.minute > 0) return
    const myCfg = { lineup: save.lineup, tactics: myTactics(save) }
    const oppCfg = {} // 상대는 구단 고유 전형 + 자동 배치
    matchRef.current = createMatch({ home: ctx.teams[0], away: ctx.teams[1], homeCfg: isHome ? myCfg : oppCfg, awayCfg: isHome ? oppCfg : myCfg, status, myIdx })
    matchRef.current.key = fixtureKey
    if ((save.owner?.campUntil ?? -1) >= save.round) matchRef.current.talk[myIdx] += 0.025 // 구단주 지옥 훈련 효과
    setPhase('pre'); setTalk(null); setInterrupt(null); setPaused(false)
    rerender()
  }, [fixtureKey, save.lineup.join(), save.formation])


  const match = matchRef.current
  if (import.meta.env.DEV) window.__match = match // 개발 중 디버깅용
  const lastTick = match?.timeline.at(-1)
  const delay = SPEEDS[speed] * (TICK_MULT[lastTick?.k] || 1)

  // 경기 시계: 1분씩 계산하면서 보여준다 (멈춤·교체 화면·부상 알림 중에는 정지)
  useEffect(() => {
    if (phase !== 'live' || paused || sheet || interrupt || !match) return
    const t = setTimeout(() => {
      const it = step(match, ctx)
      if (it) { setInterrupt(it); setSheet('subs') }
      if (match.minute === 45) setPhase('ht')
      if (match.minute >= 90) setPhase('ft')
      rerender()
    }, delay)
    return () => clearTimeout(t)
  })

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [match?.events.length])

  if (!myTeam) return <NeedTeam />
  if (seasonOver) {
    return <div className="card"><p>시즌이 끝났습니다.</p><Link className="btn" to="/league">최종 순위 보기</Link></div>
  }
  if (!match || !ctx) return <div className="card muted">경기 준비 중…</div>

  const [homeKit, awayKit] = kitColors(ctx.teams[0], ctx.teams[1])
  const home = { ...ctx.teams[0], color: homeKit }
  const away = { ...ctx.teams[1], color: awayKit }
  const kits = [home, away]
  const byId = Object.fromEntries([...ctx.teams[0].players, ...ctx.teams[1].players].map((p) => [p.id, p]))
  const mySide = match.sides[myIdx]
  const rt = ratings(match, ctx)
  const S = match.stats
  const live = phase === 'live' && match.minute > 0
  // 경기장 배치: 포메이션 자리 좌표를 선수에게 붙인다
  const lineups = match.sides.map((sd) => {
    const all = buildSlots(sd.tactics.formation)
    const used = new Set()
    return sd.onPitch.map((id, i) => {
      const k = all.findIndex((s, j) => !used.has(j) && s.role === sd.slots[i])
      if (k >= 0) used.add(k)
      const s = all[k]
      return byId[id] && { ...byId[id], sx: s?.x, sy: s?.y, slot: sd.slots[i] }
    }).filter(Boolean)
  })

  const kickoff = () => { setPhase('live'); rerender() }
  const skip = () => {
    const to = match.minute < 45 ? 45 : 90
    const it = advance(match, ctx, to)
    if (it) { setInterrupt(it); setSheet('subs') }
    else setPhase(to === 45 ? 'ht' : 'ft')
    rerender()
  }
  const secondHalf = () => { setPhase('live'); setPaused(false); rerender() }
  const giveTalk = (kind) => {
    const avgMorale = mySide.onPitch.reduce((s, id) => s + (status[id]?.morale ?? 60), 0) / (mySide.onPitch.length || 1)
    const r = teamTalkEffect(kind, match.score[myIdx] - match.score[1 - myIdx], avgMorale)
    match.talk[myIdx] = r.boost
    setTalk({ kind, ...r })
  }
  const setTactics = (patch) => {
    if (patch.formation) {
      reshape(match, ctx, myIdx, patch.formation)
      // 저장된 선발도 새 전형의 자리 순서로 맞춘다
      const roles = buildSlots(patch.formation).map((s) => s.role)
      const used = new Set()
      const lineup = roles.map((r) => { const i = mySide.slots.findIndex((x, j) => !used.has(j) && x === r); if (i < 0) return null; used.add(i); return mySide.onPitch[i] })
      update({ formation: patch.formation, lineup })
    } else {
      update(patch)
      mySide.tactics = { ...mySide.tactics, ...patch }
    }
    rerender()
  }
  const doSub = (outId, inId) => {
    if (substitute(match, ctx, myIdx, outId, inId)) {
      if (interrupt?.playerId === outId) setInterrupt(null)
      rerender()
      return true
    }
    return false
  }
  const continueShort = (keepOpen = false) => {
    if (interrupt) dropInjured(match, myIdx, interrupt.playerId)
    setInterrupt(null)
    if (!keepOpen) setSheet(null)
    rerender()
  }
  const finish = () => {
    setSaving(true)
    finishRound({ home: nextFixture.home, away: nextFixture.away, summary: summarize(match, ctx) })
    navigate(nextFixture.cup ? '/league?tab=cup' : '/league')
  }

  const score = match.score
  const scorers = [0, 1].map((i) => match.scorers.filter((s) => s.team === i).map((s) => `${s.name.split(' ').at(-1)} ${s.minute}'`))
  const lastKey = [...match.events].reverse().find((e) => e.type !== 'info')
  const caption = live && lastKey && match.minute - lastKey.minute <= 2 ? lastKey : null
  const clockLabel = phase === 'pre' ? '킥오프 전' : phase === 'ht' ? 'HT' : phase === 'ft' ? 'FT' : `${match.minute}'`
  const started = phase !== 'pre'
  const unavailable = save.lineup.filter((id) => id && (status[id]?.inj > 0 || status[id]?.susp > 0))
  const preFit = Math.round((mySide.onPitch.reduce((s, id, i) => s + fitOf(byId[id], mySide.slots[i]), 0) / (mySide.onPitch.length || 1)) * 100)
  const promised = myTeam.players.filter((p) => save.status?.[p.id]?.promise === save.round)
  const opp = ctx.teams[1 - myIdx]
  const mom = phase === 'ft' ? Object.keys(rt).sort((a, b) => rt[b] - rt[a])[0] : null
  const res = score[myIdx] > score[1 - myIdx] ? 'win' : score[myIdx] === score[1 - myIdx] ? 'draw' : 'loss'

  return (
    <section>
      <div className="bcast">
        <div className="bc-team" style={{ '--c': home.color, '--ink': ink(home.color) }}>
          <span className="bc-crest"><Crest team={home} size={24} /></span><span className="bc-name">{short(home)}</span>
          {S[0].red > 0 && <span className="bc-red">{'▮'.repeat(S[0].red)}</span>}
        </div>
        <div className="bc-score"><b>{score[0]}</b><i /><b>{score[1]}</b></div>
        <div className="bc-team away" style={{ '--c': away.color, '--ink': ink(away.color) }}>
          {S[1].red > 0 && <span className="bc-red">{'▮'.repeat(S[1].red)}</span>}
          <span className="bc-name">{short(away)}</span><span className="bc-crest"><Crest team={away} size={24} /></span>
        </div>
      </div>
      <div className="bc-sub">
        <span className="bc-scorers">{scorers[0].join(', ')}</span>
        <span className={`bc-clock ${live && !paused ? 'live' : ''}`}>{paused && phase === 'live' ? `⏸ ${match.minute}'` : clockLabel}</span>
        <span className="bc-scorers right">{scorers[1].join(', ')}</span>
      </div>
      <div className="progress"><span style={{ width: `${(match.minute / 90) * 100}%` }} /></div>

      <MatchPitch
        home={home}
        away={away}
        myIdx={myIdx}
        lineups={lineups}
        tick={live && !paused ? lastTick : null}
        duration={live ? delay : 300}
        scorerName={lastTick?.p ? byId[lastTick.p]?.name : ''}
        idleLabel={phase === 'ht' ? '하프타임' : phase === 'ft' ? '경기 종료' : paused ? '일시정지' : '킥오프 대기'}
        caption={caption && { text: caption.text, minute: caption.minute, type: caption.type, color: onDark(kits[caption.team]?.color || '#7c5cff') }}
      />

      {/* 조작 */}
      <div className="card side-panel">
        {phase === 'pre' && (
          <div className="pre">
            <h3>경기 준비 <span className="muted small">{nextFixture.cup ? <b className="cup-badge">{nextFixture.comp?.icon || '🏆'} {nextFixture.label}</b> : nextFixture.label} · {isHome ? '홈' : '원정'}</span></h3>
            <div className="opp-report">
              <div><span className="muted small">상대</span><strong>{opp.name}</strong></div>
              <div><span className="muted small">상대 전력</span><strong>{teamOvr(opp)}</strong></div>
              <div><span className="muted small">내 라인업</span><strong className={lineupOvr(myTeam, save.formation, save.lineup) < teamOvr(opp) ? 'bad-text' : ''}>{lineupOvr(myTeam, save.formation, save.lineup)}</strong></div>
              <div><span className="muted small">최근</span><span className="form">{recentForm(save.results, opp.id).map((f, i) => <span key={i} className={`f ${f}`}>{f}</span>)}</span></div>
            </div>
            <Odds ctx={ctx} isHome={isHome} save={save} status={status} xi={mySide.onPitch} preFit={preFit} />
            <p className="small muted">상대 핵심: {[...opp.players].sort((a, b) => playerOvr(b) - playerOvr(a)).slice(0, 3).map((p) => `${p.name.split(' ').at(-1)}(${playerOvr(p)})`).join(' · ')}</p>
            <div className="matchup">
              <div><span className="muted small">내 전술</span><strong>{save.formation} · {styleName(mySide.tactics)}</strong></div>
              <div><span className="muted small">상대 전술</span><strong>{match.sides[1 - myIdx].tactics.formation} · {styleName(match.sides[1 - myIdx].tactics)}</strong></div>
            </div>
            <MatchupNotes match={match} ctx={ctx} myIdx={myIdx} />
            {promised.length > 0 && (
              <p className="small notice">🤝 선발 약속: {promised.map((p) => p.name).join(', ')} {promised.every((p) => save.lineup.includes(p.id)) ? '— 선발에 포함됨 ✓' : '— 선발에 없습니다! 약속을 어기면 사기가 크게 떨어집니다'}</p>
            )}
            {unavailable.length > 0 && (
              <p className="small bad-text">⚠ 출전할 수 없는 선발: {unavailable.map((id) => `${byId[id]?.name}(${outReason(status[id])?.label} — ${outReason(status[id])?.text})`).join(', ')}. 그 자리는 가장 알맞은 선수로 자동 대체됩니다.</p>
            )}
            <div className="row">
              <Link className="btn ghost" to="/tactics">선발·전술</Link>
              <button className="btn" onClick={kickoff}>⚽ 킥오프</button>
            </div>
          </div>
        )}

        {phase === 'live' && (
          <div className="ctrl">
            <button className="btn small" onClick={() => setPaused((p) => !p)}>{paused ? '▶ 재개' : '⏸ 멈춤'}</button>
            <button className="btn small ghost" onClick={() => { setPaused(true); setSheet('subs') }}>🔁 {mySide.subsLeft}</button>
            <button className="btn small ghost" onClick={() => { setPaused(true); setSheet('tactics') }}>📋 전술</button>
            <span className="grow" />
            {Object.keys(SPEEDS).map((s) => (
              <button key={s} className={`chip ${speed === s ? 'on' : ''}`} onClick={() => setSpeed(s)}>{s}</button>
            ))}
            <button className="chip" onClick={skip} aria-label="하프·경기 끝까지 건너뛰기">⏭</button>
          </div>
        )}

        {phase === 'ht' && (
          <>
            <h3>하프타임 라커룸</h3>
            <p className="small muted">선수들에게 한마디 해 주세요. 지금 스코어에 따라 반응이 다릅니다.</p>
            {!talk ? (
              <OptionGroup options={TEAM_TALKS} value={null} onChange={giveTalk} />
            ) : (
              <p className={`notice ${talk.boost > 0 ? 'ok' : talk.boost < 0 ? 'bad' : ''}`}>{TEAM_TALKS.find((t) => t[0] === talk.kind)[1]} → {talk.text}</p>
            )}
            <div className="row">
              <button className="btn ghost small" onClick={() => setSheet('subs')}>🔁 교체 {mySide.subsLeft}</button>
              <button className="btn ghost small" onClick={() => setSheet('tactics')}>📋 전술</button>
            </div>
            <button className="btn wide" onClick={secondHalf}>후반전 시작 ▶</button>
          </>
        )}

        {phase === 'ft' && (
          <>
            <h3 className={`result ${res}`}>{res === 'win' ? '승리' : res === 'draw' ? '무승부' : '패배'}</h3>
            {mom && (
              <div className="mom">
                <span className="mom-label">MOM</span>
                <strong>{byId[mom].name}</strong>
                <span className="muted small">{short(ctx.teams[ctx.teams[0].players.some((p) => p.id === mom) ? 0 : 1])}</span>
                <Rating value={rt[mom]} big />
              </div>
            )}
            <button className="btn wide" disabled={saving} onClick={finish}>
              {saving ? '다른 경기 진행 중…' : '결과 저장 → 리그 순위 보기'}
            </button>
          </>
        )}
      </div>

      {started && (
        <>
          <div className="seg">
            {[['stats', '기록'], ['lineups', '라인업·평점'], ['feed', '문자 중계']].map(([k, label]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>

          {tab === 'stats' && <StatsPanel stats={S} kits={kits} />}
          {tab === 'lineups' && <LineupPanel match={match} ctx={ctx} kits={kits} rt={rt} myIdx={myIdx} status={status} />}
          {tab === 'feed' && (
            <div className="card log" ref={logRef}>
              <ol className="tl">
                {match.events.map((e, i) => (
                  <li key={i} className={`tl-item ${e.type} ${e.team === undefined ? 'neutral' : e.team === myIdx ? 'mine' : 'theirs'}`}
                    style={e.team !== undefined ? { '--tc': onDark(kits[e.team].color) } : undefined}>
                    <span className="tl-min">{e.minute}'</span>
                    <span className="tl-text">{e.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}

      {sheet === 'subs' && (
        <SubsSheet
          match={match} ctx={ctx} myIdx={myIdx} rt={rt} status={status} interrupt={interrupt} kit={kits[myIdx].color}
          onSub={doSub}
          onFill={(role, inId) => { const ok = fillVacant(match, ctx, myIdx, role, inId); rerender(); return ok }}
          onSwap={(a, b) => { swapPositions(match, ctx, myIdx, a, b); rerender() }}
          onMove={(a, role) => { moveToVacant(match, ctx, myIdx, a, role); rerender() }}
          onRestore={(snap) => { Object.assign(mySide, snap); match.events.push({ minute: match.minute, type: 'info', text: '↩️ 위치 변경을 되돌렸습니다' }); rerender() }}
          onClose={() => { if (interrupt && mySide.onPitch.includes(interrupt.playerId)) continueShort(); else { setInterrupt(null); setSheet(null) } }}
          onContinueShort={continueShort}
        />
      )}
      {sheet === 'tactics' && (
        <div className="sheet-wrap" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head"><h3>전술 변경</h3><button className="btn ghost small" onClick={() => setSheet(null)}>완료</button></div>
            <h4>포메이션 <span className="muted small">(뛰고 있는 선수들이 새 자리로 재배치됩니다)</span></h4>
            <FormationPicker value={mySide.tactics.formation} onChange={(formation) => setTactics({ formation })} />
            <TacticsPanel value={mySide.tactics} onChange={setTactics} compact />
          </div>
        </div>
      )}
    </section>
  )
}

function recentForm(results, teamId) {
  return results.filter((r) => r.home === teamId || r.away === teamId).slice(-5).map((r) => {
    const [gf, ga] = r.home === teamId ? r.score : [r.score[1], r.score[0]]
    return gf > ga ? 'W' : gf < ga ? 'L' : 'D'
  })
}

// 포털 중계 화면처럼 항목별 좌우 비교
function StatsPanel({ stats: S, kits }) {
  const tot = S[0].poss + S[1].poss || 1
  const poss = Math.round((S[0].poss * 100) / tot)
  const pct = (s) => (s.passes ? Math.round((s.passesOk * 100) / s.passes) : 0)
  const rows = [
    ['슈팅', S[0].shots, S[1].shots],
    ['유효 슈팅', S[0].onTarget, S[1].onTarget],
    ['기대 득점(xG)', S[0].xg.toFixed(2), S[1].xg.toFixed(2)],
    ['패스', S[0].passes, S[1].passes],
    ['패스 성공률', `${pct(S[0])}%`, `${pct(S[1])}%`],
    ['코너킥', S[0].corners, S[1].corners],
    ['선방', S[0].saves, S[1].saves],
    ['파울', S[0].fouls, S[1].fouls],
    ['오프사이드', S[0].offsides, S[1].offsides],
    ['경고', S[0].yellow, S[1].yellow],
    ['퇴장', S[0].red, S[1].red],
  ]
  return (
    <div className="card stats-card">
      <div className="poss">
        <div className="poss-head"><b style={{ color: onDark(kits[0].color) }}>{poss}%</b><span>점유율</span><b style={{ color: onDark(kits[1].color) }}>{100 - poss}%</b></div>
        <div className="poss-bar"><span style={{ width: `${poss}%`, background: onDark(kits[0].color) }} /><span style={{ background: onDark(kits[1].color) }} /></div>
      </div>
      {rows.map(([label, a, b]) => {
        const na = parseFloat(a) || 0
        const nb = parseFloat(b) || 0
        const max = Math.max(na, nb) || 1
        return (
          <div key={label} className="srow">
            <b className={na > nb ? 'lead' : ''}>{a}</b>
            <div className="sbar left"><span style={{ width: `${(na / max) * 100}%`, background: onDark(kits[0].color) }} /></div>
            <span className="slabel">{label}</span>
            <div className="sbar"><span style={{ width: `${(nb / max) * 100}%`, background: onDark(kits[1].color) }} /></div>
            <b className={nb > na ? 'lead' : ''}>{b}</b>
          </div>
        )
      })}
    </div>
  )
}

function LineupPanel({ match, ctx, kits, rt, myIdx, status }) {
  const [side, setSide] = useState(myIdx)
  const sd = match.sides[side]
  const team = ctx.teams[side]
  const played = team.players.filter((p) => match.ps[p.id]).sort((a, b) => (match.ps[a.id].from - match.ps[b.id].from) || POS_ORDER[a.pos] - POS_ORDER[b.pos])
  const starters = played.filter((p) => match.ps[p.id].from === 0)
  const subsIn = played.filter((p) => match.ps[p.id].from > 0)
  const row = (p) => {
    const s = match.ps[p.id]
    const off = s.to !== null
    return (
      <li key={p.id} className={`lu ${off ? 'off' : ''}`}>
        <Kit color={kits[side].color} number={p.number} size={26} />
        <span className="lu-pos">{sd.slots[sd.onPitch.indexOf(p.id)] || p.pos}</span>
        <span className="lu-name">
          <Flag nation={p.nation} size={13} /> {p.name}
          <span className="lu-ev">
            {'⚽'.repeat(s.g)}{s.a ? '🅰️'.repeat(s.a) : ''}{s.yc ? '🟨' : ''}{s.rc ? '🟥' : ''}
            {sd.injured.includes(p.id) ? '🚑' : ''}
            {s.from > 0 ? <em className="in">▲{s.from}'</em> : null}
            {off && !s.rc && !sd.injured.includes(p.id) ? <em className="out">▼{s.to}'</em> : null}
          </span>
        </span>
        {side === myIdx && <CondBar value={sd.energy[p.id]} />}
        <Rating value={rt[p.id]} />
      </li>
    )
  }
  return (
    <div className="card">
      <div className="seg small">
        {[0, 1].map((i) => (
          <button key={i} className={side === i ? 'on' : ''} onClick={() => setSide(i)} style={side === i ? { '--c': onDark(kits[i].color) } : undefined}>
            {short(ctx.teams[i])} <span className="muted small">{match.sides[i].tactics.formation}</span>
          </button>
        ))}
      </div>
      <ul className="lu-list">{starters.map(row)}</ul>
      {subsIn.length > 0 && <><h4 className="lu-h">교체 투입</h4><ul className="lu-list">{subsIn.map(row)}</ul></>}
      <p className="muted small">평점은 경기 중에도 실시간으로 바뀝니다{side === myIdx ? ' · 막대는 남은 체력' : ''}.</p>
    </div>
  )
}

// 교체·위치 변경: 경기장 자리를 눌러 고른 뒤
//  - 다른 선수 자리를 누르면 두 선수 위치 맞바꾸기 (교체 카드 안 씀)
//  - 빈 자리를 누르면 그 자리로 이동 (원래 자리가 빈 자리가 됨)
//  - 벤치 선수를 누르면 교체 (빈 자리면 채우기) — 교체 카드 1장
function SubsSheet({ match, ctx, myIdx, rt, status, interrupt, kit, onSub, onFill, onSwap, onMove, onRestore, onClose, onContinueShort }) {
  const sd = match.sides[myIdx]
  const team = ctx.teams[myIdx]
  const byId = Object.fromEntries(team.players.map((p) => [p.id, p]))
  const [sel, setSel] = useState(interrupt ? { kind: 'p', idx: sd.onPitch.indexOf(interrupt.playerId) } : null)
  const [msg, setMsg] = useState('')
  const [undo, setUndo] = useState(null) // 마지막 위치 변경 전 상태
  const snapshot = () => ({ slots: [...sd.slots], vacant: [...(sd.vacant || [])] })

  // 자리 좌표: 현재 전형의 자리에 뛰는 선수·빈 자리를 역할 순서대로 맞춘다
  const all = buildSlots(sd.tactics.formation)
  const used = new Set()
  const place = (role) => { const k = all.findIndex((x, j) => !used.has(j) && x.role === role); if (k >= 0) { used.add(k); return all[k] } return { x: 50, y: 50 } }
  const entries = [
    ...sd.onPitch.map((id, i) => ({ kind: 'p', idx: i, id, role: sd.slots[i], ...place(sd.slots[i]) })),
    ...(sd.vacant || []).map((role, v) => ({ kind: 'v', v, role, ...place(role) })),
  ]
  const same = (a, b) => a && b && a.kind === b.kind && (a.kind === 'p' ? a.idx === b.idx : a.v === b.v)
  const selRole = sel ? (sel.kind === 'p' ? sd.slots[sel.idx] : sd.vacant[sel.v]) : null

  const tapSlot = (e) => {
    setMsg('')
    if (!sel) return setSel(e)
    if (same(sel, e)) return setSel(null)
    if (sel.kind === 'p' && e.kind === 'p') { setUndo(snapshot()); onSwap(sel.idx, e.idx); setMsg('두 선수의 위치를 바꿨습니다.'); return setSel(null) }
    if (sel.kind === 'p' && e.kind === 'v') { setUndo(snapshot()); onMove(sel.idx, e.role); setMsg(`${e.role} 자리로 옮겼습니다. 비게 된 자리에 교체 선수를 넣을 수 있습니다.`); return setSel(null) }
    if (sel.kind === 'v' && e.kind === 'p') { setUndo(snapshot()); onMove(e.idx, sel.role); setMsg(`${sel.role} 자리로 옮겼습니다.`); return setSel(null) }
    return setSel(e)
  }
  const tapBench = (p) => {
    if (!sel) return setMsg('먼저 경기장에서 바꿀 자리를 고르세요.')
    if (sd.subsLeft <= 0) return setMsg('교체 카드를 모두 썼습니다.')
    const ok = sel.kind === 'v' ? onFill(sel.role, p.id) : onSub(sd.onPitch[sel.idx], p.id)
    if (ok) { setMsg(`${p.name} 투입`); setSel(null); setUndo(null) } // 교체는 되돌릴 수 없다
  }
  const injuredOnPitch = interrupt && sd.onPitch.includes(interrupt.playerId)
  const bench = benchOf(match, ctx, myIdx).sort((a, b) => (selRole ? playerOvr(b) * fitOf(b, selRole) - playerOvr(a) * fitOf(a, selRole) : 0) || POS_ORDER[a.pos] - POS_ORDER[b.pos] || playerOvr(b) - playerOvr(a))

  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>교체·위치 <span className="muted small">교체 {sd.subsLeft}/{MAX_SUBS} · {sd.onPitch.length}명 출전</span></h3>
          <button className="btn ghost small" onClick={onClose}>{injuredOnPitch ? '10명으로 계속' : '닫기'}</button>
        </div>
        {injuredOnPitch && <p className="notice bad">🚑 {interrupt.name} 선수가 다쳤습니다. 바로 교체하거나, 다른 선수를 그 자리로 옮기고 빈 자리를 채우거나, 일단 10명으로 계속한 뒤 나중에 채울 수 있습니다.</p>}
        <p className="small muted" style={{ margin: '0 0 6px' }}>
          {!sel ? '① 경기장에서 자리를 누르세요.' : sel.kind === 'v' ? `② ${sel.role} 빈 자리 — 벤치 선수를 넣거나 경기장의 다른 선수를 눌러 이 자리로 옮기세요.` : `② ${byId[sd.onPitch[sel.idx]]?.name} (${selRole}) — 다른 선수를 누르면 위치 교환, 빈 자리를 누르면 이동, 벤치 선수를 누르면 교체.`}
        </p>
        <div className="slot-pitch small">
          <div className="sp-lines" aria-hidden="true"><i className="half" /><i className="circle" /><i className="box top" /><i className="box bottom" /></div>
          {entries.map((e) => {
            const p = e.kind === 'p' ? byId[e.id] : null
            const fit = p ? fitOf(p, e.role) : 0
            const hurt = p && sd.injured.includes(p.id)
            return (
              <button key={e.kind + (e.kind === 'p' ? e.idx : e.v)} className={`slot ${p ? `fit-${fitTone(fit)}` : 'empty'} ${same(sel, e) ? 'active' : ''} ${hurt ? 'hurt' : ''}`}
                style={{ left: `${e.x}%`, top: `${100 - e.y}%` }} onClick={() => tapSlot(e)}>
                {p ? <Kit color={kit} number={p.number} size={26} /> : <span className="slot-plus">+</span>}
                <span className="slot-role">{e.role}</span>
                {p && <span className="slot-name">{hurt ? '🚑 ' : ''}{p.name.split(' ').at(-1)}</span>}
                {p && <span className="slot-energy"><i style={{ width: `${Math.round(sd.energy[p.id] ?? 100)}%` }} /></span>}
              </button>
            )
          })}
        </div>
        {msg && (
          <p className="small notice row between">
            <span>{msg}</span>
            {undo && <button className="linkish" onClick={() => { onRestore(undo); setUndo(null); setMsg('위치 변경을 되돌렸습니다.') }}>↩️ 되돌리기</button>}
          </p>
        )}
        <h4>벤치 {selRole && <span className="muted small">— {selRole} 자리 적합도 순</span>}</h4>
        <ul className="pick-list">
          {bench.map((p) => {
            const fit = selRole ? fitOf(p, selRole) : 1
            return (
              <li key={p.id}>
                <button className="pick" disabled={sd.subsLeft <= 0} onClick={() => tapBench(p)}>
                  <span className={`role-chip ${selRole ? fitTone(fit) : ''}`}>{p.role}</span>
                  <span className="lu-name"><Flag nation={p.nation} size={13} /> {p.name}</span>
                  <CondBar value={status[p.id]?.cond} />
                  <b className="pick-ovr">{Math.round(playerOvr(p) * fit)}</b>
                </button>
              </li>
            )
          })}
          {bench.length === 0 && <li className="muted small">투입할 수 있는 선수가 없습니다.</li>}
        </ul>
        {injuredOnPitch && <button className="btn ghost wide" onClick={() => { onContinueShort(true); setSel(null) }}>부상 선수 빼고 자리 비워 두기</button>}
      </div>
    </div>
  )
}

/**
 * 경기 전 예상 승률: 내 라인업·전술·사기·컨디션(내가 관리한 것) + 상대 OVR로 100경기를 미리 돌려 본다.
 * 그날 컨디션과 경기 흐름이 매번 달라서, 낮은 확률도 실제로 일어난다.
 */
function Odds({ ctx, isHome, save, status, xi, preFit }) {
  const [res, setRes] = useState(null)
  const key = [ctx.teams[0].id, ctx.teams[1].id, save.lineup.join(), JSON.stringify(myTactics(save))].join('|')
  useEffect(() => {
    setRes(null)
    const t = setTimeout(() => {
      const myCfg = { lineup: save.lineup, tactics: myTactics(save) }
      const n = window.innerWidth < 700 ? 70 : 120
      setRes(predict(ctx.teams[0], ctx.teams[1], { homeCfg: isHome ? myCfg : {}, awayCfg: isHome ? {} : myCfg, status, n }))
    }, 60)
    return () => clearTimeout(t)
  }, [key])
  const avgOf = (k, fb) => Math.round(xi.reduce((s, id) => s + (status[id]?.[k] ?? fb), 0) / (xi.length || 1))
  const morale = avgOf('morale', 50)
  const cond = avgOf('cond', 100)
  const pct = (v) => `${v > 0 ? '+' : ''}${v}%`
  const moraleFx = Math.round((0.92 + 0.16 * morale / 100 - 1) * 100)
  const condFx = Math.round((0.8 + 0.2 * cond / 100 - 1) * 100)
  const fitFx = preFit - 100
  const [w, d, l] = res ? (isHome ? [res.win, res.draw, res.loss] : [res.loss, res.draw, res.win]).map((x) => Math.round(x * 100)) : [0, 0, 0]
  return (
    <div className="odds">
      <div className="odds-head"><b>예상 승률</b><span className="muted small">{res ? `예상 스코어 ${(isHome ? res.gf : res.ga).toFixed(1)} : ${(isHome ? res.ga : res.gf).toFixed(1)}` : '계산 중…'}</span></div>
      <div className={`odds-bar ${res ? '' : 'loading'}`}>
        <i className="w" style={{ flex: w || 1 }}>{res && `승 ${w}%`}</i>
        <i className="d" style={{ flex: d || 1 }}>{res && `무 ${d}%`}</i>
        <i className="l" style={{ flex: l || 1 }}>{res && `패 ${l}%`}</i>
      </div>
      <div className="odds-fx">
        <span className={moraleFx < 0 ? 'bad' : moraleFx > 0 ? 'good' : ''}>🧠 사기 {morale} <b>{pct(moraleFx)}</b></span>
        <span className={condFx < -3 ? 'bad' : ''}>🔋 컨디션 {cond}% <b>{pct(condFx)}</b></span>
        <span className={fitFx < -3 ? 'bad' : ''}>🧩 자리 적합도 <b>{pct(fitFx)}</b></span>
        <span>{isHome ? '🏟️ 홈 이점' : '✈️ 원정'}</span>
        <span>📋 {styleName(myTactics(save))}</span>
      </div>
    </div>
  )
}

/** 전술 상성 분석: 우리에게 유리한 점(초록)과 상대가 우리를 공략하는 점(빨강) */
function MatchupNotes({ match, ctx, myIdx }) {
  const mine = tacticalEdges(match, ctx, myIdx).notes
  const theirs = tacticalEdges(match, ctx, 1 - myIdx).notes
  const list = [...mine.map(([t, s]) => [t, s]), ...theirs.filter(([t, s]) => s > 0 && !t.startsWith('중원')).map(([t]) => [`상대 ${t}`, -1])]
  if (!list.length) return <p className="small muted">특별한 전술 상성은 없습니다. 선수 능력 싸움입니다.</p>
  return (
    <ul className="matchup-notes">
      {list.map(([t, sgn], i) => <li key={i} className={sgn > 0 ? 'good' : 'bad'}>{sgn > 0 ? '▲' : '▼'} {t}</li>)}
    </ul>
  )
}
