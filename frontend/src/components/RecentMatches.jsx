// 지난 경기 기록: 최근 경기 목록(스코어·상대·득점자)과 경기 상세(골 기록·통계·MOM)
import { useState } from 'react'
import { Crest } from './Badges.jsx'

const STAT_ROWS = [
  ['점유율', (s, o) => `${Math.round((s.poss / Math.max(1, s.poss + o.poss)) * 100)}%`],
  ['슈팅', (s) => s.shots],
  ['유효 슈팅', (s) => s.onTarget],
  ['기대 득점(xG)', (s) => (s.xg ?? 0).toFixed(2)],
  ['패스 성공률', (s) => (s.passes ? `${Math.round((s.passesOk / s.passes) * 100)}%` : '-')],
  ['코너킥', (s) => s.corners],
  ['파울', (s) => s.fouls],
  ['오프사이드', (s) => s.offsides],
  ['경고 / 퇴장', (s) => `${s.yellow} / ${s.red}`],
]

/** 내 팀의 지난 리그 경기 (최근 순) */
export function myResults(save, teamId) {
  return (save.results || []).filter((r) => r.home === teamId || r.away === teamId).sort((a, b) => b.round - a.round)
}

export default function RecentMatches({ save, teamId, teamsById, limit = 5 }) {
  const all = myResults(save, teamId)
  const [open, setOpen] = useState(null)
  const [more, setMore] = useState(false)
  const list = more ? all : all.slice(0, limit)
  return (
    <div className="card recent-matches">
      <div className="row between"><span className="eyebrow">지난 경기</span>{all.length > limit && <button className="linkish small" onClick={() => setMore(!more)}>{more ? '접기' : `이번 시즌 전체 ${all.length}경기`}</button>}</div>
      {!all.length && <p className="small muted" style={{ margin: '6px 0 0' }}>아직 치른 경기가 없습니다.</p>}
      <ul>
        {list.map((r) => {
          const home = r.home === teamId
          const opp = teamsById[home ? r.away : r.home]
          const [gf, ga] = home ? r.score : [...r.score].reverse()
          const res = gf > ga ? 'W' : gf < ga ? 'L' : 'D'
          const mine = (r.scorers || []).filter((g) => g.team === teamId)
          return (
            <li key={`${r.round}-${r.home}`}>
              <button className="rm-row" onClick={() => setOpen(r)}>
                <span className={`fchip ${res}`}>{{ W: '승', D: '무', L: '패' }[res]}</span>
                <span className="rm-round">{r.round + 1}R · {home ? '홈' : '원정'}</span>
                <span className="rm-opp">{opp && <Crest team={opp} size={18} />} {opp?.short || opp?.name || '상대'}</span>
                <b className="rm-score">{gf} : {ga}</b>
                <small className="rm-goals">{mine.length ? mine.map((g) => `${g.name.split(' ').at(-1)} ${g.minute}'`).join(', ') : ''}</small>
              </button>
            </li>
          )
        })}
      </ul>
      {open && <MatchDetail r={open} teamsById={teamsById} myId={teamId} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** 경기 상세: 득점 기록(시간·도움)·양 팀 통계·MOM */
export function MatchDetail({ r, teamsById, myId, onClose }) {
  const H = teamsById[r.home]
  const A = teamsById[r.away]
  const goals = [...(r.scorers || [])].sort((a, b) => a.minute - b.minute)
  const momName = r.mom && [...(H?.players || []), ...(A?.players || [])].find((p) => p.id === r.mom)?.name
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h3>{r.round + 1}라운드 경기 기록</h3><button className="btn ghost small" onClick={onClose}>닫기</button></div>
        <div className="md-score">
          <span className={r.home === myId ? 'me' : ''}>{H && <Crest team={H} size={30} />}<b>{H?.short || H?.name}</b></span>
          <strong>{r.score[0]} : {r.score[1]}</strong>
          <span className={r.away === myId ? 'me' : ''}>{A && <Crest team={A} size={30} />}<b>{A?.short || A?.name}</b></span>
        </div>
        {momName && <p className="small md-mom">⭐ 경기 최우수 선수: <b>{momName}</b></p>}
        <h4>골</h4>
        {!goals.length ? <p className="small muted">득점 없음</p> : (
          <ul className="md-goals">
            {goals.map((g, i) => (
              <li key={i} className={g.team === r.home ? 'h' : 'a'}>
                <span className="md-min">{g.minute}'</span>
                <span>⚽ <b>{g.name}</b>{g.assist_name ? <small className="muted"> (도움 {g.assist_name})</small> : null}</span>
              </li>
            ))}
          </ul>
        )}
        {r.stats && (
          <>
            <h4>경기 통계</h4>
            <table className="md-stats">
              <tbody>
                {STAT_ROWS.map(([label, f]) => (
                  <tr key={label}><td>{f(r.stats[0], r.stats[1])}</td><th>{label}</th><td>{f(r.stats[1], r.stats[0])}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
