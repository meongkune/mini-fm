// 유럽 대항전 화면: 내 상태, 다음 매치데이, 조별 순위, 토너먼트, 득점 순위
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Crest } from '../components/Badges.jsx'
import { STAGE_LABEL, dueMatchday, fixturesOf, groupTable } from '../game/cup.js'
import { short, useGame } from '../store.jsx'

export default function CupView() {
  const { cup, allTeams, myKey, cupState, save } = useGame()
  const [view, setView] = useState('groups')
  if (!save.cup) return <div className="card muted">유럽 대항전을 준비하는 중입니다…</div>
  if (save.cup.none || !cup) return <div className="card muted">유럽 대항전은 유럽 리그가 2개 이상 들어와 있을 때 열립니다. (지금 리그는 대회 대상이 아니거나 다른 유럽 리그 데이터가 없습니다)</div>
  const T = (k) => allTeams[k] || cup.teams.find((t) => t.key === k)
  const nextMd = dueMatchday(cup, Infinity)
  const ko = ['R16', 'QF', 'SF', 'F'].filter((s) => cup.fixtures.some((f) => f.stage === s))
  const goals = {}
  for (const f of cup.fixtures) for (const s of f.scorers || []) {
    const k = `${s.team}|${s.name}`
    goals[k] = goals[k] || { name: s.name, team: s.team, g: 0 }
    goals[k].g++
  }
  const scorers = Object.values(goals).sort((a, b) => b.g - a.g).slice(0, 10)

  return (
    <>
      <div className={`card cup-hero ${cupState?.in ? '' : 'out'}`}>
        <span className="cup-trophy">🏆</span>
        <div className="grow">
          <strong>{cup.name}</strong>
          <span className="muted small">{cup.size}개 팀 · 조별리그 → {cup.size === 32 ? '16강' : '8강'} 토너먼트(단판)</span>
          <span className={`cup-me ${cupState?.out ? 'bad' : ''}`}>{cupState?.text}</span>
        </div>
        {cup.winner && <span className="cup-winner"><Crest team={T(cup.winner)} size={30} />우승</span>}
      </div>
      {nextMd && <p className="small muted">다음 매치데이: <b>{nextMd.label}</b> — 리그 {nextMd.after}라운드를 마친 뒤 · {save.round >= nextMd.after ? <Link to="/match" className="link">지금 진행</Link> : `${nextMd.after - save.round}라운드 남음`}</p>}

      <div className="chips-scroll">
        {[['groups', '조별리그'], ['ko', '토너먼트'], ['fixtures', '일정·결과'], ['scorers', '득점 순위']].map(([k, l]) => (
          <button key={k} className={`chip ${view === k ? 'on' : ''}`} onClick={() => setView(k)}>{l}</button>
        ))}
      </div>

      {view === 'groups' && (
        <div className="cup-groups">
          {cup.groups.map((g, gi) => (
            <div key={gi} className="card flush">
              <table className="st small grp">
                <thead><tr><th className="left">{String.fromCharCode(65 + gi)}조</th><th className="pts">승점</th><th>득실</th></tr></thead>
                <tbody>
                  {groupTable(cup, gi).map((r, i) => (
                    <tr key={r.id} className={r.id === myKey ? 'me' : ''}>
                      <td className="grp-team"><span className="st-rank" style={i < 2 ? { '--zone': '#3b82f6' } : undefined}>{i + 1}</span><Crest team={T(r.id)} size={18} /><span className="st-name">{short(T(r.id))}</span></td>
                      <td className="pts">{r.pts}</td><td>{r.gf - r.ga > 0 ? '+' : ''}{r.gf - r.ga}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {view === 'ko' && (
        ko.length === 0 ? <div className="card muted">조별리그가 끝나면 토너먼트 대진이 나옵니다. 각 조 1·2위가 진출합니다.</div> : (
          <div className="bracket">
            {ko.map((s) => (
              <div key={s} className="br-col">
                <h4>{STAGE_LABEL[s]}</h4>
                {cup.fixtures.filter((f) => f.stage === s).sort((a, b) => a.slot - b.slot).map((f, i) => (
                  <div key={i} className={`br-match ${f.home === myKey || f.away === myKey ? 'me' : ''}`}>
                    {[f.home, f.away].map((k, j) => (
                      <div key={k} className={`br-team ${f.winner === k ? 'win' : f.winner ? 'lose' : ''}`}>
                        <Crest team={T(k)} size={18} /><span>{short(T(k))}</span><b>{f.score ? f.score[j] : ''}{f.pens ? ` (${f.pens[j]})` : ''}</b>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )
      )}

      {view === 'fixtures' && cup.matchdays.map((md) => {
        const list = fixturesOf(cup, md)
        if (!list.length) return null
        return (
          <div key={md.key} className="card flush">
            <div className="md-head">{md.label} <span className="muted small">리그 {md.after}R 뒤</span></div>
            {list.map((f, i) => (
              <div key={i} className={`fx ${f.home === myKey || f.away === myKey ? 'me' : ''}`}>
                <span className={`fx-team home ${f.winner === f.home || (f.score && f.score[0] > f.score[1]) ? 'win' : ''}`}>{short(T(f.home))} <Crest team={T(f.home)} /></span>
                <span className="fx-score">{f.score ? `${f.score[0]} : ${f.score[1]}` : 'vs'}{f.pens ? <small> PK {f.pens[0]}-{f.pens[1]}</small> : null}</span>
                <span className={`fx-team ${f.winner === f.away || (f.score && f.score[1] > f.score[0]) ? 'win' : ''}`}><Crest team={T(f.away)} /> {short(T(f.away))}</span>
              </div>
            ))}
          </div>
        )
      })}

      {view === 'scorers' && (
        scorers.length === 0 ? <div className="card muted">아직 골이 없습니다.</div> : (
          <div className="card flush">
            <table className="pr">
              <thead><tr><th>순위</th><th className="left">선수</th><th>골</th></tr></thead>
              <tbody>
                {scorers.map((s, i) => (
                  <tr key={i} className={s.team === myKey ? 'me' : ''}>
                    <td className="pr-rank">{i + 1}</td>
                    <td className="left"><div className="pr-player"><Crest team={T(s.team)} /><div><strong>{s.name}</strong><small>{short(T(s.team))}</small></div></div></td>
                    <td className="pr-val">{s.g}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  )
}
