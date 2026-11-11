import { useState } from 'react'
import { Link } from 'react-router-dom'
import PlayerCard from '../components/PlayerCard.jsx'
import PlayerSheet from '../components/PlayerSheet.jsx'
import { Crest } from '../components/Badges.jsx'
import MgrBadge from '../components/MgrBadge.jsx'
import { ICON, catOf, needsAnswer, preview } from './Inbox.jsx'
import { moraleLabel, unavailable } from '../game/season.js'
import { eur } from '../game/finance.js'
import { fanLabel } from '../game/owner.js'
import { ink, lineupOvr, playerOvr, short, teamOvr, useGame } from '../store.jsx'

// 전력 순위에 따른 한 줄 소개 (팀 수와 관계없이 4등분)
function strengthLabel(rank, total) {
  const q = rank / total
  if (q < 0.25) return '우승 후보'
  if (q < 0.5) return '상위권 전력'
  if (q < 0.75) return '중위권 전력'
  return '언더독 · 도전 모드'
}

export default function Home() {
  const { data, myTeam, save, standings, nextFixture, teamsById, totalRounds, seasonOver, chooseTeam, chooseSeason, quitTeam, status, unread, seasonText, review, startNextSeason, manager, venueOf } = useGame()
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
            <strong>{save.sacked.bankrupt ? '💸 구단 파산' : '🏛️ 경질 통보'}</strong>
            <p>{save.sacked.bankrupt ? `${teamsById[save.sacked.team]?.name}이(가) 빚을 감당하지 못하고 파산했습니다 (현금 ${Math.round(save.sacked.cash)}M). 다른 구단을 인수해 다시 시작하세요.` : `${teamsById[save.sacked.team]?.name} 보드가 두 시즌 연속 목표 미달을 이유로 감독직 해임을 결정했습니다. 새로운 팀에서 다시 시작하세요.`}</p>
            {save.sacked.history?.length > 0 && <p className="small muted">커리어: {save.sacked.history.map((h) => `${h.label} ${h.pos}위`).join(' · ')}</p>}
          </div>
        )}
        <Link to="/manager" className={`card mgr-card ${manager ? '' : 'cta'}`}>
          {manager ? <MgrBadge name={manager.name} color={myTeam?.color} size={56} /> : <span className="mgr-ghost">👔</span>}
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
          {data.index.leagues.filter((l) => !l.marketOnly).map((l) => (
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
  const isHome = nextFixture?.isHome
  const opp = nextFixture && (isHome ? nextFixture.awayTeam : nextFixture.homeTeam)
  const played = save.results.length > 0
  const form = me.form.slice(-5)

  return (
    <section className="home-dash">
      <div className="dash-col">
        <InboxPanel inbox={save.inbox || []} unread={unread} />
      </div>
      <div className="dash-col">
      <div className="team-hero" style={{ '--c': myTeam.color, '--ink': ink(myTeam.color) }}>
        <span className="th-crest"><Crest team={myTeam} size={54} /></span>
        <div className="th-text">
          <span className="th-label">내 팀</span>
          <h1>{myTeam.name}</h1>
          <span className="th-sub">{seasonText}{save.seasonNo > 1 ? ` · ${save.seasonNo}번째 시즌` : ''}</span>
        </div>
        <div className="th-ovr" title={`최고 전력 ${teamOvr(myTeam)}`}><strong>{lineupOvr(myTeam, save.formation, save.lineup)}</strong><span>라인업</span></div>
      </div>
      {manager && (
        <Link to="/manager" className="card mgr-strip">
          <MgrBadge name={manager.name} color={myTeam.color} size={52} />
          <span className="grow"><small className="muted">감독</small><strong>{manager.name}</strong></span>
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

      <TeamStatus team={myTeam} status={status} lineup={save.lineup} inbox={save.inbox || []} unread={unread} onPick={setDetail} />

      <div className="card next-match">
        {seasonOver ? (
          <SeasonEnd review={review} rank={rank} history={save.history || []} onNext={startNextSeason} />
        ) : (
          <>
            <div className="row between">
              <span className="eyebrow">{nextFixture.cup ? <b className="cup-badge">{nextFixture.comp?.icon || '🏆'} {nextFixture.label}</b> : `다음 경기 · ${save.round + 1}/${totalRounds} 라운드`}</span>
              {venueOf(nextFixture.home) && <span className="small muted venue-mini">🏟️ {venueOf(nextFixture.home).name}{venueOf(nextFixture.home).cap ? ` · 수용 ${venueOf(nextFixture.home).cap.toLocaleString()}명` : ''}</span>}
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
        <h3 style={{ margin: 0 }}>팀 기록</h3>
        <Link className="link" to="/squad">선수단 기록표 →</Link>
      </div>
      <TeamLeaders team={myTeam} save={save} status={status} onPick={setDetail} />

      {detail && <PlayerSheet player={detail} onClose={() => setDetail(null)} />}

      <div className="row end">
        <button className="btn ghost small" onClick={() => { if (confirm('팀을 바꾸면 현재 시즌 기록이 삭제됩니다. 계속할까요?')) quitTeam() }}>
          팀 변경 (시즌 초기화)
        </button>
      </div>
      </div>
      <div className="dash-col">
        <MiniTable standings={standings} teamsById={teamsById} myId={myTeam.id} />
        {save.finance && <OwnerCard finance={save.finance} fans={save.fans ?? 60} />}
      </div>
    </section>
  )
}

// 팀 상태 요약: 선발 평균 컨디션, 팀 사기, 부상·징계·불만 — 숫자를 누르면 누가 왜 그런지 펼쳐진다
function TeamStatus({ team, status, lineup, inbox, unread, onPick }) {
  const [open, setOpen] = useState(null) // 'out' | 'upset'
  const ids = team.players.map((p) => p.id)
  const out = team.players.filter((p) => unavailable(status[p.id])).map((p) => ({ p, u: unavailable(status[p.id]) }))
  // 불만: 사기 40 미만 — 이유를 상태에서 찾아 보여준다
  const upset = team.players.filter((p) => (status[p.id]?.morale ?? 60) < 40).map((p) => {
    const st = status[p.id] || {}
    const why = [
      st.wantsOut && '이적 요청 중',
      st.benched >= 3 && `${st.benched}경기 연속 결장`,
      st.sulk > 0 && '감독에게 서운함',
      (st.promises || []).some((x) => x.broken) && '약속을 어김',
      st.contractAsked && '재계약 요구',
      st.wageAsked && '연봉 인상 요구',
      st.fr?.length >= 3 && st.form < 6.3 && '최근 부진',
    ].filter(Boolean)
    return { p, st, why: why.length ? why : ['사기 저하'] }
  }).sort((a, b) => (a.st.morale ?? 60) - (b.st.morale ?? 60))
  const cond = Math.round(lineup.reduce((s, id) => s + (status[id]?.cond ?? 100), 0) / (lineup.length || 1))
  const morale = Math.round(ids.reduce((s, id) => s + (status[id]?.morale ?? 60), 0) / (ids.length || 1))
  const latest = inbox[0]
  const Tile = ({ k, label, value, tone }) => (
    <button className={`ts-tile ${open === k ? 'on' : ''} ${value ? 'has' : ''}`} disabled={!value} onClick={() => setOpen(open === k ? null : k)}>
      <span>{label}</span><strong className={tone}>{value}</strong>{value > 0 && <small>{open === k ? '접기 ▲' : '누가? ▼'}</small>}
    </button>
  )
  return (
    <div className="card team-status">
      <div className="ts-grid">
        <div><span>선발 컨디션</span><strong className={cond >= 80 ? 'good' : cond >= 65 ? 'ok' : 'bad'}>{cond}%</strong></div>
        <div><span>팀 사기</span><strong className={morale >= 60 ? 'good' : morale >= 45 ? 'ok' : 'bad'}>{morale}</strong></div>
        <Tile k="out" label="부상·징계" value={out.length} tone={out.length ? 'bad' : 'good'} />
        <Tile k="upset" label="불만" value={upset.length} tone={upset.length ? 'bad' : 'good'} />
      </div>
      {open === 'out' && (
        <ul className="ts-list">
          {out.map(({ p, u }) => (
            <li key={p.id}><button onClick={() => onPick(p)}>
              <span className={`ts-ico ${u.kind}`}>{u.icon}</span>
              <span className="ts-who"><strong>{p.name}</strong><small>{p.role || p.pos} · {u.label}: {u.why}</small></span>
              <b className="ts-games">{u.games}경기</b>
            </button></li>
          ))}
        </ul>
      )}
      {open === 'upset' && (
        <ul className="ts-list">
          {upset.map(({ p, st, why }) => (
            <li key={p.id}><button onClick={() => onPick(p)}>
              <span className="ts-ico">{moraleLabel(st.morale)[0]}</span>
              <span className="ts-who"><strong>{p.name}</strong><small>{why.join(' · ')}</small></span>
              <b className="ts-games">사기 {Math.round(st.morale ?? 60)}</b>
            </button></li>
          ))}
        </ul>
      )}
      {latest && (
        <Link to="/inbox" className="ts-inbox">
          <span>📬 {unread > 0 ? `새 소식 ${unread}개` : '메시지함'}</span>
          <em>{ICON[latest.type] || '📩'} {latest.title}</em>
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

function OwnerCard({ finance, fans }) {
  const [face, label] = fanLabel(fans)
  return (
    <Link to="/club" className="card owner-card">
      <div><span>현금</span><strong className={finance.cash < 0 ? 'bad-text' : ''}>{eur(finance.cash)}</strong></div>
      <div><span>팬 민심</span><strong>{face} {fans}</strong><small>{label}</small></div>
      <div><span>지난 경기</span><strong className={(finance.last?.net ?? 0) >= 0 ? 'good-text' : 'bad-text'}>{finance.last ? `${finance.last.net >= 0 ? '+' : ''}${eur(finance.last.net)}` : '-'}</strong></div>
      <em>🏛️ 구단 운영 →</em>
    </Link>
  )
}

// PC 대시보드: 최근 소식 (편지함 미리보기)
function InboxPanel({ inbox, unread }) {
  const todo = inbox.filter(needsAnswer)
  const rest = inbox.filter((m) => !needsAnswer(m)).slice(0, 10)
  const Row = ({ m }) => (
    <li className={`cat-${catOf(m.type)}`}>
      <Link to="/inbox" className={`${m.read ? '' : 'unread'} ${needsAnswer(m) ? 'todo' : ''}`}>
        <span className="di-ico">{ICON[m.type] || '📩'}</span>
        <span className="di-text"><strong>{m.title}</strong><small>{m.round + 1}R · {preview(m, 34)}</small></span>
        {needsAnswer(m) ? <em className="m2-badge">답 필요</em> : !m.read && <i className="m2-dot" />}
      </Link>
    </li>
  )
  return (
    <div className="card dash-panel desk-only">
      <h3>📬 메시지함 <Link className="link small" to="/inbox">{unread ? `새 소식 ${unread}` : '전체'} →</Link></h3>
      {inbox.length === 0 ? <p className="small muted">아직 소식이 없습니다.</p> : (
        <>
          {todo.length > 0 && <p className="di-sub">⚡ 답이 필요한 메시지 {todo.length}</p>}
          <ul className="dash-inbox2">{todo.slice(0, 4).map((m) => <Row key={m.id} m={m} />)}</ul>
          {todo.length > 0 && <p className="di-sub muted">최근 소식</p>}
          <ul className="dash-inbox2">{rest.map((m) => <Row key={m.id} m={m} />)}</ul>
        </>
      )}
    </div>
  )
}

// PC 대시보드: 리그 순위 (상위권 + 내 팀 주변)
function MiniTable({ standings, teamsById, myId }) {
  const me = standings.findIndex((s) => s.id === myId)
  const idx = new Set([...standings.keys()].filter((i) => i < 5 || Math.abs(i - me) <= 2))
  return (
    <div className="card dash-panel desk-only">
      <h3>🏆 리그 순위 <Link className="link small" to="/league">전체 →</Link></h3>
      <table className="mini-table">
        <tbody>
          {standings.map((s, i) => idx.has(i) && (
            <tr key={s.id} className={s.id === myId ? 'me' : ''}>
              <td>{i + 1}</td>
              <td><span className="tn"><Crest team={teamsById[s.id]} size={16} />{short(teamsById[s.id])}</span></td>
              <td className="n">{s.p}</td>
              <td className="n">{s.gf - s.ga > 0 ? '+' : ''}{s.gf - s.ga}</td>
              <td className="n"><b>{s.pts}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 팀 기록: 득점·도움·평점·MOM·최근 폼 1위와 부진한 선수 — 누르면 선수 상세 */
function TeamLeaders({ team, save, status, onPick }) {
  const rows = team.players.map((p) => {
    const ps = save.pstats?.[p.id] || {}
    const st = status[p.id] || {}
    return { p, g: ps.g || 0, a: ps.a || 0, mom: ps.mom || 0, apps: ps.apps || 0, avg: ps.apps >= 3 ? ps.rsum / ps.apps : null, form: (st.fr || []).length >= 3 ? st.form : null }
  })
  const top = (k, min = 1) => [...rows].filter((r) => r[k] !== null && r[k] >= min).sort((a, b) => b[k] - a[k])[0]
  const low = [...rows].filter((r) => r.form !== null).sort((a, b) => a.form - b.form)[0]
  const items = [
    ['⚽', '최다 득점', top('g'), (r) => `${r.g}골`],
    ['🅰️', '최다 도움', top('a'), (r) => `${r.a}도움`],
    ['⭐', '평균 평점 (3경기+)', top('avg', 0), (r) => r.avg.toFixed(2)],
    ['🏅', '최다 MOM', top('mom'), (r) => `${r.mom}회`],
    ['🔥', '최근 폼 최고', top('form', 0), (r) => r.form.toFixed(1)],
    ['🧊', '최근 폼 부진', low && low.form < 6.6 ? low : null, (r) => r.form.toFixed(1)],
  ]
  if (!rows.some((r) => r.apps)) return <p className="small muted" style={{ marginBottom: 16 }}>시즌이 시작되면 득점·도움·평점 순위가 여기에 나옵니다.</p>
  return (
    <div className="leaders">
      {items.map(([icon, label, r, val]) => (
        <button key={label} className="card leader" disabled={!r} onClick={() => r && onPick(r.p)}>
          <span className="ld-icon">{icon}</span>
          <span className="ld-who"><span>{label}</span><strong>{r ? r.p.name : '—'}</strong></span>
          <span className="ld-val">{r ? val(r) : ''}</span>
        </button>
      ))}
    </div>
  )
}
