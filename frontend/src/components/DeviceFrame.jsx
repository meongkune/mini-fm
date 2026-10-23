// 화면 모드: 넓은 PC 화면은 FM식 데스크톱 레이아웃, 폰·좁은 화면은 모바일 전체 화면.
// PC에서 '모바일 보기'를 고르면 휴대폰 목업 안에 띄운다 (선택은 브라우저에 기억).
import { useEffect, useState } from 'react'

// 화면 논리 크기(현행 6.1인치급 폰)와 베젤
const SCREEN_W = 390
const SCREEN_H = 844
const BEZEL = 13
const DEVICE_W = SCREEN_W + BEZEL * 2
const DEVICE_H = SCREEN_H + BEZEL * 2
const MARGIN = 40
const FRAME_QUERY = '(min-width: 768px) and (min-height: 600px)'
const DESK_QUERY = '(min-width: 1024px)'
const VIEW_KEY = 'mini-fm-view' // 'phone'이면 PC에서도 휴대폰 목업

const readView = () => { try { return localStorage.getItem(VIEW_KEY) } catch { return null } }
/** PC 화면 모드 바꾸기 ('desktop' | 'phone') */
export function setViewMode(mode) {
  try { localStorage.setItem(VIEW_KEY, mode) } catch { /* 저장 실패 무시 */ }
  window.dispatchEvent(new Event('mini-fm-view'))
}

function calcMode() {
  const phonePref = readView() === 'phone'
  if (window.matchMedia(DESK_QUERY).matches && !phonePref) return { mode: 'desktop', scale: 1 }
  if (window.matchMedia(FRAME_QUERY).matches && phonePref) {
    const scale = Math.min((window.innerHeight - MARGIN) / DEVICE_H, (window.innerWidth - MARGIN) / DEVICE_W, 1.6)
    return { mode: 'framed', scale }
  }
  return { mode: 'mobile', scale: 1 }
}

/** 지금 화면 모드: 'desktop' | 'framed' | 'mobile' */
export function useViewMode() {
  const [state, setState] = useState(calcMode)
  useEffect(() => {
    const on = () => setState(calcMode())
    window.addEventListener('resize', on)
    window.addEventListener('mini-fm-view', on)
    return () => { window.removeEventListener('resize', on); window.removeEventListener('mini-fm-view', on) }
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
  const { mode, scale } = useViewMode()
  useEffect(() => {
    document.documentElement.classList.toggle('framed', mode === 'framed')
    document.documentElement.classList.toggle('desktop', mode === 'desktop')
  }, [mode])

  if (mode !== 'framed') return children

  return (
    <div className="stage">
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
      <button className="view-toggle" onClick={() => setViewMode('desktop')}>🖥️ PC 화면으로</button>
    </div>
  )
}
