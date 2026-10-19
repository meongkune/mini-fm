import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PlayerCard from '../components/PlayerCard.jsx'
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
  const { data, myTeam, save, standings, nextFixture, teamsById, totalRounds, seasonOver, chooseTeam, quitTeam } = useGame()
  const [busy, setBusy] = useState(null)
  const navigate = useNavigate()

  if (!myTeam) {
    const teams = [...data.teams].sort((a, b) => teamOvr(b) - teamOvr(a))
    return (
      <section>
        <div className="hero">
          <span className="eyebrow">{data.league}</span>
          <h1>맡을 팀을 고르세요</h1>
          <p>{teams.length}개 구단이 홈·원정 두 번씩 맞붙는 {(teams.length - (teams.length % 2 ? 0 : 1)) * 2}라운드 시즌입니다.</p>
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
  const stars = [...myTeam.players].sort((a, b) => playerOvr(b) - playerOvr(a)).slice(0, 4)
  const played = save.results.length > 0

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
      <div className="card-grid two" style={{ marginBottom: 16 }}>
        {stars.map((p) => <PlayerCard key={p.id} player={p} size="lg" onClick={() => navigate('/squad')} />)}
      </div>

      <div className="row end">
        <button className="btn ghost small" onClick={() => { if (confirm('팀을 바꾸면 현재 시즌 기록이 삭제됩니다. 계속할까요?')) quitTeam() }}>
          팀 변경 (시즌 초기화)
        </button>
      </div>
    </section>
  )
}
