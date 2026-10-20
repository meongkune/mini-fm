// PC에서는 앱을 휴대폰 목업 안에 띄우고 화면 높이에 맞춰 키운다. 실제 폰·좁은 화면에서는 프레임 없이 전체 화면.
import { useEffect, useState } from 'react'

// 화면 논리 크기(현행 6.1인치급 폰)와 베젤
const SCREEN_W = 390
const SCREEN_H = 844
const BEZEL = 13
const DEVICE_W = SCREEN_W + BEZEL * 2
const DEVICE_H = SCREEN_H + BEZEL * 2
const MARGIN = 40
const FRAME_QUERY = '(min-width: 768px) and (min-height: 600px)'

function useFrame() {
  const calc = () => {
    if (!window.matchMedia(FRAME_QUERY).matches) return { framed: false, scale: 1 }
    const scale = Math.min((window.innerHeight - MARGIN) / DEVICE_H, (window.innerWidth - MARGIN) / DEVICE_W, 1.6)
    return { framed: true, scale }
  }
  const [state, setState] = useState(calc)
  useEffect(() => {
    const onResize = () => setState(calc())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return state
}

function useClock() {
  const fmt = () => new Date().toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: false })
  const [time, setTime] = useState(fmt)
  useEffect(() => {
    const id = setInterval(() => setTime(fmt()), 15000)
    return () => clearInterval(id)
  }, [])
  return time
}

function StatusBar() {
  const time = useClock()
  return (
    <div className="statusbar" aria-hidden="true">
      <span className="sb-time">{time}</span>
      <span className="sb-icons">
        <svg viewBox="0 0 18 12" width="18" height="12"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5.5" width="3" height="6.5" rx="1" /><rect x="10" y="3" width="3" height="9" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
        <svg viewBox="0 0 16 12" width="16" height="12"><path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0z" /><path d="M8 3.2c2.3 0 4.4.9 6 2.4l-1.4 1.5A6.6 6.6 0 0 0 8 5.3a6.6 6.6 0 0 0-4.6 1.8L2 5.6a8.6 8.6 0 0 1 6-2.4z" /><path d="M8 0c3.3 0 6.3 1.3 8 3.3l-1.3 1.4A9.6 9.6 0 0 0 8 2 9.6 9.6 0 0 0 1.3 4.7L0 3.3C1.7 1.3 4.7 0 8 0z" opacity=".9" /></svg>
        <span className="sb-battery"><i /></span>
      </span>
    </div>
  )
}

export default function DeviceFrame({ children }) {
  const { framed, scale } = useFrame()
  useEffect(() => {
    document.documentElement.classList.toggle('framed', framed)
  }, [framed])

  if (!framed) return children

  return (
    <div className="stage">
      <aside className="stage-intro">
        <span className="stage-logo">⚽</span>
        <h1>Mini FM</h1>
        <p>프리미어리그 20개 구단 중 하나를 맡아<br />전술을 짜고 38라운드 시즌을 치르는<br />모바일 축구 감독 시뮬레이션</p>
        <ul>
          <li>📋 포메이션 · 경기 운영 · 압박 강도</li>
          <li>🏟️ 3D 중계 시점 경기장과 문자 중계</li>
          <li>🏆 실제 시즌 선수단 · 순위 구간</li>
        </ul>
        <p className="stage-hint">휴대폰으로 열면 이 화면 그대로 전체 화면 앱처럼 동작합니다.</p>
      </aside>
      <div className="device-slot" style={{ width: DEVICE_W * scale, height: DEVICE_H * scale }}>
        <div className="device" style={{ width: DEVICE_W, height: DEVICE_H, transform: `scale(${scale})` }}>
          <span className="device-btn power" />
          <span className="device-btn vol-up" />
          <span className="device-btn vol-down" />
          <div className="screen" style={{ width: SCREEN_W, height: SCREEN_H }}>
            <StatusBar />
            <span className="island" />
            {children}
            <span className="home-indicator" />
          </div>
        </div>
      </div>
    </div>
  )
}
