import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FORMATIONS } from '../engine/engine.js'
import { MAX_SUBS, advance, benchOf, createMatch, dropInjured, pickLineup, ratings, step, substitute, summarize } from '../engine/match.js'
import { TEAM_TALKS, teamTalkEffect } from '../game/season.js'
import Rating, { CondBar } from '../components/Rating.jsx'
import { ink, kitColors, onDark, playerOvr, short, teamOvr, useGame } from '../store.jsx'
import MatchPitch from './MatchPitch.jsx'
import NeedTeam from './NeedTeam.jsx'
import { MENTALITY, OptionGroup, PRESSING } from './Tactics.jsx'

const SPEEDS = { '보통': 220, '빠르게': 70 }
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
  const [speed, setSpeed] = useState('보통')
  const [sheet, setSheet] = useState(null) // 'subs' | 'tactics'
  const [interrupt, setInterrupt] = useState(null)
  const [talk, setTalk] = useState(null)
  const [tab, setTab] = useState('stats')
  const [saving, setSaving] = useState(false)
  const logRef = useRef(null)

  const fixtureKey = nextFixture ? `${save.round}-${nextFixture.home}-${nextFixture.away}` : ''
  const isHome = nextFixture && myTeam ? nextFixture.home === myTeam.id : true
  const myIdx = isHome ? 0 : 1
  const ctx = useMemo(() => (nextFixture ? { teams: [teamsById[nextFixture.home], teamsById[nextFixture.away]], status } : null), [fixtureKey, teamsById, status])

  // 킥오프 전: 양 팀 선발로 경기 상태를 미리 만들어 경기장에 세워 둔다
  useEffect(() => {
    if (!ctx || !myTeam) return
    // 경기가 시작된 뒤에는(전술 변경으로 save가 바뀌어도) 다시 만들지 않는다
    if (matchRef.current?.key === fixtureKey && matchRef.current.minute > 0) return
    const myCfg = { lineup: save.lineup, tactics: { formation: save.formation, mentality: save.mentality, pressing: save.pressing } }
    const oppTeam = ctx.teams[1 - myIdx]
    const oppCfg = { lineup: pickLineup(oppTeam, '4-4-2', status) }
    matchRef.current = createMatch({ home: ctx.teams[0], away: ctx.teams[1], homeCfg: isHome ? myCfg : oppCfg, awayCfg: isHome ? oppCfg : myCfg, status, myIdx })
    matchRef.current.key = fixtureKey
    setPhase('pre'); setTalk(null); setInterrupt(null); setPaused(false)
    rerender()
  }, [fixtureKey, save.lineup.join(), save.formation])

  const match = matchRef.current
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
  const lineups = match.sides.map((sd) => sd.onPitch.map((id) => byId[id]).filter(Boolean))

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
    update(patch)
    mySide.tactics = { ...mySide.tactics, ...patch }
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
  const continueShort = () => {
    if (interrupt) dropInjured(match, myIdx, interrupt.playerId)
    setInterrupt(null); setSheet(null); rerender()
  }
  const finish = () => {
    setSaving(true)
    finishRound({ home: home.id, away: away.id, summary: summarize(match, ctx) })
    navigate('/league')
  }

  const score = match.score
  const scorers = [0, 1].map((i) => match.scorers.filter((s) => s.team === i).map((s) => `${s.name.split(' ').at(-1)} ${s.minute}'`))
  const lastKey = [...match.events].reverse().find((e) => e.type !== 'info')
  const caption = live && lastKey && match.minute - lastKey.minute <= 2 ? lastKey : null
  const clockLabel = phase === 'pre' ? '킥오프 전' : phase === 'ht' ? 'HT' : phase === 'ft' ? 'FT' : `${match.minute}'`
  const started = phase !== 'pre'
  const unavailable = save.lineup.filter((id) => status[id]?.inj > 0 || status[id]?.susp > 0)
  const opp = ctx.teams[1 - myIdx]
  const mom = phase === 'ft' ? Object.keys(rt).sort((a, b) => rt[b] - rt[a])[0] : null
  const res = score[myIdx] > score[1 - myIdx] ? 'win' : score[myIdx] === score[1 - myIdx] ? 'draw' : 'loss'

  return (
    <section>
      <div className="bcast">
        <div className="bc-team" style={{ '--c': home.color, '--ink': ink(home.color) }}>
          <span className="bc-id">{home.id}</span><span className="bc-name">{short(home)}</span>
          {S[0].red > 0 && <span className="bc-red">{'▮'.repeat(S[0].red)}</span>}
        </div>
        <div className="bc-score"><b>{score[0]}</b><i /><b>{score[1]}</b></div>
        <div className="bc-team away" style={{ '--c': away.color, '--ink': ink(away.color) }}>
          {S[1].red > 0 && <span className="bc-red">{'▮'.repeat(S[1].red)}</span>}
          <span className="bc-name">{short(away)}</span><span className="bc-id">{away.id}</span>
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
            <h3>경기 준비 <span className="muted small">{save.round + 1}라운드 · {isHome ? '홈' : '원정'}</span></h3>
            <div className="opp-report">
              <div><span className="muted small">상대</span><strong>{opp.name}</strong></div>
              <div><span className="muted small">전력</span><strong>{teamOvr(opp)}</strong></div>
              <div><span className="muted small">최근</span><span className="form">{recentForm(save.results, opp.id).map((f, i) => <span key={i} className={`f ${f}`}>{f}</span>)}</span></div>
            </div>
            <p className="small muted">상대 핵심: {[...opp.players].sort((a, b) => playerOvr(b) - playerOvr(a)).slice(0, 3).map((p) => `${p.name.split(' ').at(-1)}(${playerOvr(p)})`).join(' · ')}</p>
            <p className="small">내 전술 <strong>{save.formation}</strong> · {MENTALITY.find((m) => m[0] === save.mentality)[1]} · 압박 {PRESSING.find((p) => p[0] === save.pressing)[1]}</p>
            {unavailable.length > 0 && (
              <p className="small bad-text">⚠ 선발 중 {unavailable.map((id) => byId[id]?.name).join(', ')} 선수는 출전할 수 없어 자동으로 대체됩니다.</p>
            )}
            <div className="row">
              <Link className="btn ghost" to="/squad">선발 조정</Link>
              <button className="btn" onClick={kickoff}>⚽ 킥오프</button>
            </div>
          </div>
        )}

        {phase === 'live' && (
          <div className="ctrl">
            <button className="btn small" onClick={() => setPaused((p) => !p)}>{paused ? '▶ 재개' : '⏸ 멈춤'}</button>
            <button className="btn small ghost" onClick={() => { setPaused(true); setSheet('subs') }}>🔁 교체 {mySide.subsLeft}</button>
            <button className="btn small ghost" onClick={() => { setPaused(true); setSheet('tactics') }}>📋 전술</button>
            <span className="grow" />
            {Object.keys(SPEEDS).map((s) => (
              <button key={s} className={`chip ${speed === s ? 'on' : ''}`} onClick={() => setSpeed(s)}>{s}</button>
            ))}
            <button className="chip" onClick={skip}>⏭</button>
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
          match={match} ctx={ctx} myIdx={myIdx} rt={rt} status={status} interrupt={interrupt}
          onSub={doSub}
          onClose={() => { if (interrupt) continueShort(); else setSheet(null) }}
          onContinueShort={continueShort}
        />
      )}
      {sheet === 'tactics' && (
        <div className="sheet-wrap" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head"><h3>전술 변경</h3><button className="btn ghost small" onClick={() => setSheet(null)}>완료</button></div>
            <h4>포메이션 <span className="muted small">(선수 배치는 그대로 — 포지션 수가 다르면 경기력 감소)</span></h4>
            <OptionGroup options={Object.keys(FORMATIONS).map((f) => [f, f, ''])} value={mySide.tactics.formation} onChange={(formation) => setTactics({ formation })} cols={4} />
            <h4>경기 운영</h4>
            <OptionGroup options={MENTALITY} value={mySide.tactics.mentality} onChange={(mentality) => setTactics({ mentality })} />
            <h4>압박 강도</h4>
            <OptionGroup options={PRESSING} value={mySide.tactics.pressing} onChange={(pressing) => setTactics({ pressing })} />
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
        <span className="lu-num" style={{ '--c': kits[side].color, '--ink': ink(kits[side].color) }}>{p.number}</span>
        <span className="lu-pos">{p.pos}</span>
        <span className="lu-name">
          {p.name}
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

function SubsSheet({ match, ctx, myIdx, rt, status, interrupt, onSub, onClose, onContinueShort }) {
  const sd = match.sides[myIdx]
  const team = ctx.teams[myIdx]
  const [outId, setOutId] = useState(interrupt?.playerId ?? null)
  const onPitch = sd.onPitch.map((id) => team.players.find((p) => p.id === id)).filter(Boolean).sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos])
  const out = onPitch.find((p) => p.id === outId)
  const bench = benchOf(match, ctx, myIdx).sort((a, b) => (out && (a.pos === out.pos) !== (b.pos === out.pos) ? (a.pos === out.pos ? -1 : 1) : 0) || POS_ORDER[a.pos] - POS_ORDER[b.pos] || playerOvr(b) - playerOvr(a))
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>교체 <span className="muted small">남은 횟수 {sd.subsLeft}/{MAX_SUBS}</span></h3>
          <button className="btn ghost small" onClick={onClose}>{interrupt ? '교체 없이 계속' : '닫기'}</button>
        </div>
        {interrupt && <p className="notice bad">🚑 {interrupt.name} 선수가 다쳤습니다. 교체하지 않으면 한 명 적게 뜁니다.</p>}
        {sd.subsLeft <= 0 && <p className="notice">교체 카드를 모두 썼습니다.</p>}
        <h4>① 뺄 선수</h4>
        <ul className="pick-list">
          {onPitch.map((p) => (
            <li key={p.id}>
              <button className={`pick ${outId === p.id ? 'on' : ''}`} onClick={() => setOutId(p.id)}>
                <span className="lu-pos">{p.pos}</span>
                <span className="lu-name">{p.name}{sd.injured.includes(p.id) ? ' 🚑' : ''}{match.ps[p.id]?.yc ? ' 🟨' : ''}</span>
                <CondBar value={sd.energy[p.id]} />
                <Rating value={rt[p.id]} />
              </button>
            </li>
          ))}
        </ul>
        <h4>② 들어갈 선수 {out && <span className="muted small">— {out.pos} 우선</span>}</h4>
        <ul className="pick-list">
          {bench.map((p) => (
            <li key={p.id}>
              <button className="pick" disabled={!outId || sd.subsLeft <= 0} onClick={() => { if (onSub(outId, p.id)) setOutId(null) }}>
                <span className="lu-pos">{p.pos}</span>
                <span className="lu-name">{p.name} <span className="muted small">OVR {playerOvr(p)}</span></span>
                <CondBar value={status[p.id]?.cond} />
                <span className="pick-go">투입</span>
              </button>
            </li>
          ))}
          {bench.length === 0 && <li className="muted small">투입할 수 있는 선수가 없습니다.</li>}
        </ul>
        {interrupt && <button className="btn ghost wide" onClick={onContinueShort}>교체 없이 10명으로 계속</button>}
      </div>
    </div>
  )
}
