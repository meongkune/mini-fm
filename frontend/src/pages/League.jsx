import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ink, playerOvr, short, useGame } from '../store.jsx'
import Rating from '../components/Rating.jsx'
import { tierOf } from '../components/PlayerCard.jsx'

const TABS = [['table', '팀 순위'], ['players', '개인 순위'], ['fixtures', '일정·결과']]

export function Crest({ team, size = 22 }) {
  if (!team) return null
  return (
    <span className="crest-sm" style={{ '--c': team.color, '--ink': ink(team.color), width: size, height: size }}>
      {team.id.slice(0, 3)}
    </span>
  )
}

export default function League() {
  const { data, save, standings, teamsById, myTeam, totalRounds, seasonOver, seasonText } = useGame()
  const [tab, setTab] = useState('table')
  const champion = seasonOver ? standings[0] : null

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>{data.leagueInfo.name}</h1>
          <p className="muted">{seasonText.replace(`${data.leagueInfo.name} `, '')} · {Math.min(save.round, totalRounds)}/{totalRounds} 라운드</p>
        </div>
        {myTeam && !seasonOver && <Link className="btn small" to="/match">다음 경기 ▶</Link>}
      </div>

      {champion && (
        <div className="card champion" style={{ '--c': champion.color }}>
          🏆 {champion.name} 우승! {champion.id === myTeam?.id ? '감독님, 축하합니다!' : ''}
          {myTeam && <Link className="btn small ghost" to="/">시즌 마감 →</Link>}
        </div>
      )}

      <div className="tabs-line">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'table' && <StandingsTable standings={standings} teamsById={teamsById} myTeam={myTeam} zones={data.zones} />}
      {tab === 'players' && <PlayerRanks pstats={save.pstats || {}} teamsById={teamsById} myTeam={myTeam} roundsPlayed={save.round} />}
      {tab === 'fixtures' && <Fixtures schedule={data.schedule} results={save.results} teamsById={teamsById} myTeam={myTeam} current={save.round} />}
    </section>
  )
}

// ── 팀 순위: 팀 열은 고정, 기록 열은 가로 스크롤 ──
function StandingsTable({ standings, teamsById, myTeam, zones }) {
  const n = standings.length
  const zoneOf = (rank) => zones.find((z) => {
    const from = z.from < 0 ? n + 1 + z.from : z.from
    const to = z.to < 0 ? n + 1 + z.to : z.to
    return rank >= from && rank <= to
  })
  return (
    <div className="card flush">
      <div className="st-scroll">
        <table className="st">
          <thead>
            <tr>
              <th className="sticky">순위 · 팀</th>
              <th>경기</th><th className="pts">승점</th><th>승</th><th>무</th><th>패</th><th>득점</th><th>실점</th><th>득실</th><th className="last">최근 5경기</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s, i) => {
              const z = zoneOf(i + 1)
              const team = teamsById[s.id]
              return (
                <tr key={s.id} className={s.id === myTeam?.id ? 'me' : ''}>
                  <td className="sticky">
                    <span className="st-rank" style={z ? { '--zone': z.color } : undefined}>{i + 1}</span>
                    <Crest team={team} />
                    <span className="st-name">{short(team)}</span>
                  </td>
                  <td>{s.p}</td>
                  <td className="pts">{s.pts}</td>
                  <td>{s.w}</td><td>{s.d}</td><td>{s.l}</td>
                  <td>{s.gf}</td><td>{s.ga}</td>
                  <td className={s.gf - s.ga > 0 ? 'plus' : s.gf - s.ga < 0 ? 'minus' : ''}>{s.gf - s.ga > 0 ? '+' : ''}{s.gf - s.ga}</td>
                  <td className="last"><span className="form5">{[...s.form.slice(-5)].reverse().map((f, j) => <i key={j} className={`f5 ${f}`}>{{ W: '승', D: '무', L: '패' }[f]}</i>)}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {zones.length > 0 && (
        <div className="zone-legend pad">
          {zones.map((z) => <span key={z.label}><i style={{ background: z.color }} />{z.label}</span>)}
        </div>
      )}
    </div>
  )
}

// ── 개인 순위 ──
const CATS = [
  ['g', '득점', (s) => s.g, '골'],
  ['a', '도움', (s) => s.a, '도움'],
  ['ap', '공격포인트', (s) => s.g + s.a, 'P'],
  ['r', '평점', (s) => s.rsum / s.apps, ''],
  ['cs', '클린시트', (s) => s.cs, '회'],
  ['mom', 'MOM', (s) => s.mom, '회'],
  ['yc', '경고', (s) => s.yc, '장'],
]

function PlayerRanks({ pstats, teamsById, myTeam, roundsPlayed }) {
  const [cat, setCat] = useState('g')
  const [, label, val, unit] = CATS.find((c) => c[0] === cat)
  const players = {}
  for (const t of Object.values(teamsById)) for (const p of t.players) players[p.id] = { ...p, teamId: t.id }
  const minApps = Math.max(1, Math.ceil(roundsPlayed * 0.4)) // 평점은 일정 경기 이상 뛴 선수만
  let rows = Object.entries(pstats)
    .filter(([id, s]) => players[id] && s.apps > 0 && (cat !== 'r' || s.apps >= minApps) && (cat !== 'cs' || players[id].pos === 'GK'))
    .map(([id, s]) => ({ p: players[id], s, v: val(s) }))
    .filter((r) => r.v > 0)
    .sort((a, b) => b.v - a.v || a.s.apps - b.s.apps || b.s.g - a.s.g)
    .slice(0, 30)
  // 공동 순위
  rows = rows.map((r, i) => ({ ...r, rank: i > 0 && rows[i - 1].v === r.v ? null : i + 1 }))
  let last = 1
  rows.forEach((r) => { if (r.rank) last = r.rank; else r.rank = last })
  const fmt = (v) => (cat === 'r' ? v.toFixed(2) : v)

  return (
    <>
      <div className="chips-scroll">
        {CATS.map(([k, l]) => <button key={k} className={`chip ${cat === k ? 'on' : ''}`} onClick={() => setCat(k)}>{l}</button>)}
      </div>
      {rows.length === 0 ? (
        <div className="card muted">아직 기록이 없습니다. 경기를 치르면 순위가 쌓입니다.</div>
      ) : (
        <>
          <div className="podium">
            {[1, 0, 2].map((i) => rows[i] && (
              <div key={rows[i].p.id} className={`pod pod-${i + 1} tier-${tierOf(playerOvr(rows[i].p))} ${rows[i].p.teamId === myTeam?.id ? 'me' : ''}`}>
                <span className="pod-rank">{rows[i].rank}</span>
                <Crest team={teamsById[rows[i].p.teamId]} size={26} />
                <strong className="pod-name">{rows[i].p.name.split(' ').at(-1)}</strong>
                <span className="pod-team">{short(teamsById[rows[i].p.teamId])}</span>
                <span className="pod-val">{cat === 'r' ? <Rating value={rows[i].v} /> : <>{fmt(rows[i].v)}<small>{unit}</small></>}</span>
              </div>
            ))}
          </div>
          <div className="card flush">
            <table className="pr">
              <thead><tr><th>순위</th><th className="left">선수</th><th>경기</th><th>{label}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.p.id} className={r.p.teamId === myTeam?.id ? 'me' : ''}>
                    <td className="pr-rank">{r.rank}</td>
                    <td className="left">
                      <div className="pr-player">
                        <Crest team={teamsById[r.p.teamId]} />
                        <div><strong>{r.p.name}</strong><small>{short(teamsById[r.p.teamId])} · {r.p.pos}</small></div>
                      </div>
                    </td>
                    <td>{r.s.apps}</td>
                    <td className="pr-val">{cat === 'r' ? <Rating value={r.v} /> : fmt(r.v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cat === 'r' && <p className="muted small">평점은 {minApps}경기 이상 출전한 선수만 집계합니다.</p>}
        </>
      )}
    </>
  )
}

// ── 일정·결과 ──
function Fixtures({ schedule, results, teamsById, myTeam, current }) {
  const total = schedule.length
  const [round, setRound] = useState(Math.min(Math.max(current - 1, 0), total - 1))
  const played = results.filter((r) => r.round === round)
  const list = schedule[round].map((f) => ({ ...f, res: played.find((r) => r.home === f.home && r.away === f.away) }))
  return (
    <>
      <div className="round-nav">
        <button className="btn ghost small" disabled={round <= 0} onClick={() => setRound(round - 1)}>‹</button>
        <strong>{round + 1}라운드 {round === current ? <em className="pill edit">다음</em> : round < current ? <em className="pill">종료</em> : null}</strong>
        <button className="btn ghost small" disabled={round >= total - 1} onClick={() => setRound(round + 1)}>›</button>
      </div>
      <div className="card flush">
        {list.map((f) => {
          const [h, a] = [teamsById[f.home], teamsById[f.away]]
          const mine = myTeam && (f.home === myTeam.id || f.away === myTeam.id)
          const sc = f.res?.score
          return (
            <div key={`${f.home}-${f.away}`} className={`fx ${mine ? 'me' : ''}`}>
              <span className={`fx-team home ${sc && sc[0] > sc[1] ? 'win' : ''}`}>{short(h)} <Crest team={h} /></span>
              <span className="fx-score">{sc ? `${sc[0]} : ${sc[1]}` : 'vs'}</span>
              <span className={`fx-team ${sc && sc[1] > sc[0] ? 'win' : ''}`}><Crest team={a} /> {short(a)}</span>
              {f.res?.scorers?.length > 0 && (
                <div className="fx-goals">
                  <span>{f.res.scorers.filter((s) => s.team === f.home).map((s) => `${s.name.split(' ').at(-1)} ${s.minute ?? ''}'`).join(', ')}</span>
                  <span>{f.res.scorers.filter((s) => s.team === f.away).map((s) => `${s.name.split(' ').at(-1)} ${s.minute ?? ''}'`).join(', ')}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
