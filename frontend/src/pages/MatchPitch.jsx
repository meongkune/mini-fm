// 경기장 화면: 위치 계산은 engine/positions.js, 연속 재생은 engine/playback.js. 여기서는 Canvas에 매 프레임 그리기만 한다
import { useEffect, useRef, useState } from 'react'
import { ink, short } from '../store.jsx'
import { clockText } from '../engine/match.js'
import { H, W } from '../engine/positions.js'
import { makeSim, startClip, stepSim } from '../engine/playback.js'

// 상단 문구는 재생 대본의 구간마다 정해진다(engine/playback.js의 label) — 화면에서 지금 벌어지는 일과 같이 바뀐다

/**
 * 경기 좌표(x 0~105 홈 → 원정 방향, y 0~68) → 화면 좌표(0~1). 내 팀이 항상 아래 → 위(세로) 또는 왼쪽 → 오른쪽(가로)으로 공격한다
 */
function mapper(myIdx, land) {
  return (x, y) => {
    const up = myIdx === 0 ? (W - x) / W : x / W // 위쪽이 0
    const side = myIdx === 0 ? y / H : (H - y) / H
    return land ? [1 - up, side] : [side, up]
  }
}

function drawPitch(g, w, h, land) {
  // 잔디 줄무늬 (공격 방향으로 10줄)
  for (let i = 0; i < 10; i++) {
    g.fillStyle = i % 2 ? '#2a8a45' : '#257d3e'
    if (land) g.fillRect((i * w) / 10, 0, w / 10 + 1, h)
    else g.fillRect(0, (i * h) / 10, w, h / 10 + 1)
  }
  // 선: 경기장 좌표(105 x 68)로 그리고 화면에 맞춰 눕히거나 세운다
  const L = land ? w / W : h / W // 1m = 몇 px (길이 방향)
  const S = land ? h / H : w / H
  const pt = (x, y) => (land ? [x * L, y * S] : [y * S, (W - x) * L])
  const rect = (x, y, rw, rh) => { const [a, b] = pt(x, y); const [c, d] = pt(x + rw, y + rh); g.strokeRect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b)) }
  g.strokeStyle = 'rgba(255,255,255,.85)'
  g.lineWidth = Math.max(1, L * 0.35)
  rect(0.4, 0.4, W - 0.8, H - 0.8)
  g.beginPath(); g.moveTo(...pt(W / 2, 0.4)); g.lineTo(...pt(W / 2, H - 0.4)); g.stroke()
  g.beginPath(); g.arc(...pt(W / 2, H / 2), 9.15 * L, 0, Math.PI * 2); g.stroke()
  rect(0.4, H / 2 - 20.16, 16.5, 40.32); rect(W - 16.9, H / 2 - 20.16, 16.5, 40.32)
  rect(0.4, H / 2 - 9.16, 5.5, 18.32); rect(W - 5.9, H / 2 - 9.16, 5.5, 18.32)
  g.fillStyle = '#fff'
  g.beginPath(); g.arc(...pt(W / 2, H / 2), Math.max(1.5, L * 0.5), 0, Math.PI * 2); g.fill()
  // 골대
  g.fillStyle = 'rgba(255,255,255,.3)'
  g.strokeStyle = '#fff'
  for (const gx of [-1.8, W]) { const [a, b] = pt(gx, H / 2 - 3.66); const [c, d] = pt(gx + 1.8, H / 2 + 3.66); g.fillRect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b)); g.strokeRect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b)) }
}

/**
 * tactics: [홈 전술, 원정 전술] — 선수 위치가 철학·라인·압박·폭을 따라 달라진다
 * score: 크게 보기에서 보여 줄 점수 [홈, 원정] (화면에 이미 드러난 점수)
 * duration: 이 장면을 보여 줄 시간(ms) — 대본 길이를 여기에 맞춰 재생한다
 */
export default function MatchPitch({ home, away, lineups, tick, duration = 300, scorerName, idleLabel = '킥오프 대기', myIdx = 0, caption = null, tactics = null, score = null }) {
  const stageRef = useRef(null)
  const planeRef = useRef(null)
  const canvasRef = useRef(null)
  const simRef = useRef(null)
  const live = useRef({}) // 그리기 루프가 읽는 최신 값
  const [big, setBig] = useState(false)
  const [wide, setWide] = useState(false)
  const [hud, setHud] = useState({ label: '', shown: false }) // 상단 문구(지금 구간) · 결과가 드러났는가
  const land = big && wide
  if (!simRef.current) simRef.current = makeSim()
  live.current = { lineups, tactics, tick, duration, myIdx, land, teams: [home, away] }

  // 크게 보기: 전체 화면 API가 되면 그것으로, 안 되면 화면 고정. 가로가 더 길면 경기장을 눕힌다
  useEffect(() => {
    if (!big) return undefined
    const fit = () => setWide(window.innerWidth > window.innerHeight)
    const left = () => { if (!document.fullscreenElement) setBig(false) }
    const esc = (e) => { if (e.key === 'Escape') setBig(false) }
    fit()
    window.addEventListener('resize', fit)
    document.addEventListener('fullscreenchange', left)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('resize', fit); document.removeEventListener('fullscreenchange', left); window.removeEventListener('keydown', esc) }
  }, [big])
  const toggleBig = () => {
    if (big) { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); setBig(false); return }
    setBig(true)
    try { stageRef.current?.requestFullscreen?.()?.catch(() => {}) } catch { /* 전체 화면을 못 쓰는 환경: 화면 고정으로만 */ }
  }

  // 장면이 바뀌면 대본만 새로 건다 (선수·공 위치는 이어진다)
  useEffect(() => {
    if (!lineups) return
    startClip(simRef.current, lineups, tick, tactics)
    setHud({ label: simRef.current.label, shown: false })
  }, [tick, lineups && lineups.map((l) => l.map((p) => p.id).join()).join('|')])

  // 그리기 루프: 매 프레임 재생 상태를 진행하고 Canvas에 그린다
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let shownKey = ''
    const loop = (now) => {
      raf = requestAnimationFrame(loop)
      const L = live.current
      const sim = simRef.current
      const cv = canvasRef.current
      const plane = planeRef.current
      if (!cv || !plane || !L.lineups) { last = now; return }
      const real = Math.min(0.1, (now - last) / 1000) // 탭이 쉬다 돌아와도 한 번에 건너뛰지 않게
      last = now
      // 대본 시간으로 환산: 대본 전체가 duration 안에 끝나게
      const rate = sim.script ? (sim.script.dur * 1000) / Math.max(60, L.duration) : 1
      let left = real * rate
      while (left > 0) { const d = Math.min(0.05, left); stepSim(sim, L.lineups, L.tactics, d); left -= d } // 빠른 배속에서도 잘게 나눠 진행
      // 상단 문구: 구간이 바뀔 때만 갱신한다
      const shown = !!sim.script && sim.t >= sim.script.revealAt
      const key = `${sim.label}|${shown}`
      if (key !== shownKey) { shownKey = key; setHud({ label: sim.label, shown }) }

      // 크기 맞추기 (선명하게: 기기 픽셀 비율만큼 키운다)
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = plane.clientWidth
      const h = plane.clientHeight
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
      const g = cv.getContext('2d')
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawPitch(g, w, h, L.land)
      const map = mapper(L.myIdx, L.land)
      const unit = (L.land ? w / W : h / W) // 1m = px
      const R = clamp(unit * 1.45, 7, 15) // 선수 원 반지름
      // 선수 (아래쪽 선수가 위에 겹치게 y 순서로)
      const items = []
      L.lineups.forEach((side, si) => side.forEach((p) => { const q = sim.pos[p.id]; if (q) { const [mx, my] = map(q.x, q.y); items.push({ p, si, x: mx * w, y: my * h }) } }))
      items.sort((a, b) => a.y - b.y)
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      for (const it of items) {
        const team = L.teams[it.si]
        const gk = it.p.pos === 'GK' || it.p.slot === 'GK'
        const has = sim.carrier === it.p.id
        g.fillStyle = 'rgba(0,0,0,.3)'
        g.beginPath(); g.ellipse(it.x, it.y + R * 0.85, R * 0.8, R * 0.3, 0, 0, Math.PI * 2); g.fill()
        g.beginPath(); g.arc(it.x, it.y, R, 0, Math.PI * 2)
        g.fillStyle = team.color; g.fill()
        if (gk) { g.save(); g.clip(); g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = R * 0.35; for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(it.x + k * R * 0.7 - R, it.y + R); g.lineTo(it.x + k * R * 0.7 + R, it.y - R); g.stroke() } g.restore() }
        g.lineWidth = has ? 3 : 1.5
        g.strokeStyle = has ? '#fde047' : 'rgba(255,255,255,.92)'
        g.beginPath(); g.arc(it.x, it.y, R + (has ? 1.5 : 0), 0, Math.PI * 2); g.stroke()
        g.fillStyle = gk ? '#fff' : ink(team.color)
        g.font = `900 ${Math.round(R * 1.05)}px system-ui, sans-serif`
        g.fillText(String(it.p.number ?? ''), it.x, it.y + 0.5)
        if (has) {
          // 공 가진 선수 이름
          const name = String(it.p.name || '').split(' ').at(-1)
          g.font = `700 ${Math.round(R * 0.95)}px system-ui, sans-serif`
          g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(name, it.x, it.y - R - 8)
          g.fillStyle = '#fff'; g.fillText(name, it.x, it.y - R - 8)
        }
      }
      // 공: 높이만큼 그림자와 떨어지고 커진다
      const [bx, by] = map(sim.ball.x, sim.ball.y)
      const z = sim.ball.z || 0
      const br = clamp(unit * 0.55, 3.5, 6) * (1 + z * 0.05)
      g.fillStyle = 'rgba(0,0,0,.4)'
      g.beginPath(); g.ellipse(bx * w, by * h + 2, br * 0.9, br * 0.45, 0, 0, Math.PI * 2); g.fill()
      g.beginPath(); g.arc(bx * w, by * h - z * unit * 0.9, br, 0, Math.PI * 2)
      g.fillStyle = '#fff'; g.fill()
      g.lineWidth = 1; g.strokeStyle = '#333'; g.stroke()
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  if (!lineups) return <div className="pitch-stage empty">선발 명단을 불러오는 중…</div>
  const teams = [home, away]
  const goalFlash = tick?.k === 'goal' && hud.shown
  const attackLabel = tick ? `${clockText(tick.m, tick.plus)}' ${short(teams[tick.t])} · ${hud.label || '공격'}` : idleLabel
  const mine = teams[myIdx]
  const theirs = teams[1 - myIdx]

  return (
    <div ref={stageRef} className={`pitch-stage flat ${big ? 'big' : ''} ${land ? 'land' : ''}`}>
      <button type="button" className="pitch-big" onClick={toggleBig} title={big ? '원래 크기로 (Esc)' : '경기장 크게 보기'} aria-label={big ? '원래 크기로' : '경기장 크게 보기'}>{big ? '✕' : '⛶'}</button>
      {big && score && <div className="pitch-score"><b style={{ '--c': home.color }}>{short(home)}</b> {score[0]} : {score[1]} <b style={{ '--c': away.color }}>{short(away)}</b></div>}
      <div className="pitch-hud">
        <span className="hud-dot" style={{ background: tick ? teams[tick.t].color : '#94a3b8' }} />
        {attackLabel}
      </div>
      <div className="pitch-plane" ref={planeRef}>
        <canvas ref={canvasRef} className="pitch-canvas" />
      </div>
      <div className="pitch-legend">
        <span style={{ '--c': mine.color }}><i />{land ? '▶' : '▲'} {short(mine)} (내 팀)</span>
        <span style={{ '--c': theirs.color }}><i />{land ? '◀' : '▼'} {short(theirs)}</span>
      </div>

      {caption && !goalFlash && (
        <div key={`${caption.minute}-${caption.type}`} className={`pitch-caption ${caption.type}`} style={{ '--c': caption.color }}>
          <span>{caption.minute}'</span>{caption.text}
        </div>
      )}

      {goalFlash && (
        <div className="goal-flash" style={{ '--c': teams[tick.t].color }}>
          <strong>GOAL!</strong>
          <span>{scorerName} · {short(teams[tick.t])}</span>
        </div>
      )}
    </div>
  )
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
