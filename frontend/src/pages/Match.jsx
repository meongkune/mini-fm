import { crowdBoost } from '../game/finance.js'
import { abilityStars, starText } from '../components/Stars.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { buildSlots, fitOf, fitTone } from '../engine/formation.js'
import { CORNER_EDGE, MAX_SUBS, advance, benchOf, clockText, createMatch, halfOver, dropInjured, fillVacant, moveToVacant, predict, ratings, reshape, step, substitute, summarize, swapPositions, tacticalEdges } from '../engine/match.js'
import { styleName, tacOf } from '../engine/tactics.js'
import { TEAM_TALKS, teamTalkEffect, unavailable as outReason } from '../game/season.js'
import Rating, { CondBar } from '../components/Rating.jsx'
import { Crest, Flag, Kit } from '../components/Badges.jsx'
import { ink, kitColors, lineupOvr, myTactics, onDark, playerOvr, short, teamOvr, useGame } from '../store.jsx'
import TacticsPanel, { CORNER_DEF_OPTS, CORNER_OPTS } from '../components/TacticsPanel.jsx'
import MatchPitch from './MatchPitch.jsx'
import NeedTeam from './NeedTeam.jsx'
import { FormationPicker, LINE_OPTS, MENTALITY, OptionGroup, PRESSING, TEMPO_OPTS } from './Tactics.jsx'

// 장면 하나(보통 1분)를 보여주는 시간(ms). 배속은 화면 속도만 바꾸고 경기 결과에는 영향이 없다
const SPEEDS = { '1x': 650, '2x': 325, '4x': 160, '8x': 80 }
// 상황별 장면 길이 배수 — 슈팅·세트피스·골은 천천히, 재개(골킥·스로인)는 조금 더
const TICK_MULT = { build: 1, card: 2, clear: 2, miss: 2.5, save: 2.5, goal: 5 }
const tickDelay = (t, base) => base * ((TICK_MULT[t?.k] || 1) + (t?.sp ? 1.5 : 0) + (t?.sp === 'pen' ? 1.5 : 0) + (t?.r ? 0.6 : 0))
const POS_ORDER = { GK: 0, DF: 1, MF: 2, FW: 3 }
const seedOf = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) % 1e9 + 1 }
// 터치라인 지시(FM식 외침): 버튼 한 번으로 지금 전술을 그 방향으로 민다. 여러 번 누르면 더 세진다
const cl = (v) => Math.max(0, Math.min(100, v))
const SHOUTS = [
  ['push', '⚔️ 공격 앞으로', '라인을 올리고 더 많이 공격합니다', (t) => ({ mentality: cl(t.mentality + 20), line: cl(t.line + 10) })],
  ['hold', '🛡️ 지키자', '내려앉아 리드를 지킵니다', (t) => ({ mentality: cl(t.mentality - 20), line: cl(t.line - 15) })],
  ['press', '🔥 압박 올려', '전방에서 공을 뺏습니다 (체력 소모 ↑)', (t) => ({ pressing: cl(t.press + 25) })],
  ['breathe', '😮‍💨 숨 고르기', '압박·템포를 낮춰 체력을 아낍니다', (t) => ({ pressing: cl(t.press - 25), tempo: cl(t.tempo - 20) })],
  ['wings', '↔️ 측면으로', '넓게 벌려 측면을 공략합니다', (t) => ({ width: cl(t.width + 25), focus: 'wings' })],
  ['direct', '🎯 뒷공간으로', '길고 빠르게 수비 뒤를 노립니다', (t) => ({ passing: cl(t.passing + 25), tempo: cl(t.tempo + 15) })],
  ['waste', '⏳ 시간 끌기', '템포를 늦추고 볼을 돌립니다', (t) => ({ tempo: cl(t.tempo - 30), mentality: cl(t.mentality - 10), passing: cl(t.passing - 20) })],
]

export default function Match() {
  const { myTeam, save, update, nextFixture: realNext, teamsById, seasonOver, finishRound, status, venueOf } = useGame()
  // 경기가 끝나 자동 저장하면 리그는 다음 라운드로 넘어간다 → 결과 화면은 끝난 경기 기준으로 고정해서 보여준다
  const frozen = useRef(null)
  const nextFixture = frozen.current?.fixture || realNext
  const [notice, setNotice] = useState(null)
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
  const [shown, setShown] = useState(-1) // 지금 보여주는 장면(timeline 번호) — 계산은 앞서 있고 화면이 차례로 따라간다
  const [lastShout, setLastShout] = useState(null)
  const [revealed, setRevealed] = useState(true) // 지금 장면의 결과(골·자막)를 드러냈는가
  const logRef = useRef(null)

  const fixtureKey = frozen.current?.key || (nextFixture ? `${nextFixture.cup ? 'cup' : 'lg'}-${save.round}-${nextFixture.home}-${nextFixture.away}` : '')
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
    // 경기마다 고정된 seed: 나갔다 들어와도 같은 경기 (결과를 다시 뽑는 꼼수 방지)
    const seed = seedOf(`${save.seasonNo || 1}-${fixtureKey}`)
    matchRef.current = createMatch({ home: ctx.teams[0], away: ctx.teams[1], homeCfg: isHome ? myCfg : oppCfg, awayCfg: isHome ? oppCfg : myCfg, status, myIdx, seed })
    matchRef.current.key = fixtureKey
    if ((save.owner?.campUntil ?? -1) >= save.round) matchRef.current.talk[myIdx] += 0.025 // 구단주 지옥 훈련 효과
    if (isHome) matchRef.current.talk[myIdx] += crowdBoost(save.owner?.freeGate ? 100 : save.fans ?? 60) // 홈 관중: 민심이 높으면 응원, 낮으면 야유
    setPhase('pre'); setTalk(null); setInterrupt(null); setPaused(false); setShown(-1)
    rerender()
  }, [fixtureKey, save.lineup.join(), save.formation])


  const match = matchRef.current
  if (import.meta.env.DEV) window.__match = match // 개발 중 디버깅용
  const lastTick = match && shown >= 0 ? match.timeline[shown] : null
  const delay = tickDelay(lastTick, SPEEDS[speed])

  // ── 자동 저장 · 중간 이탈 ──
  const saveResult = (m) => {
    if (frozen.current || !m || !realNext) return
    frozen.current = { fixture: realNext, key: m.key }
    finishRound({ key: m.key, home: realNext.home, away: realNext.away, summary: summarize(m, ctx) })
    setSaving(true)
  }
  // 경기가 끝나면 버튼 없이 바로 저장
  useEffect(() => { if (phase === 'ft' && match && !frozen.current) saveResult(match) }, [phase])
  // 남은 시간을 AI가 대신 지휘해 끝까지 진행 (내 팀 부상도 자동 교체)
  const playOut = (m, c) => {
    m.myIdx = null
    let guard = 0
    while (!halfOver(m, 2) && guard++ < 200) advance(m, c, 90)
  }
  const liveRef = useRef({})
  liveRef.current = { phase, match, ctx, saveResult }
  // 경기 중에 다른 화면으로 나가면: 그 자리에서 끝까지 자동 진행하고 저장 (다시 들어와 결과를 바꾸는 꼼수 방지)
  useEffect(() => () => {
    const L = liveRef.current
    if (!L.match || frozen.current || !(L.phase === 'live' || L.phase === 'ht')) return
    playOut(L.match, L.ctx)
    L.saveResult(L.match)
  }, [])
  // 경기 시작을 세이브에 표시 → 새로 고침·창 닫기로 빠져나가도 다음에 열면 끝까지 진행해 저장한다
  useEffect(() => {
    if (phase === 'live' && match && save.liveMatch !== match.key) update({ liveMatch: match.key })
  }, [phase])
  useEffect(() => {
    if (!match || frozen.current || phase !== 'pre' || match.minute > 0) return
    if (save.liveMatch && save.liveMatch === match.key) {
      playOut(match, ctx)
      setNotice('지난번에 경기 도중 나가서, 남은 시간을 자동으로 진행해 결과를 저장했습니다.')
      setPhase('ft')
      rerender()
    }
  }, [match?.key])
  useEffect(() => {
    if (phase !== 'live' && phase !== 'ht') return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [phase])

  // 장면 결과는 슈팅이 날아간 뒤(장면의 약 75% 지점)에 드러낸다
  useEffect(() => {
    setRevealed(false)
    const t = setTimeout(() => setRevealed(true), delay * 0.72)
    return () => clearTimeout(t)
  }, [shown])

  // 경기 시계: 장면을 하나씩 보여주고, 다 보여주면 다음 1분을 계산한다 (멈춤·교체 화면·부상 알림 중에는 정지)
  useEffect(() => {
    if (phase !== 'live' || paused || sheet || interrupt || !match) return
    const tl = match.timeline
    const t = setTimeout(() => {
      if (shown < tl.length - 1) { setShown(shown + 1); return }
      if (match.minute === 45 && halfOver(match, 1) && !match.htShown) { match.htShown = true; setPhase('ht'); return }
      if (halfOver(match, 2)) { setPhase('ft'); return }
      const before = tl.length
      const it = step(match, ctx)
      if (it) { setInterrupt(it); setSheet('subs') }
      setShown(before)
      rerender()
    }, shown >= 0 ? delay : SPEEDS[speed])
    return () => clearTimeout(t)
  })

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [match?.events.length])

  if (!myTeam) return <NeedTeam />
  if (seasonOver && !frozen.current) {
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
  // 건너뛰기: 같은 계산을 한 번에 돌릴 뿐이라 결과는 천천히 볼 때와 같다
  const skip = () => {
    const first = !halfOver(match, 1)
    const it = advance(match, ctx, first ? 45 : 90)
    setShown(match.timeline.length - 1)
    if (it) { setInterrupt(it); setSheet('subs') }
    else if (first) { match.htShown = true; setPhase('ht') } else setPhase('ft')
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
  // 터치라인 지시: 이 경기 전술만 바꾸고(저장된 팀 전술은 그대로) 문자 중계에 남긴다
  const shout = ([key, label, , fn]) => {
    mySide.tactics = { ...mySide.tactics, ...fn(tacOf(mySide.tactics)) }
    match.events.push({ minute: match.minute, plus: match.plus || undefined, type: 'info', team: myIdx, text: `📣 ${mySide.name} 감독 지시: ${label.replace(/^\S+ /, '')}` })
    setLastShout(key)
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
  // 다음 경기 준비: 고정해 둔 결과 화면을 풀고 새 경기를 만든다
  const nextMatch = () => { frozen.current = null; setSaving(false); setNotice(null); setPhase('pre'); rerender() }

  // 화면에 보이는 시점: 경기 중에는 지금 보여주는 장면까지의 스코어·득점·이벤트만 (계산이 앞서 있어도 결과를 미리 보여주지 않는다)
  const view = phase === 'live' && lastTick ? lastTick : null
  const seen = view && (revealed || paused || sheet) ? { sc: view.sc, n: view.n, gs: view.gs } : view ? { sc: view.sc0 ?? view.sc, n: view.n0 ?? view.n, gs: view.gs0 ?? view.gs } : null
  const score = seen?.sc ?? match.score
  const events = seen ? match.events.filter((_, i) => i < seen.n || i >= (match.evEnd ?? 0)) : match.events
  const scorers = [0, 1].map((i) => match.scorers.slice(0, seen ? seen.gs : undefined).filter((s) => s.team === i).map((s) => `${s.name.split(' ').at(-1)} ${clockText(s.minute, s.plus)}'${s.how === 'pen' ? ' (P)' : ''}`))
  const nowMin = view ? view.m : match.minute
  const lastKey = [...events].reverse().find((e) => e.type !== 'info')
  const caption = live && lastKey && nowMin - lastKey.minute <= 2 ? lastKey : null
  const clockText_ = view ? clockText(view.m, view.plus) : clockText(match.minute, match.plus)
  const clockLabel = phase === 'pre' ? '킥오프 전' : phase === 'ht' ? 'HT' : phase === 'ft' ? 'FT' : `${clockText_}'`
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
      {(() => {
        const v = venueOf(nextFixture.home, nextFixture.cup ? nextFixture.homeLid : undefined, fixtureKey)
        return v ? <div className="venue-line">🏟️ {v.name}{v.crowd ? <> · 관중 <b>{v.crowd.toLocaleString()}</b>명{v.cap ? ` (수용 ${v.cap.toLocaleString()}명 · ${Math.round(v.rate * 100)}%)` : ''}</> : ''}</div> : null
      })()}
      <div className="bc-sub">
        <span className="bc-scorers">{scorers[0].join(', ')}</span>
        <span className={`bc-clock ${live && !paused ? 'live' : ''}`}>{paused && phase === 'live' ? `⏸ ${clockText_}'` : clockLabel}</span>
        <span className="bc-scorers right">{scorers[1].join(', ')}</span>
      </div>
      <div className="progress"><span style={{ width: `${(Math.min(90, nowMin) / 90) * 100}%` }} /></div>

      <div className="match-layout">
      <div className="ml-pitch">
      <MatchPitch
        home={home}
        away={away}
        myIdx={myIdx}
        lineups={lineups}
        tick={live && !paused ? lastTick : null}
        duration={live ? delay : 300}
        scorerName={lastTick?.p ? byId[lastTick.p]?.name : ''}
        idleLabel={phase === 'ht' ? '하프타임' : phase === 'ft' ? '경기 종료' : paused ? '일시정지' : '킥오프 대기'}
        caption={caption && { text: caption.text, minute: clockText(caption.minute, caption.plus), type: caption.type, color: onDark(kits[caption.team]?.color || '#7c5cff') }}
      />
      </div>
      <div className="ml-side">

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
            <p className="small muted">상대 핵심: {[...opp.players].sort((a, b) => playerOvr(b) - playerOvr(a)).slice(0, 3).map((p) => `${p.name.split(' ').at(-1)} ${starText(abilityStars(p))}`).join(' · ')}</p>
            <div className="matchup">
              <div><span className="muted small">내 전술</span><strong>{save.formation} · {styleName(mySide.tactics)}</strong></div>
              <div><span className="muted small">상대 전술</span><strong>{match.sides[1 - myIdx].tactics.formation} · {styleName(match.sides[1 - myIdx].tactics)}</strong></div>
            </div>
            <MatchupNotes match={match} ctx={ctx} myIdx={myIdx} />
            <SetPieceNote mine={mySide.tactics} theirs={match.sides[1 - myIdx].tactics} />
            {(save.inbox || []).some((m) => m.type === 'talk' && !m.resolved) && (
              <p className="small notice">💬 답하지 않은 면담 요청 {(save.inbox || []).filter((m) => m.type === 'talk' && !m.resolved).length}건 — 이 경기를 치르면 넘긴 것으로 처리됩니다 (사기 −4). <Link className="link" to="/inbox">메시지함 →</Link></p>
            )}
            <p className="small muted">⚠️ 경기 중에 다른 화면으로 나가면 남은 시간은 자동으로 진행되고 결과가 저장됩니다.</p>
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
            <button className="chip" onClick={skip} aria-label="하프·경기 끝까지 건너뛰기" title={halfOver(match, 1) ? '후반 끝까지 건너뛰기' : '전반 끝까지 건너뛰기'}>⏭ {halfOver(match, 1) ? '후반' : '전반'}</button>
          </div>
        )}
        {(phase === 'live' || phase === 'ht') && (
          <div className="shouts">
            <span className="muted small">📣 터치라인 지시 <em>· 지금 {styleName(mySide.tactics)}</em></span>
            <div className="shout-row">
              {SHOUTS.map((s) => (
                <button key={s[0]} className={`chip shout ${lastShout === s[0] ? 'on' : ''}`} title={s[2]} onClick={() => shout(s)}>{s[1]}</button>
              ))}
            </div>
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
            {notice && <p className="notice small">⏩ {notice}</p>}
            <p className="small good-text" style={{ margin: '6px 0' }}>✅ 결과가 자동으로 저장됐습니다</p>
            <div className="row">
              <button className="btn ghost" onClick={() => navigate(nextFixture.cup ? '/league?tab=cup' : '/league')}>순위 보기</button>
              <button className="btn" onClick={nextMatch}>다음 경기 ▶</button>
            </div>
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
                {events.map((e, i) => (
                  <li key={i} className={`tl-item ${e.type} ${e.team === undefined ? 'neutral' : e.team === myIdx ? 'mine' : 'theirs'}`}
                    style={e.team !== undefined ? { '--tc': onDark(kits[e.team].color) } : undefined}>
                    <span className="tl-min">{clockText(e.minute, e.plus)}'</span>
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
            <TacticsPanel value={mySide.tactics} onChange={setTactics} compact players={mySide.onPitch.map((id) => byId[id])} />
          </div>
        </div>
      )}
      </div>
      </div>
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
/** 경기 전 세트피스 상성: 내 코너 루틴 vs 상대 코너 수비, 상대 루틴 vs 내 수비 */
function SetPieceNote({ mine, theirs }) {
  const name = (opts, k) => opts.find((o) => o[0] === k)?.[1] ?? k
  const my = CORNER_EDGE[mine.corner || 'mixed']?.[theirs.cornerDef || 'zonal'] ?? 0
  const op = CORNER_EDGE[theirs.corner || 'mixed']?.[mine.cornerDef || 'zonal'] ?? 0
  const best = Object.entries(CORNER_EDGE).sort((a, b) => b[1][theirs.cornerDef || 'zonal'] - a[1][theirs.cornerDef || 'zonal'])[0][0]
  return (
    <p className="small muted sp-note">
      🚩 상대 코너 수비: <b>{name(CORNER_DEF_OPTS, theirs.cornerDef || 'zonal')}</b>
      {' → '}내 루틴 <b className={my > 0.02 ? 'good-text' : my < 0 ? 'bad-text' : ''}>{name(CORNER_OPTS, mine.corner || 'mixed')}</b>
      {my <= 0.02 && best !== (mine.corner || 'mixed') ? ` (추천: ${name(CORNER_OPTS, best)})` : ' ✓'}
      {' · '}상대 코너 루틴: <b className={op > 0.02 ? 'bad-text' : ''}>{name(CORNER_OPTS, theirs.corner || 'mixed')}</b>
    </p>
  )
}

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
