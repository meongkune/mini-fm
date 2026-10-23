import { Component, useEffect, useRef } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useGame } from './store.jsx'
import Home from './pages/Home.jsx'
import Squad from './pages/Squad.jsx'
import Tactics from './pages/Tactics.jsx'
import Match from './pages/Match.jsx'
import League from './pages/League.jsx'
import DeployInfo from './pages/DeployInfo.jsx'
import Admin from './pages/Admin.jsx'
import Inbox from './pages/Inbox.jsx'
import Transfer from './pages/Transfer.jsx'
import Manager from './pages/Manager.jsx'
import Club from './pages/Club.jsx'
import MgrBadge from './components/MgrBadge.jsx'
import { Crest } from './components/Badges.jsx'
import { setViewMode, useViewMode } from './components/DeviceFrame.jsx'
import { eur } from './game/finance.js'

// 하단 탭 바: [경로, 라벨, 아이콘, 정확히 일치]
const NAV = [
  ['/', '홈', '🏠', true],
  ['/squad', '스쿼드', '👥'],
  ['/tactics', '전술', '📋'],
  ['/match', '경기', '⚽'],
  ['/league', '리그', '🏆'],
  ['/club', '구단', '🏛️'],
]

// 페이지에서 오류가 나도 앱 전체가 빈 화면이 되지 않도록 메시지와 복구 버튼을 보여준다
class PageErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card error">
        <p>화면을 그리는 중 오류가 발생했습니다: {String(this.state.error.message || this.state.error)}</p>
        <button className="btn" onClick={() => location.reload()}>새로고침</button>
      </div>
    )
  }
}

// PC 왼쪽 메뉴: [경로, 라벨, 아이콘, 정확히 일치]
const SIDE = [
  ['/', '홈', '🏠', true],
  ['/inbox', '받은 편지함', '📬'],
  ['/squad', '스쿼드', '👥'],
  ['/tactics', '전술', '📋'],
  ['/match', '경기', '⚽'],
  ['/league', '리그·대회', '🏆'],
  ['/transfer', '이적 시장', '💰'],
  ['/club', '구단 운영', '🏛️'],
  ['/manager', '감독', '👔'],
]

export default function App() {
  const { mode } = useViewMode()
  return mode === 'desktop' ? <DesktopApp /> : <MobileApp />
}

/** 페이지 영역 (PC·모바일 공통) */
function Pages() {
  const { data, error } = useGame()
  const { pathname } = useLocation()
  const isAdmin = pathname.startsWith('/admin')
  return (
    <>
      {/* 데이터 관리 화면은 게임 데이터 로딩과 상관없이 연다 */}
      {isAdmin && <PageErrorBoundary resetKey={pathname}><Admin /></PageErrorBoundary>}
      {!isAdmin && error && <div className="card error">API 연결 실패: {error}</div>}
      {!isAdmin && !data && !error && <div className="card muted">데이터를 불러오는 중…</div>}
      {!isAdmin && data && (
        <PageErrorBoundary resetKey={pathname}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/squad" element={<Squad />} />
          <Route path="/tactics" element={<Tactics />} />
          <Route path="/match" element={<Match />} />
          <Route path="/league" element={<League />} />
          <Route path="/deploy" element={<DeployInfo />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/transfer" element={<Transfer />} />
          <Route path="/manager" element={<Manager />} />
          <Route path="/club" element={<Club />} />
          <Route path="*" element={<div className="card">페이지를 찾을 수 없습니다.</div>} />
        </Routes>
        </PageErrorBoundary>
      )}
    </>
  )
}

/** PC: FM식 — 왼쪽 메뉴 + 위쪽 상태줄(라운드·현금·다음 경기) + 넓은 본문 */
function DesktopApp() {
  const { myTeam, unread, seasonText, manager, save, nextFixture, totalRounds, seasonOver } = useGame()
  const { pathname } = useLocation()
  const mainRef = useRef(null)
  useEffect(() => { mainRef.current?.scrollTo(0, 0) }, [pathname])
  const opp = nextFixture && (nextFixture.isHome ? nextFixture.awayTeam : nextFixture.homeTeam)
  return (
    <div className="desk" style={{ '--c': myTeam?.color || '#7c5cff' }}>
      <aside className="side">
        <Link to="/" className="side-brand"><span className="logo">⚽</span><strong>Mini FM</strong></Link>
        {myTeam && (
          <div className="side-club">
            <Crest team={myTeam} size={38} />
            <div><strong>{myTeam.name}</strong><small>{seasonText}</small></div>
          </div>
        )}
        <nav className="side-nav" aria-label="주요 메뉴">
          {SIDE.map(([to, label, icon, end]) => (
            <NavLink key={to} to={to} end={end}>
              <span className="ico" aria-hidden="true">{icon}</span>{label}
              {to === '/inbox' && unread > 0 && <b className="side-badge">{unread > 99 ? '99+' : unread}</b>}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          {manager && <Link to="/manager" className="side-mgr"><MgrBadge name={manager.name} color={myTeam?.color} size={28} /><span>{manager.name}</span></Link>}
          <button className="linkish small" onClick={() => setViewMode('phone')}>📱 모바일 보기</button>
          <Link className="linkish small" to="/deploy">📡 배포 정보</Link>
        </div>
      </aside>
      <div className="desk-body">
        <header className="desk-top">
          {myTeam ? (
            <>
              <span className="dt-round">{seasonOver ? '시즌 종료' : `${save.round + 1} / ${totalRounds} 라운드`}</span>
              {save.finance && <span className="dt-chip">💰 {eur(save.finance.cash)}</span>}
              <span className="dt-chip">😊 민심 {save.fans ?? 60}</span>
              <span className="grow" />
              {opp && !seasonOver && <span className="dt-next"><Crest team={opp} size={20} /> 다음: {nextFixture.cup ? `${nextFixture.comp?.icon || '🏆'} ` : ''}{opp.name} ({nextFixture.isHome ? '홈' : '원정'})</span>}
              <Link className="btn dt-go" to={seasonOver ? '/' : '/match'}>{seasonOver ? '시즌 마감 ▶' : '경기 진행 ▶'}</Link>
            </>
          ) : <span className="dt-round">맡을 팀을 고르세요</span>}
        </header>
        <main className="desk-main" ref={mainRef}><Pages /></main>
      </div>
    </div>
  )
}

/** 폰·좁은 화면 (그리고 PC '모바일 보기') */
function MobileApp() {
  const { data, error, myTeam, unread, seasonText, manager } = useGame()
  const { pathname } = useLocation()
  // 중괄호 필수: scrollTo의 반환값(최신 브라우저는 Promise)을 cleanup으로 반환하면 다음 이동 때 React가 터진다
  // PC 휴대폰 프레임에서는 .app이 스크롤 영역이므로 둘 다 맨 위로
  const appRef = useRef(null)
  useEffect(() => { window.scrollTo(0, 0); appRef.current?.scrollTo(0, 0) }, [pathname])
  return (
    <div className="app" ref={appRef}>
      <header className="topbar">
        <div className="brand">
          <span className="logo">⚽</span>
          <div>
            <strong>Mini FM</strong>
            <small>{seasonText || '미니 축구 감독 시뮬레이션'}</small>
          </div>
        </div>
        <div className="top-actions">
        {manager && (
          <Link to="/manager" className="top-avatar" aria-label="감독 프로필">
            <MgrBadge name={manager.name} color={myTeam?.color} size={32} />
          </Link>
        )}
        {myTeam && (
          <Link to="/inbox" className="bell" aria-label={`받은 편지함${unread ? ` (새 소식 ${unread}개)` : ''}`}>
            📬{unread > 0 && <b>{unread > 9 ? '9+' : unread}</b>}
          </Link>
        )}
        </div>
      </header>
      {myTeam && (
        <div className="team-strip" style={{ '--c': myTeam.color }}>
          <i />감독 중: {myTeam.name}
        </div>
      )}

      <main><Pages /></main>

      <footer>
        비공식 팬 프로젝트입니다. 구단 엠블럼은 각 구단의 상표이며 이미지는 football-data.org, 국기는 flagcdn.com에서 불러옵니다. 능력치·경기 결과는 게임용 값으로 실제 구단·리그와 관계없습니다.
      </footer>

      <nav className="tabbar" aria-label="주요 메뉴">
        {NAV.map(([to, label, icon, end]) => (
          <NavLink key={to} to={to} end={end}>
            <span className="ico" aria-hidden="true">{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
