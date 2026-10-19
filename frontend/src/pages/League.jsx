import { useState } from 'react'
import { Link } from 'react-router-dom'
import { short, useGame } from '../store.jsx'

export default function League() {
  const { data, save, standings, teamsById, myTeam, totalRounds, seasonOver, resetSeason } = useGame()
  const lastRound = save.round - 1
  const [viewRound, setViewRound] = useState(lastRound)
  const round = Math.min(viewRound, lastRound)

  const goals = {}
  save.results.forEach((r) => r.scorers?.forEach((s) => {
    goals[s.player_id] ??= { name: s.name, team: s.team, goals: 0 }
    goals[s.player_id].goals++
  }))
  const topScorers = Object.values(goals).sort((a, b) => b.goals - a.goals).slice(0, 10)
  const roundResults = save.results.filter((r) => r.round === round)
  const champion = seasonOver ? standings[0] : null

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>{data.league}</h1>
          <p className="muted">{save.round} / {totalRounds} 라운드 진행</p>
        </div>
        {myTeam && !seasonOver && <Link className="btn" to="/match">다음 경기 ▶</Link>}
      </div>

      {champion && (
        <div className="card champion" style={{ '--c': champion.color }}>
          🏆 {champion.name} 우승! {champion.id === myTeam?.id ? '감독님, 축하합니다!' : ''}
          <button className="btn small ghost" onClick={() => { if (confirm('같은 팀으로 새 시즌을 시작할까요?')) resetSeason() }}>새 시즌</button>
        </div>
      )}

      <div className="league-layout">
        <div className="card">
          <h3>순위표</h3>
          <table className="table">
            <thead>
              <tr><th>#</th><th className="left">팀</th><th className="hide-m">경기</th><th>승</th><th>무</th><th>패</th><th>득실</th><th>승점</th><th>최근</th></tr>
            </thead>
            <tbody>
              {standings.map((s, i) => (
                <tr key={s.id} className={s.id === myTeam?.id ? 'me' : ''}>
                  <td>{i + 1}</td>
                  <td className="left"><span className="swatch" style={{ background: s.color }} />{short(teamsById[s.id])}</td>
                  <td className="hide-m">{s.p}</td><td>{s.w}</td><td>{s.d}</td><td>{s.l}</td>
                  <td>{s.gf - s.ga > 0 ? '+' : ''}{s.gf - s.ga}</td>
                  <td><strong>{s.pts}</strong></td>
                  <td className="form">{s.form.slice(-5).map((f, j) => <span key={j} className={`f ${f}`}>{f}</span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <div className="card">
            <div className="row between">
              <h3>라운드 결과</h3>
              {lastRound >= 0 && (
                <select value={round} onChange={(e) => setViewRound(Number(e.target.value))}>
                  {Array.from({ length: lastRound + 1 }, (_, i) => <option key={i} value={i}>{i + 1}라운드</option>)}
                </select>
              )}
            </div>
            {lastRound < 0 && <p className="muted">아직 치른 경기가 없습니다.</p>}
            {roundResults.map((r, i) => (
              <div key={i} className={`fixture ${r.mine ? 'me' : ''}`}>
                <span>{short(teamsById[r.home])}</span>
                <strong>{r.score[0]} : {r.score[1]}</strong>
                <span>{short(teamsById[r.away])}</span>
              </div>
            ))}
          </div>

          <div className="card">
            <h3>득점 순위</h3>
            {topScorers.length === 0 && <p className="muted">아직 득점자가 없습니다.</p>}
            <ol className="scorers">
              {topScorers.map((s, i) => (
                <li key={i}><span>{s.name} <small className="muted">{short(teamsById[s.team])}</small></span><strong>{s.goals}골</strong></li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  )
}
