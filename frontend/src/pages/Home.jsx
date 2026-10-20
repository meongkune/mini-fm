import { useState } from 'react'
import { Link } from 'react-router-dom'
import PlayerCard from '../components/PlayerCard.jsx'
import PlayerSheet from '../components/PlayerSheet.jsx'
import { ink, playerOvr, short, teamOvr, useGame } from '../store.jsx'

// 전력 순위에 따른 한 줄 소개 (팀 수와 관계없이 4등분)
function strengthLabel(rank, total) {
  const q = rank / total
  if (q < 0.25) return '우승 후보'
  if (q < 0.5) return '상위권 전력'
  if (q < 0.75) return '중위권 전력'
  return '언더독 · 도전 모드'
}

function Crest({ team, size = 40 }) {
  return (
    <span className="crest" style={{ '--c': team.color, color: ink(team.color), width: size, height: size }}>{team.id}</span>
  )
}

export default function Home() {
  const { data, myTeam, save, standings, nextFixture, teamsById, totalRounds, seasonOver, chooseTeam, chooseSeason, quitTeam, status, unread } = useGame()
  const [busy, setBusy] = useState(null)
  const [detail, setDetail] = useState(null)

  if (!myTeam) {
    const teams = [...data.teams].sort((a, b) => teamOvr(b) - teamOvr(a))
    const top = teamOvr(teams[0])
    const floor = teamOvr(teams.at(-1)) - 4 // 막대 기준점: 최약팀보다 조금 아래
    return (
      <section>
        <div className="hero">
          <span className="eyebrow">{data.league}</span>
          <h1>맡을 팀을 고르세요</h1>
          <p>{teams.length}개 구단이 홈·원정 두 번씩 맞붙는 {(teams.length - (teams.length % 2 ? 0 : 1)) * 2}라운드 시즌입니다.</p>
        </div>

        <div className="season-picker">
          {data.index.leagues.map((l) => (
            <div key={l.id} className="sp-league">
              <span className="sp-name">{l.name}<small>{l.country}</small></span>
              <div className="sp-chips">
                {l.seasons.map((s) => {
                  const on = data.leagueId === l.id && data.seasonId === s.id
                  return (
                    <button key={s.id} className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => !on && chooseSeason(l.id, s.id)}>
                      {s.id}<small>{s.teams}팀</small>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="team-grid">
          {teams.map((t, rank) => (
            <button key={t.id} className="team-card" style={{ '--c': t.color, '--ink': ink(t.color) }} disabled={!!busy}
              onClick={async () => { setBusy(t.id); await chooseTeam(t.id); setBusy(null) }}>
              <span className="tc-top">
                <span className="tc-id">{t.id}</span>
                <span className="tc-ovr">{teamOvr(t)}</span>
              </span>
              <strong>{t.name}</strong>
              <span className="tc-bar"><span style={{ width: `${((teamOvr(t) - floor) / (top - floor)) * 100}%` }} /></span>
              <span className="tc-label">{busy === t.id ? '계약 중…' : strengthLabel(rank, teams.length)}</span>
            </button>
          ))}
        </div>
      </section>
    )
  }

  const rank = standings.findIndex((s) => s.id === myTeam.id) + 1
  const me = standings[rank - 1]
  const opp = nextFixture && teamsById[nextFixture.home === myTeam.id ? nextFixture.away : nextFixture.home]
  const isHome = nextFixture?.home === myTeam.id
  const stars = [...myTeam.players].sort((a, b) => playerOvr(b) - playerOvr(a)).slice(0, 6)
  const played = save.results.length > 0
  const form = me.form.slice(-5)

  return (
    <section>
      <div className="team-hero" style={{ '--c': myTeam.color, '--ink': ink(myTeam.color) }}>
        <div>
          <span className="th-label">내 팀</span>
          <h1>{myTeam.name}</h1>
          <span className="th-sub">{data.league}</span>
        </div>
        <div className="th-ovr"><strong>{teamOvr(myTeam)}</strong><span>OVR</span></div>
      </div>

      <div className="grid-3">
        <div className="card stat"><span>순위</span><strong>{played ? `${rank}위` : '-'}</strong></div>
        <div className="card stat"><span>전적</span><strong>{me.w}승 {me.d}무 {me.l}패</strong></div>
        <div className="card stat"><span>승점</span><strong>{me.pts}</strong></div>
      </div>

      <div className="card form-card">
        <span className="eyebrow">최근 5경기</span>
        <div className="form-row">
          {Array.from({ length: 5 }, (_, i) => {
            const f = form[i]
            return <span key={i} className={`fchip ${f || 'none'}`}>{f ? { W: '승', D: '무', L: '패' }[f] : '–'}</span>
          })}
        </div>
      </div>

      <TeamStatus team={myTeam} status={status} lineup={save.lineup} inbox={save.inbox || []} unread={unread} />

      <div className="card next-match">
        {seasonOver ? (
          <>
            <h2>🏁 시즌 종료</h2>
            <p>최종 {rank}위 {rank === 1 ? '· 🏆 우승을 축하합니다!' : ''}</p>
            <Link className="btn wide" to="/league">최종 순위 보기</Link>
          </>
        ) : (
          <>
            <div className="row between">
              <span className="eyebrow">다음 경기 · {save.round + 1}/{totalRounds} 라운드</span>
              <span className="pill">{isHome ? '홈' : '원정'}</span>
            </div>
            <div className="versus">
              <div><Crest team={isHome ? myTeam : opp} size={46} /><strong>{short(isHome ? myTeam : opp)}</strong></div>
              <em>VS</em>
              <div><Crest team={isHome ? opp : myTeam} size={46} /><strong>{short(isHome ? opp : myTeam)}</strong></div>
            </div>
            <p className="muted small center">상대 OVR {teamOvr(opp)}</p>
            <Link className="btn wide" to="/match">경기장으로 ▶</Link>
            <div className="row" style={{ marginTop: 8 }}>
              <Link className="btn ghost small" to="/squad">스쿼드</Link>
              <Link className="btn ghost small" to="/tactics">전술</Link>
            </div>
          </>
        )}
      </div>

      <div className="section-head" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>핵심 선수</h3>
        <Link className="link" to="/squad">전체 보기 →</Link>
      </div>
      <div className="scroll-row" style={{ marginBottom: 16 }}>
        {stars.map((p) => <PlayerCard key={p.id} player={p} size="lg" status={status[p.id]} onClick={() => setDetail(p)} />)}
      </div>

      {detail && <PlayerSheet player={detail} onClose={() => setDetail(null)} />}

      <div className="row end">
        <button className="btn ghost small" onClick={() => { if (confirm('팀을 바꾸면 현재 시즌 기록이 삭제됩니다. 계속할까요?')) quitTeam() }}>
          팀 변경 (시즌 초기화)
        </button>
      </div>
    </section>
  )
}

// 팀 상태 요약: 선발 평균 컨디션, 부상·징계·불만, 최근 소식
function TeamStatus({ team, status, lineup, inbox, unread }) {
  const ids = team.players.map((p) => p.id)
  const inj = ids.filter((id) => status[id]?.inj > 0).length
  const susp = ids.filter((id) => status[id]?.susp > 0).length
  const upset = ids.filter((id) => (status[id]?.morale ?? 60) < 40).length
  const cond = Math.round(lineup.reduce((s, id) => s + (status[id]?.cond ?? 100), 0) / (lineup.length || 1))
  const morale = Math.round(ids.reduce((s, id) => s + (status[id]?.morale ?? 60), 0) / (ids.length || 1))
  const latest = inbox.slice(0, 2)
  return (
    <div className="card team-status">
      <div className="ts-grid">
        <div><span>선발 컨디션</span><strong className={cond >= 80 ? 'good' : cond >= 65 ? 'ok' : 'bad'}>{cond}%</strong></div>
        <div><span>팀 사기</span><strong className={morale >= 60 ? 'good' : morale >= 45 ? 'ok' : 'bad'}>{morale}</strong></div>
        <div><span>부상·징계</span><strong className={inj + susp ? 'bad' : 'good'}>{inj + susp}</strong></div>
        <div><span>불만</span><strong className={upset ? 'bad' : 'good'}>{upset}</strong></div>
      </div>
      {latest.length > 0 && (
        <Link to="/inbox" className="ts-inbox">
          <span>📬 {unread > 0 ? `새 소식 ${unread}개` : '받은 편지함'}</span>
          <em>{latest[0].title}</em>
        </Link>
      )}
    </div>
  )
}
