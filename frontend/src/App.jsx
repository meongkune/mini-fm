import { Component, useEffect } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useGame } from './store.jsx'
import Home from './pages/Home.jsx'
import Squad from './pages/Squad.jsx'
import Tactics from './pages/Tactics.jsx'
import Match from './pages/Match.jsx'
import League from './pages/League.jsx'
import DeployInfo from './pages/DeployInfo.jsx'

// 하단 탭 바: [경로, 라벨, 아이콘, 정확히 일치]
const NAV = [
  ['/', '홈', '🏠', true],
  ['/squad', '스쿼드', '👥'],
  ['/tactics', '전술', '📋'],
  ['/match', '경기', '⚽'],
  ['/league', '리그', '🏆'],
  ['/deploy', '상태', '📡'],
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

export default function App() {
  const { data, error, myTeam } = useGame()
  const { pathname } = useLocation()
  // 중괄호 필수: scrollTo의 반환값(최신 브라우저는 Promise)을 cleanup으로 반환하면 다음 이동 때 React가 터진다
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">⚽</span>
          <div>
            <strong>Mini FM</strong>
            <small>{data?.league ?? '미니 축구 감독 시뮬레이션'}</small>
          </div>
        </div>
      </header>
      {myTeam && (
        <div className="team-strip" style={{ '--c': myTeam.color }}>
          <i />감독 중: {myTeam.name}
        </div>
      )}

      <main>
        {error && <div className="card error">API 연결 실패: {error}</div>}
        {!data && !error && <div className="card muted">데이터를 불러오는 중…</div>}
        {data && (
          <PageErrorBoundary resetKey={pathname}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/squad" element={<Squad />} />
            <Route path="/tactics" element={<Tactics />} />
            <Route path="/match" element={<Match />} />
            <Route path="/league" element={<League />} />
            <Route path="/deploy" element={<DeployInfo />} />
            <Route path="*" element={<div className="card">페이지를 찾을 수 없습니다.</div>} />
          </Routes>
          </PageErrorBoundary>
        )}
      </main>

      <footer>
        비공식 팬 프로젝트입니다. 구단·선수 이름은 2025-26 시즌 기준이며 능력치·경기 결과는 게임용 임의 값으로, 실제 구단·리그와 관계없습니다.
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
