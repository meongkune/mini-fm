import { useState } from 'react'
import { Link } from 'react-router-dom'
import { short, teamOvr, useGame } from '../store.jsx'

export default function Home() {
  const { data, myTeam, save, standings, nextFixture, teamsById, totalRounds, seasonOver, chooseTeam, quitTeam } = useGame()
  const [busy, setBusy] = useState(null)

  if (!myTeam) {
    return (
      <section>
        <div className="hero">
          <h1>감독님, 어느 팀을 맡으시겠습니까?</h1>
          <p>8개 구단이 홈·원정 2번씩 맞붙는 14라운드 시즌입니다. 스쿼드와 전술을 짜고 우승에 도전하세요.</p>
        </div>
        <div className="team-grid">
          {[...data.teams].sort((a, b) => teamOvr(b) - teamOvr(a)).map((t, rank) => {
            const ovr = teamOvr(t)
            return (
              <button key={t.id} className="team-card" style={{ '--c': t.color }} disabled={!!busy}
                onClick={async () => { setBusy(t.id); await chooseTeam(t.id); setBusy(null) }}>
                <span className="crest">{t.id}</span>
                <strong>{t.name}</strong>
                <span className="ovr">OVR {ovr}</span>
                <span className="muted small">{['우승 후보', '우승 후보', '상위권 전력', '상위권 전력', '중위권 전력', '중위권 전력', '언더독 — 도전 모드', '언더독 — 도전 모드'][rank]}</span>
                {busy === t.id && <span className="small">계약 중…</span>}
              </button>
            )
          })}
        </div>
      </section>
    )
  }

  const rank = standings.findIndex((s) => s.id === myTeam.id) + 1
  const me = standings[rank - 1]
  const opp = nextFixture && teamsById[nextFixture.home === myTeam.id ? nextFixture.away : nextFixture.home]
  const isHome = nextFixture?.home === myTeam.id

  return (
    <section>
      <div className="hero" style={{ '--c': myTeam.color }}>
        <h1>{myTeam.name}</h1>
        <p>{data.league} · 팀 OVR {teamOvr(myTeam)}</p>
      </div>

      <div className="grid-3">
        <div className="card stat"><span>현재 순위</span><strong>{save.results.length ? `${rank}위` : '-'}</strong></div>
        <div className="card stat"><span>전적</span><strong>{me.w}승 {me.d}무 {me.l}패</strong></div>
        <div className="card stat"><span>승점</span><strong>{me.pts}</strong></div>
      </div>

      <div className="card next-match">
        {seasonOver ? (
          <>
            <h2>🏁 시즌 종료</h2>
            <p>최종 {rank}위 {rank === 1 ? '— 🏆 우승을 축하합니다!' : ''}</p>
            <Link className="btn" to="/league">최종 순위 보기</Link>
          </>
        ) : (
          <>
            <span className="muted">다음 경기 · {save.round + 1} / {totalRounds} 라운드</span>
            <h2>
              {short(isHome ? myTeam : opp)} <em>vs</em> {short(isHome ? opp : myTeam)}
            </h2>
            <p className="muted">{isHome ? '🏟️ 홈 경기' : '✈️ 원정 경기'} · 상대 OVR {teamOvr(opp)}</p>
            <div className="row">
              <Link className="btn ghost" to="/squad">스쿼드 확인</Link>
              <Link className="btn ghost" to="/tactics">전술 설정</Link>
              <Link className="btn" to="/match">경기장으로 ▶</Link>
            </div>
          </>
        )}
      </div>

      <div className="row end">
        <button className="btn ghost small" onClick={() => { if (confirm('팀을 바꾸면 현재 시즌 기록이 삭제됩니다. 계속할까요?')) quitTeam() }}>
          팀 변경 (시즌 초기화)
        </button>
      </div>
    </section>
  )
}
