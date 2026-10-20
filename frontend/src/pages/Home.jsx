import { useState } from 'react'
import { Link } from 'react-router-dom'
import PlayerCard from '../components/PlayerCard.jsx'
import PlayerSheet from '../components/PlayerSheet.jsx'
import { Crest } from '../components/Badges.jsx'
import ManagerAvatar from '../components/ManagerAvatar.jsx'
import { ink, playerOvr, short, teamOvr, useGame } from '../store.jsx'

// 전력 순위에 따른 한 줄 소개 (팀 수와 관계없이 4등분)
function strengthLabel(rank, total) {
  const q = rank / total
  if (q < 0.25) return '우승 후보'
  if (q < 0.5) return '상위권 전력'
  if (q < 0.75) return '중위권 전력'
  return '언더독 · 도전 모드'
}

export default function Home() {
  const { data, myTeam, save, standings, nextFixture, teamsById, totalRounds, seasonOver, chooseTeam, chooseSeason, quitTeam, status, unread, seasonText, review, startNextSeason, manager } = useGame()
  const [busy, setBusy] = useState(null)
  const [detail, setDetail] = useState(null)

  if (!myTeam) {
    const teams = [...data.teams].sort((a, b) => teamOvr(b) - teamOvr(a))
    const top = teamOvr(teams[0])
    const floor = teamOvr(teams.at(-1)) - 4 // 막대 기준점: 최약팀보다 조금 아래
    return (
      <section>
        {save.sacked && (
          <div className="card sacked">
            <strong>🏛️ 경질 통보</strong>
            <p>{teamsById[save.sacked.team]?.name} 보드가 두 시즌 연속 목표 미달을 이유로 감독직 해임을 결정했습니다. 새로운 팀에서 다시 시작하세요.</p>
            {save.sacked.history?.length > 0 && <p className="small muted">커리어: {save.sacked.history.map((h) => `${h.label} ${h.pos}위`).join(' · ')}</p>}
          </div>
        )}
        <Link to="/manager" className={`card mgr-card ${manager ? '' : 'cta'}`}>
          {manager ? <ManagerAvatar look={manager.look} size={64} /> : <span className="mgr-ghost">👔</span>}
          <span className="grow">
            <small className="muted">{manager ? '감독' : '먼저 감독을 만들어 보세요'}</small>
            <strong>{manager ? manager.name : '감독 만들기'}</strong>
            <em className="muted small">{manager ? '프로필 꾸미기 →' : '얼굴·헤어·수염·의상 고르기 →'}</em>
          </span>
        </Link>
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
                <span className="tc-crest"><Crest team={t} size={30} /></span>
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
        <span className="th-crest"><Crest team={myTeam} size={54} /></span>
        <div className="th-text">
          <span className="th-label">내 팀</span>
          <h1>{myTeam.name}</h1>
          <span className="th-sub">{seasonText}{save.seasonNo > 1 ? ` · ${save.seasonNo}번째 시즌` : ''}</span>
        </div>
        <div className="th-ovr"><strong>{teamOvr(myTeam)}</strong><span>OVR</span></div>
      </div>
      {manager && (
        <Link to="/manager" className="card mgr-strip">
          <ManagerAvatar look={manager.look} teamColor={myTeam.color} size={52} />
          <span className="grow"><small className="muted">감독</small><strong>{manager.name}</strong></span>
          {save.board && <span className="muted small">보드 신뢰도 {save.board.confidence}</span>}
        </Link>
      )}

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
      {save.board && !seasonOver && <BoardCard board={save.board} rank={played ? rank : null} />}

      <div className="card next-match">
        {seasonOver ? (
          <SeasonEnd review={review} rank={rank} history={save.history || []} onNext={startNextSeason} />
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
        {stars.map((p) => <PlayerCard key={p.id} player={p} size="lg" color={myTeam.color} status={status[p.id]} onClick={() => setDetail(p)} />)}
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

function BoardCard({ board, rank }) {
  const ok = rank !== null && rank <= board.pos
  return (
    <div className="card board">
      <div className="row between">
        <span className="eyebrow">🏛️ 보드 목표</span>
        <span className={`pill ${rank === null ? '' : ok ? 'ok' : 'bad'}`}>{rank === null ? '시즌 전' : ok ? `현재 ${rank}위 · 순항` : `현재 ${rank}위 · 목표 미달`}</span>
      </div>
      <strong className="board-goal">{board.label}</strong>
      <div className="conf"><span>보드 신뢰도</span><div className="conf-bar"><i style={{ width: `${board.confidence}%` }} className={board.confidence >= 60 ? 'hi' : board.confidence >= 35 ? 'mid' : 'lo'} /></div><b>{board.confidence}</b></div>
      {board.fails > 0 && <p className="small bad-text">지난 시즌 목표 미달 — 이번 시즌도 실패하면 경질됩니다.</p>}
    </div>
  )
}

function SeasonEnd({ review, rank, history, onNext }) {
  if (!review) return null
  return (
    <div className="season-end">
      <h2>🏁 시즌 종료 · 최종 {rank}위{rank === 1 ? ' 🏆' : ''}</h2>
      <div className={`verdict ${review.success ? 'ok' : 'bad'}`}>
        <strong>{review.success ? '보드 목표 달성' : '보드 목표 미달'}</strong>
        <span>{review.target.label}</span>
        {!review.success && <em>{review.sacked ? '두 시즌 연속 미달 — 다음 시즌으로 넘어가면 경질됩니다.' : '한 번 더 실패하면 경질됩니다.'}</em>}
      </div>
      <p className="small muted">다음 시즌에는 모든 선수가 한 살 많아지고, 출전 시간과 잠재력에 따라 성장하거나 하락합니다. 35세 이상은 은퇴할 수 있고 유스 선수 2명이 올라옵니다.</p>
      <div className="row">
        <Link className="btn ghost" to="/league">최종 순위</Link>
        <button className="btn" onClick={() => { if (confirm(review.sacked ? '시즌을 마감합니다. 경질되어 팀을 다시 골라야 합니다.' : '다음 시즌을 시작할까요?')) onNext() }}>{review.sacked ? '시즌 마감' : '다음 시즌 시작 ▶'}</button>
      </div>
      {history.length > 0 && (
        <ul className="history">
          {history.map((h) => <li key={h.seasonNo}><span>{h.label}</span><b>{h.pos}위</b><em className={h.success ? 'ok' : 'bad'}>{h.success ? '목표 달성' : '미달'}</em>{h.topScorer && <small>득점 1위 {h.topScorer.name} {h.topScorer.g}골</small>}</li>)}
        </ul>
      )}
    </div>
  )
}
