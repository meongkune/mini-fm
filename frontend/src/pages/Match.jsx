import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { formationNeeds, ink, kitColors, short, teamOvr, useGame } from '../store.jsx'
import MatchPitch from './MatchPitch.jsx'
import NeedTeam from './NeedTeam.jsx'
import { MENTALITY, OptionGroup, PRESSING } from './Tactics.jsx'

const SPEEDS = { '보통': 220, '빠르게': 70 }
// 상황별로 1분이 흐르는 시간 배수 — 슈팅·골 장면은 천천히 보여준다
const TICK_MULT = { build: 1, card: 2, miss: 4.5, save: 4.5, goal: 10 }

export default function Match() {
  const { myTeam, save, update, nextFixture, teamsById, seasonOver, finishRound } = useGame()
  const navigate = useNavigate()
  const [phase, setPhase] = useState('pre') // pre → h1 → ht → h2 → ft
  const [events, setEvents] = useState([])
  const [clock, setClock] = useState(0)
  const [target, setTarget] = useState(0)
  const [speed, setSpeed] = useState('보통')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [timeline, setTimeline] = useState([])
  const [lineups, setLineups] = useState(null)
  const logRef = useRef(null)

  const tickAt = (m) => timeline.find((e) => e.m === m)
  const delayFor = (m) => SPEEDS[speed] * (TICK_MULT[tickAt(m)?.k] || 1)

  // 경기 시계: target 분까지 한 분씩 진행 (다음 분이 슈팅·골이면 더 천천히)
  useEffect(() => {
    if (clock >= target) {
      // 마지막 분(45'·90')의 장면도 끝까지 보여준 뒤 하프타임/종료로 전환
      const next = phase === 'h1' && target === 45 ? 'ht' : phase === 'h2' && target === 90 ? 'ft' : null
      if (!next) return
      const t = setTimeout(() => setPhase(next), delayFor(clock))
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setClock((c) => c + 1), delayFor(clock))
    return () => clearTimeout(t)
  }, [clock, target, phase, speed, timeline])

  // 킥오프 전에도 경기장에 양 팀 선발을 세워 둔다 (상대는 서버와 같은 4-4-2 자동 선발)
  const fixtureKey = nextFixture ? `${nextFixture.home}-${nextFixture.away}` : ''
  useEffect(() => {
    if (!myTeam || !nextFixture) return
    const oppId = nextFixture.home === myTeam.id ? nextFixture.away : nextFixture.home
    const pick = (team, ids) => ids.map((id) => team.players.find((p) => p.id === id)).filter(Boolean)
    api.autoLineup(oppId, '4-4-2').then(({ lineup }) => {
      const mine = pick(myTeam, save.lineup)
      const opp = pick(teamsById[oppId], lineup)
      setLineups((cur) => cur ?? (nextFixture.home === myTeam.id ? [mine, opp] : [opp, mine]))
    }).catch(() => {})
  }, [fixtureKey])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [clock])

  if (!myTeam) return <NeedTeam />
  if (seasonOver) {
    return <div className="card"><p>시즌이 끝났습니다.</p><Link className="btn" to="/league">최종 순위 보기</Link></div>
  }

  const isHome = nextFixture.home === myTeam.id
  // 색이 비슷한 팀끼리 붙으면 원정팀은 원정 유니폼 색으로 (경기장·스코어보드에 함께 적용)
  const [homeKit, awayKit] = kitColors(teamsById[nextFixture.home], teamsById[nextFixture.away])
  const home = { ...teamsById[nextFixture.home], color: homeKit }
  const away = { ...teamsById[nextFixture.away], color: awayKit }
  const myIdx = isHome ? 0 : 1
  const needs = formationNeeds(save.formation)

  const cfg = () => {
    const mine = {
      team_id: myTeam.id,
      lineup: save.lineup,
      tactics: { formation: save.formation, mentality: save.mentality, pressing: save.pressing },
    }
    const other = { team_id: isHome ? away.id : home.id }
    return isHome ? { home: mine, away: other } : { home: other, away: mine }
  }

  const play = async (half) => {
    setError('')
    try {
      const r = await api.simulate({ ...cfg(), half, state: half === 2 ? result.state : undefined })
      setResult(r)
      setEvents((ev) => [...ev, ...r.events])
      setTimeline((tl) => [...tl, ...r.timeline])
      setLineups(r.lineups)
      setPhase(half === 1 ? 'h1' : 'h2')
      setTarget(half === 1 ? 45 : 90)
    } catch (e) {
      setError(e.message)
    }
  }

  const skip = () => setClock(target)

  const save_ = async () => {
    setSaving(true)
    const score = result.stats.score
    await finishRound({
      home: home.id,
      away: away.id,
      score,
      scorers: result.state.scorers.map((s) => ({ player_id: s.player_id, name: s.name, team: s.team === 0 ? home.id : away.id })),
    })
    navigate('/league')
  }

  const shown = events.filter((e) => e.minute <= clock)
  const score = [0, 0]
  shown.forEach((e) => { if (e.type === 'goal') score[e.team]++ })
  const showStats = phase === 'ht' || phase === 'ft'
  // 경기 진행 중일 때만 공이 움직인다 (킥오프 전·하프타임·종료 후에는 기본 대형)
  const live = (phase === 'h1' || phase === 'h2') && clock > 0
  const liveTick = live ? tickAt(clock) : null

  return (
    <section>
      <div className="scoreboard" style={{ '--h': home.color, '--a': away.color }}>
        <div className="side home"><span className="crest" style={{ color: ink(home.color) }}>{home.id}</span><strong>{short(home)}</strong><small>OVR {teamOvr(home)}</small></div>
        <div className="score">
          <span className="big">{score[0]} : {score[1]}</span>
          <span className="clock">{phase === 'pre' ? '킥오프 전' : phase === 'ht' ? '하프타임' : phase === 'ft' ? '경기 종료' : `${clock}'`}</span>
        </div>
        <div className="side away"><span className="crest" style={{ color: ink(away.color) }}>{away.id}</span><strong>{short(away)}</strong><small>OVR {teamOvr(away)}</small></div>
      </div>
      <div className="progress"><span style={{ width: `${(clock / 90) * 100}%` }} /></div>

      {error && <div className="card error">{error}</div>}

      <MatchPitch
        home={home}
        away={away}
        myIdx={myIdx}
        lineups={lineups}
        tick={live ? liveTick : null}
        duration={live ? delayFor(clock) : 300}
        scorerName={liveTick && lineups ? [...lineups[0], ...lineups[1]].find((p) => p.id === liveTick.p)?.name : ''}
        idleLabel={phase === 'ht' ? '하프타임 — 후반 대기' : phase === 'ft' ? '경기 종료' : '킥오프 대기'}
      />

      <div className="match-layout">
        <div className="card log" ref={logRef}>
          {phase === 'pre' && (
            <div className="pre">
              <h3>경기 준비</h3>
              <p>내 전술: <strong>{save.formation}</strong> · {MENTALITY.find((m) => m[0] === save.mentality)[1]} · 압박 {PRESSING.find((p) => p[0] === save.pressing)[1]}</p>
              <p className="muted small">선발 {save.lineup.length}명 (필요: GK 1 · DF {needs.DF} · MF {needs.MF} · FW {needs.FW})</p>
              <div className="row">
                <Link className="btn ghost" to="/tactics">전술 바꾸기</Link>
                <button className="btn" onClick={() => play(1)}>⚽ 킥오프</button>
              </div>
            </div>
          )}
          {shown.map((e, i) => (
            <p key={i} className={`ev ${e.type} ${e.team === myIdx ? 'mine' : e.team === undefined ? '' : 'theirs'}`}>{e.text}</p>
          ))}
        </div>

        <div className="card side-panel">
          {(phase === 'h1' || phase === 'h2') && (
            <>
              <h3>중계 속도</h3>
              <div className="row">
                {Object.keys(SPEEDS).map((s) => (
                  <button key={s} className={`btn small ${speed === s ? '' : 'ghost'}`} onClick={() => setSpeed(s)}>{s}</button>
                ))}
                <button className="btn small ghost" onClick={skip}>⏭ 건너뛰기</button>
              </div>
            </>
          )}

          {showStats && (
            <>
              <h3>경기 기록</h3>
              <table className="stats">
                <tbody>
                  <tr><td>{result.stats.possession[0]}%</td><th>점유율</th><td>{result.stats.possession[1]}%</td></tr>
                  <tr><td>{result.stats.shots[0]}</td><th>슈팅</th><td>{result.stats.shots[1]}</td></tr>
                  <tr><td>{result.stats.on_target[0]}</td><th>유효 슈팅</th><td>{result.stats.on_target[1]}</td></tr>
                </tbody>
              </table>
            </>
          )}

          {phase === 'ht' && (
            <>
              <h3>하프타임 지시</h3>
              <p className="small muted">후반전 경기 운영과 압박을 바꿀 수 있습니다.</p>
              <OptionGroup options={MENTALITY} value={save.mentality} onChange={(mentality) => update({ mentality })} />
              <OptionGroup options={PRESSING} value={save.pressing} onChange={(pressing) => update({ pressing })} />
              <button className="btn wide" onClick={() => play(2)}>후반전 시작 ▶</button>
            </>
          )}

          {phase === 'ft' && (
            <>
              <h3 className="result">
                {score[myIdx] > score[1 - myIdx] ? '🎉 승리!' : score[myIdx] === score[1 - myIdx] ? '🤝 무승부' : '😢 패배'}
              </h3>
              <button className="btn wide" disabled={saving} onClick={save_}>
                {saving ? '다른 경기 진행 중…' : '결과 저장 → 리그 순위 보기'}
              </button>
            </>
          )}

          {phase === 'pre' && <p className="muted small">킥오프하면 경기장 애니메이션과 문자 중계로 전반 45분이 진행됩니다. 하프타임에 전술을 바꿀 수 있어요.</p>}
        </div>
      </div>
    </section>
  )
}
