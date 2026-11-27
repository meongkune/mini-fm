// 페널티킥 직접 조작: 공 뒤에서 골문을 보는 원근 화면(Canvas). 내 팀이 차면 조준 + 세기, 상대가 차면 몸을 날릴 곳을 고른다.
//   결과('goal' · 'save' · 'miss')는 onDone으로 돌려주고, 경기 엔진이 그 결과를 그대로 쓴다 (engine/match.js penalty의 penAnswers).
//   난수는 경기 seed에서 만든다(Math.random을 쓰지 않는다) — 같은 경기에서 같은 조작을 하면 같은 결과.
//   키커의 페널티 능력(pen)은 조준 흔들림에, 골키퍼의 선방(gk)은 방향을 읽을 확률과 팔이 닿는 범위에 반영된다.
import { useEffect, useRef, useState } from 'react'

const GOAL_W = 7.32
const GOAL_H = 2.44
const SPOT = 11 // 골라인까지 거리(m)
const CAM = { y: 1.5, back: 7 } // 카메라: 공 뒤 7m, 높이 1.5m
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const lerp = (a, b, t) => a + (b - a) * t
function rngOf(seed) {
  let a = seed | 0
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const hashStr = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }

/** 판정: 공이 골문 면에 닿는 자리(x 좌우 m, y 높이 m)와 골키퍼가 몸을 날린 자리 → 결과 */
export function judgePenalty({ x, y, speed, dive, reach }) {
  const inFrame = Math.abs(x) < GOAL_W / 2 - 0.12 && y > 0 && y < GOAL_H - 0.12
  if (!inFrame) return 'miss'
  const r = reach * (speed < 20 ? 1.25 : speed > 27 ? 0.88 : 1) // 느린 공은 더 잘 막힌다
  const d = Math.hypot((x - dive.x) / 1.15, y - dive.y) // 옆으로는 팔이 조금 더 닿는다
  return d < r ? 'save' : 'goal'
}

export default function PenaltyGame({ info, seed, colors, onDone }) {
  const cvRef = useRef(null)
  const st = useRef(null)
  const [phase, setPhase] = useState('aim') // aim → fly → done
  const [result, setResult] = useState(null)
  const mine = info.mine
  if (!st.current) {
    const rnd = rngOf(hashStr(`${seed}-${info.key}`))
    st.current = {
      rnd, t0: performance.now(), aim: { x: 0, y: 1.1 }, dive: null, power: 0, shot: null, flyAt: 0, done: false,
      sway: clamp((100 - info.pen) / 100, 0.08, 0.5) * 1.5, // 조준 흔들림(m): 페널티 능력이 낮을수록 크다
      reach: clamp(1.05 + (info.gk - 70) / 90, 0.8, 1.45), // 골키퍼 팔이 닿는 범위(m)
      // 상대가 찰 때: 키커가 노리는 곳을 미리 정한다 (능력이 좋을수록 구석)
      ai: (() => { const r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd(); const corner = clamp(2.0 + (info.pen - 70) / 40, 1.6, 3.1); return { x: r1 < 0.12 ? (r2 - 0.5) * 1.2 : (r2 < 0.5 ? -1 : 1) * (corner + (r3 - 0.5) * 1.1), y: 0.35 + r4 * 1.75, wild: rnd() < clamp(0.1 - (info.pen - 70) / 400, 0.03, 0.14), wx: (rnd() - 0.5) * 2, speed: 22 + rnd() * 6 } })(),
      kickAt: mine ? 0 : 2.6, // 상대가 차는 시각(초)
    }
  }

  const finish = (res) => {
    const s = st.current
    if (s.done) return
    s.done = true
    setResult(res)
    setPhase('done')
    setTimeout(() => onDone(res), 1500)
  }

  // 슛 (내가 찰 때): 지금 조준점(흔들림 포함)과 세기로 찬다
  const shoot = () => {
    const s = st.current
    if (phase !== 'aim' || !mine) return
    const now = (performance.now() - s.t0) / 1000
    const p = s.power
    const aim = aimNow(s, now)
    const over = Math.max(0, p - 0.86) // 너무 세게 차면 뜬다
    const tx = aim.x + (s.rnd() - 0.5) * s.sway * 0.5
    const ty = aim.y + over * 9 + (s.rnd() - 0.5) * s.sway * 0.4
    const speed = 15 + p * 15
    // 골키퍼: 방향을 읽으면 공 쪽으로, 못 읽으면 다른 쪽으로 몸을 날린다
    const read = s.rnd() < clamp(0.4 + (info.gk - 70) / 220 + (speed < 20 ? 0.18 : 0), 0.25, 0.75)
    const side = Math.abs(tx) < 0.9 ? 0 : Math.sign(tx)
    const pick = read ? side : [-1, 0, 1].filter((v) => v !== side)[Math.floor(s.rnd() * 2)]
    s.dive = { x: pick * 2.25, y: pick === 0 ? 1.15 : clamp(read ? ty * 0.7 + 0.3 : 0.9, 0.5, 1.7) }
    s.shot = { x: tx, y: ty, speed }
    s.flyAt = now
    setPhase('fly')
  }
  const aimNow = (s, now) => ({ x: s.aim.x + Math.sin(now * 2.7) * s.sway + Math.sin(now * 5.3 + 1) * s.sway * 0.35, y: clamp(s.aim.y + Math.cos(now * 3.4) * s.sway * 0.6, 0.05, 3.4) })

  useEffect(() => {
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const cv = cvRef.current
      const s = st.current
      if (!cv) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const W = cv.clientWidth
      const H = cv.clientHeight
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr) }
      const g = cv.getContext('2d')
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      const now = (performance.now() - s.t0) / 1000
      const F = W * 1.95
      const HZ = H * 0.34
      const pr = (X, Y, Z) => { const d = Z + CAM.back; return [W / 2 + (X * F) / d, HZ - ((Y - CAM.y) * F) / d, F / d] }
      s.unproj = (px, py) => { const d = SPOT + CAM.back; return { x: clamp(((px - W / 2) * d) / F, -5, 5), y: clamp(CAM.y - ((py - HZ) * d) / F, 0.05, 3.4) } }
      if (mine && !s.shot) s.power = 0.5 + 0.5 * Math.sin(now * 4.2) // 세기 막대가 오르내린다
      // 상대가 차는 순간
      if (!mine && !s.shot && now >= s.kickAt) {
        const a = s.ai
        s.shot = a.wild ? { x: a.wx > 0 ? 4.3 : -4.3, y: 1.2 + Math.abs(a.wx) * 1.6, speed: a.speed } : { x: a.x, y: a.y, speed: a.speed }
        if (!s.dive) s.dive = { x: 0, y: 1.1 }
        s.flyAt = now
        setPhase('fly')
      }
      // 공 위치
      let ball = { x: 0, y: 0.11, z: 0 }
      let k = 0
      if (s.shot) {
        const T = SPOT / s.shot.speed
        k = clamp((now - s.flyAt) / T, 0, 1.25)
        ball = { x: s.shot.x * k, y: 0.11 + (s.shot.y - 0.11) * k + Math.sin(Math.PI * Math.min(1, k)) * 0.25, z: SPOT * k }
        if (k >= 1 && !s.res) { s.res = judgePenalty({ ...s.shot, dive: s.dive, reach: s.reach }); finish(s.res) }
        if (s.res === 'save' && k > 1) ball = { x: s.shot.x + (s.shot.x - s.dive.x) * (k - 1) * 4, y: Math.max(0.11, s.shot.y - (k - 1) * 3), z: SPOT - (k - 1) * 10 }
        if (s.res === 'goal' && k > 1) ball = { x: s.shot.x, y: Math.max(0.11, s.shot.y - (k - 1) * 4), z: SPOT + Math.min(1.6, (k - 1) * 8) }
      }
      // ── 배경: 하늘·관중석·잔디 ──
      const sky = g.createLinearGradient(0, 0, 0, HZ)
      sky.addColorStop(0, '#0b1226'); sky.addColorStop(1, '#22314f')
      g.fillStyle = sky; g.fillRect(0, 0, W, HZ)
      const [, standTop] = pr(0, 9, SPOT + 9)
      const [, standBot] = pr(0, 0, SPOT + 9)
      g.fillStyle = '#1b2440'; g.fillRect(0, standTop, W, standBot - standTop)
      for (let i = 0; i < 90; i++) { const hx = (hashStr('c' + i) % 1000) / 1000, hy = (hashStr('d' + i) % 1000) / 1000; g.fillStyle = i % 3 === 0 ? colors[0] : i % 3 === 1 ? colors[1] : '#8b93a8'; g.globalAlpha = 0.55; g.fillRect(hx * W, standTop + 4 + hy * (standBot - standTop - 10), 3, 3) }
      g.globalAlpha = 1
      for (let i = 0; i < 9; i++) { // 잔디 줄무늬 (멀수록 좁다)
        const z0 = -6 + i * 4, z1 = z0 + 4
        const [, y0] = pr(0, 0, Math.max(-6.5, z0)); const [, y1] = pr(0, 0, z1)
        g.fillStyle = i % 2 ? '#2f8a4b' : '#2a7d44'; g.fillRect(0, y1, W, y0 - y1 + 1)
      }
      const line = (a, b, w = 2, c = 'rgba(255,255,255,.85)') => { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke() }
      line(pr(-30, 0, SPOT), pr(30, 0, SPOT), 2) // 골라인
      line(pr(-9.16, 0, SPOT), pr(-9.16, 0, SPOT - 5.5), 2); line(pr(9.16, 0, SPOT), pr(9.16, 0, SPOT - 5.5), 2); line(pr(-9.16, 0, SPOT - 5.5), pr(9.16, 0, SPOT - 5.5), 2) // 골 에어리어
      // ── 골대와 그물 ──
      const hw = GOAL_W / 2
      const net = 'rgba(255,255,255,.22)'
      for (let i = 0; i <= 12; i++) { const x = -hw + (GOAL_W * i) / 12; line(pr(x, GOAL_H, SPOT), pr(x, GOAL_H * 0.25, SPOT + 2), 1, net); line(pr(x, GOAL_H * 0.25, SPOT + 2), pr(x, 0, SPOT + 2), 1, net) }
      for (let i = 0; i <= 5; i++) { const y = (GOAL_H * i) / 5; line(pr(-hw, y, SPOT + (1 - i / 5) * 0.0), pr(-hw, y * 0.25, SPOT + 2), 1, net); line(pr(hw, y, SPOT), pr(hw, y * 0.25, SPOT + 2), 1, net); line(pr(-hw, y, SPOT + 1), pr(hw, y, SPOT + 1), 1, net) }
      const post = (a, b) => line(a, b, Math.max(3, pr(0, 0, SPOT)[2] * 0.12), '#f4f6fb')
      post(pr(-hw, 0, SPOT), pr(-hw, GOAL_H, SPOT)); post(pr(hw, 0, SPOT), pr(hw, GOAL_H, SPOT)); post(pr(-hw, GOAL_H, SPOT), pr(hw, GOAL_H, SPOT))
      // ── 골키퍼 ──
      const dv = s.dive
      const dk = s.shot ? clamp(k * 1.25, 0, 1) : 0
      const gx = dv && s.shot ? lerp(0, dv.x, dk) : Math.sin(now * 2.2) * 0.35
      const gyTop = dv && s.shot ? lerp(1.85, Math.max(0.5, dv.y + 0.3), dk) : 1.85
      const lean = dv && s.shot ? (dv.x / 2.25) * dk * 1.1 : 0
      const [kx, kyFeet, ks] = pr(gx - Math.sin(lean) * 0.6, dv && s.shot ? lerp(0, Math.max(0, dv.y - 0.7), dk) : 0, SPOT - 0.3)
      g.save(); g.translate(kx, kyFeet); g.rotate(lean)
      g.fillStyle = colors[mine ? 1 : 0] === '#f4f6fb' ? '#f59e0b' : '#f59e0b' // 골키퍼는 눈에 띄는 색
      g.fillRect(-0.28 * ks, -gyTop * ks * 0.92, 0.56 * ks, gyTop * ks * 0.5) // 몸
      g.fillStyle = '#1f2937'; g.fillRect(-0.24 * ks, -gyTop * ks * 0.44, 0.2 * ks, gyTop * ks * 0.44); g.fillRect(0.04 * ks, -gyTop * ks * 0.44, 0.2 * ks, gyTop * ks * 0.44) // 다리
      g.fillStyle = '#f1c9a5'; g.beginPath(); g.arc(0, -gyTop * ks, 0.13 * ks, 0, Math.PI * 2); g.fill() // 머리
      g.strokeStyle = '#f59e0b'; g.lineWidth = 0.11 * ks; g.lineCap = 'round'
      const up = s.shot ? dk : 0.25 + Math.sin(now * 3) * 0.05
      g.beginPath(); g.moveTo(-0.26 * ks, -gyTop * ks * 0.86); g.lineTo(-(0.5 + up * 0.25) * ks, -gyTop * ks * (0.7 + up * 0.5)); g.stroke()
      g.beginPath(); g.moveTo(0.26 * ks, -gyTop * ks * 0.86); g.lineTo((0.5 + up * 0.25) * ks, -gyTop * ks * (0.7 + up * 0.5)); g.stroke()
      g.restore()
      // ── 조준 표시 / 몸 날릴 곳 ──
      if (mine && !s.shot) {
        const a = aimNow(s, now)
        const [ax, ay, as] = pr(a.x, a.y, SPOT)
        g.strokeStyle = '#fde047'; g.lineWidth = 2
        g.beginPath(); g.arc(ax, ay, 0.28 * as, 0, Math.PI * 2); g.stroke()
        g.beginPath(); g.moveTo(ax - 0.45 * as, ay); g.lineTo(ax + 0.45 * as, ay); g.moveTo(ax, ay - 0.45 * as); g.lineTo(ax, ay + 0.45 * as); g.stroke()
      }
      if (!mine && s.dive && !s.shot) {
        const [ax, ay, as] = pr(s.dive.x, s.dive.y, SPOT)
        g.strokeStyle = '#38bdf8'; g.lineWidth = 3; g.setLineDash([6, 4])
        g.beginPath(); g.arc(ax, ay, s.reach * as, 0, Math.PI * 2); g.stroke(); g.setLineDash([])
      }
      // ── 키커(상대가 찰 때는 달려오는 모습) · 페널티 마크 ──
      const [sx, sy, ss] = pr(0, 0, 0)
      g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.ellipse(sx, sy, 0.16 * ss, 0.06 * ss, 0, 0, Math.PI * 2); g.fill()
      if (!mine && !s.shot) {
        const run = clamp(now / s.kickAt, 0, 1)
        const [rx, ry, rs] = pr(-2.3 + run * 1.7, 0, -3.2 + run * 2.9) // 옆에서 비스듬히 달려온다 (골문을 가리지 않게)
        g.fillStyle = colors[info.atk] || '#e11d48'
        g.fillRect(rx - 0.25 * rs, ry - 1.5 * rs, 0.5 * rs, 0.8 * rs)
        g.fillStyle = '#1f2937'; g.fillRect(rx - 0.22 * rs, ry - 0.72 * rs, 0.18 * rs, 0.72 * rs); g.fillRect(rx + 0.04 * rs, ry - 0.72 * rs, 0.18 * rs, 0.72 * rs)
        g.fillStyle = '#f1c9a5'; g.beginPath(); g.arc(rx, ry - 1.68 * rs, 0.13 * rs, 0, Math.PI * 2); g.fill()
      }
      // ── 공 (그림자와 함께, 멀어질수록 작아진다) ──
      const [bx, by, bs] = pr(ball.x, ball.y, ball.z)
      const [shx, shy] = pr(ball.x, 0, ball.z)
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(shx, shy, 0.13 * bs, 0.05 * bs, 0, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#fff'; g.strokeStyle = '#111'; g.lineWidth = 1.2
      g.beginPath(); g.arc(bx, by, Math.max(2.5, 0.11 * bs), 0, Math.PI * 2); g.fill(); g.stroke()
      // ── 세기 막대 ──
      if (mine) {
        const bw = W * 0.56, bx0 = (W - bw) / 2, by0 = 12 // 공을 가리지 않게 위쪽에
        g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(bx0, by0, bw, 10)
        g.fillStyle = '#22c55e'; g.fillRect(bx0 + bw * 0.6, by0, bw * 0.26, 10) // 알맞은 세기
        g.fillStyle = '#ef4444'; g.fillRect(bx0 + bw * 0.86, by0, bw * 0.14, 10) // 너무 세다(뜬다)
        g.fillStyle = '#fff'; g.fillRect(bx0 + bw * clamp(s.power, 0, 1) - 2, by0 - 3, 4, 16)
      } else if (!s.shot) {
        g.fillStyle = '#fff'; g.font = '700 15px system-ui'; g.textAlign = 'center'
        g.fillText(`${Math.max(0, s.kickAt - now).toFixed(1)}초 뒤 킥`, W / 2, 22)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const point = (e) => {
    const s = st.current
    if (phase !== 'aim' || !s.unproj) return
    const r = cvRef.current.getBoundingClientRect()
    const q = s.unproj(e.clientX - r.left, e.clientY - r.top)
    if (mine) s.aim = q
    else s.dive = { x: clamp(q.x, -3.2, 3.2), y: clamp(q.y, 0.4, 2.1) }
  }

  const banner = result === 'goal' ? (mine ? '⚽ 골!' : '⚽ 실점…') : result === 'save' ? (mine ? '🧤 막혔습니다' : '🧤 막았습니다!') : result === 'miss' ? (mine ? '😱 골대를 벗어났습니다' : '😮 골대를 벗어납니다!') : null
  return (
    <div className="sheet-wrap pen-wrap">
      <div className="pen-box">
        <div className="pen-head">
          <b>⚠️ 페널티킥</b>
          <span>{mine ? `키커 ${info.takerName}` : `${info.takerName}의 킥을 막으세요`}</span>
        </div>
        <div className="pen-stage">
          <canvas ref={cvRef} className="pen-canvas" onPointerDown={point} onPointerMove={(e) => { if (e.buttons || e.pointerType === 'mouse') point(e) }} />
          {banner && <div className={`pen-banner ${result}`}>{banner}</div>}
        </div>
        {mine
          ? <><p className="pen-tip">골문에서 노릴 곳을 누르고(조준점은 흔들립니다), 세기 막대가 <b>초록</b>에 올 때 슛을 누르세요. 빨강이면 공이 뜹니다.</p>
            <button type="button" className="btn primary pen-shoot" disabled={phase !== 'aim'} onClick={shoot}>⚽ 슛</button></>
          : <p className="pen-tip">킥 전에 <b>몸을 날릴 곳</b>을 골문에서 누르세요. 점선 원이 팔이 닿는 범위입니다. 고르지 않으면 가운데에 섭니다.</p>}
      </div>
    </div>
  )
}
