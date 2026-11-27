// 실시간 경기 시뮬레이션(engine/live.js) 시험 화면: /live-demo
//   아직 경기 화면에 연결하기 전, 선수 22명이 판단하며 움직이는 모습이 축구처럼 보이는지 눈으로 확인하는 용도.
import { useEffect, useRef, useState } from 'react'
import { LIVE, createLive, resolvePen, secondHalf, stepLive } from '../engine/live.js'
import { buildSlots } from '../engine/formation.js'
import { H, W } from '../engine/positions.js'

const rngOf = (seed) => { let a = seed | 0; return { random: () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } } }
const WANT = { GK: 'GK', LB: 'DF', CB: 'DF', RB: 'DF', LWB: 'DF', RWB: 'DF', DM: 'MF', CM: 'MF', AM: 'MF', LM: 'MF', RM: 'MF', LW: 'FW', RW: 'FW', ST: 'FW' }
const xiOf = (team, formation) => {
  const pool = [...team.players].sort((a, b) => Math.max(b.att, b.def) - Math.max(a.att, a.def))
  const used = new Set()
  return buildSlots(formation).map((s) => { const p = pool.find((x) => !used.has(x.id) && x.pos === WANT[s.role]) || pool.find((x) => !used.has(x.id)); used.add(p.id); return { ...p, sx: s.x, sy: s.y, slot: s.role } })
}
const EV = { half: '후반 시작', goal: '⚽ 골!', save: '🧤 선방', block: '수비가 막아냅니다', tackle: '태클로 뺏습니다', intercept: '패스를 끊습니다', foul: '반칙', offside: '오프사이드', cross: '크로스', clear: '걷어냅니다' }
const DEAD = { kickoff: '킥오프', goalkick: '골킥', corner: '코너킥', fk: '프리킥', fkx: '프리킥', throw: '스로인', pen: '페널티킥' }
const PHILS = [['possession', '점유'], ['balanced', '균형'], ['counter', '역습'], ['direct', '직선']]
const ink = (c) => { const n = parseInt(String(c).replace('#', ''), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#111' : '#fff' }

export default function LiveDemo() {
  const cvRef = useRef(null)
  const ref = useRef({ L: null, teams: null, speed: 1, paused: false, text: '', textAt: 0, seen: 0 })
  const [data, setData] = useState(null)
  const [cfg, setCfg] = useState({ home: 0, away: 3, seed: 1, ph: 'balanced', pa: 'balanced' })
  const [speed, setSpeed] = useState(1)
  const [paused, setPaused] = useState(false)
  const [hud, setHud] = useState({ score: [0, 0], min: 1, text: '', stats: null, done: false })

  useEffect(() => {
    (async () => {
      const index = await fetch('/data/index.json').then((r) => r.json())
      const lg = index.leagues.find((x) => x.id === 'premier-league') || index.leagues[0]
      setData(await fetch('/data/' + lg.seasons[0].file).then((r) => r.json()))
    })()
  }, [])

  useEffect(() => {
    if (!data) return
    const home = data.teams[cfg.home], away = data.teams[cfg.away]
    const lineups = [xiOf(home, '4-3-3'), xiOf(away, '4-4-2')]
    const tactics = [{ formation: '4-3-3', phil: cfg.ph }, { formation: '4-4-2', phil: cfg.pa }]
    Object.assign(ref.current, { L: createLive({ lineups, tactics, rng: rngOf(cfg.seed * 7919 + cfg.home * 31 + cfg.away) }), teams: [home, away], text: '', seen: 0 })
  }, [data, cfg])
  ref.current.speed = speed
  ref.current.paused = paused

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let acc = 0
    let hudKey = ''
    const loop = (now) => {
      raf = requestAnimationFrame(loop)
      const R = ref.current
      const L = R.L
      const cv = cvRef.current
      const real = Math.min(0.25, (now - last) / 1000)
      last = now
      if (!L || !cv) return
      const done = L.clock >= LIVE.playSeconds
      if (!R.paused && !done) {
        acc += real * R.speed
        let n = 0
        while (acc >= LIVE.dt && n++ < 400) {
          acc -= LIVE.dt
          if (L.dead && L.dead.type === 'pen' && L.dead.wait > 2.5) resolvePen(L)
          if (L.half === 1 && L.clock >= LIVE.playSeconds / 2) secondHalf(L)
          stepLive(L)
        }
        for (; R.seen < L.events.length; R.seen++) {
          const e = L.events[R.seen]
          const who = e.p && L.byId[e.p] ? L.byId[e.p].name.split(' ').at(-1) : ''
          if (e.type === 'shot') { R.text = `${who}의 슛!`; R.textAt = now }
          else if (e.type === 'restart') { if (e.kind !== 'kickoff' || !R.text.includes('골')) { R.text = DEAD[e.kind] || ''; R.textAt = now } }
          else if (EV[e.type]) { R.text = `${EV[e.type]}${who ? ' · ' + who : ''}`; R.textAt = now }
        }
      }
      const min = Math.min(90, Math.floor((L.clock / LIVE.playSeconds) * 90) + 1)
      const key = `${L.score.join('-')}|${min}|${R.text}|${done}`
      if (key !== hudKey) { hudKey = key; setHud({ score: [...L.score], min, text: R.text, stats: L.stats.map((s) => ({ ...s })), done }) }
      // ── 그리기 (세로 경기장: 홈이 위로 공격) ──
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = cv.clientWidth, h = cv.clientHeight
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
      const g = cv.getContext('2d')
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      const m = (x, y) => [(y / H) * w, (1 - x / W) * h]
      const u = h / W
      for (let i = 0; i < 10; i++) { g.fillStyle = i % 2 ? '#2f8a4b' : '#2a7d44'; g.fillRect(0, (i * h) / 10, w, h / 10 + 1) }
      g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2
      g.strokeRect(1, 1, w - 2, h - 2)
      g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke()
      g.beginPath(); g.arc(w / 2, h / 2, 9.15 * u, 0, Math.PI * 2); g.stroke()
      for (const top of [true, false]) { const bx = ((H / 2 - 20.16) / H) * w, bw = (40.32 / H) * w, bh = 16.5 * u; g.strokeRect(bx, top ? 0 : h - bh, bw, bh); const sx = ((H / 2 - 9.16) / H) * w, sw = (18.32 / H) * w, sh = 5.5 * u; g.strokeRect(sx, top ? 0 : h - sh, sw, sh) }
      const Rr = Math.max(7, Math.min(13, u * 1.45))
      const items = L.players.map((p) => { const [x, y] = m(p.x, p.y); return { p, x, y } }).sort((a, b) => a.y - b.y)
      g.textAlign = 'center'; g.textBaseline = 'middle'
      for (const it of items) {
        const team = R.teams[it.p.side]
        const has = L.ball.owner === it.p.id
        g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(it.x, it.y + Rr * 0.85, Rr * 0.8, Rr * 0.3, 0, 0, Math.PI * 2); g.fill()
        g.beginPath(); g.arc(it.x, it.y, Rr, 0, Math.PI * 2); g.fillStyle = it.p.gk ? '#111827' : team.color; g.fill()
        g.lineWidth = has ? 3 : 1.5; g.strokeStyle = has ? '#fde047' : 'rgba(255,255,255,.92)'; g.stroke()
        g.fillStyle = it.p.gk ? '#fff' : ink(team.color); g.font = `900 ${Math.round(Rr * 1.05)}px system-ui`
        g.fillText(String(it.p.number ?? ''), it.x, it.y + 0.5)
        if (has) { const nm = it.p.name.split(' ').at(-1); g.font = `700 ${Math.round(Rr * 0.95)}px system-ui`; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(nm, it.x, it.y - Rr - 8); g.fillStyle = '#fff'; g.fillText(nm, it.x, it.y - Rr - 8) }
      }
      const [bx, by] = m(L.ball.x, L.ball.y)
      const z = L.ball.z || 0
      const br = Math.max(3.5, u * 0.55) * (1 + z * 0.08)
      g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.ellipse(bx, by + 2, br * 0.9, br * 0.45, 0, 0, Math.PI * 2); g.fill()
      g.beginPath(); g.arc(bx, by - z * u * 0.9, br, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1; g.strokeStyle = '#333'; g.stroke()
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  if (!data) return <div className="card">불러오는 중…</div>
  const teams = [data.teams[cfg.home], data.teams[cfg.away]]
  const st = hud.stats
  const poss = st ? Math.round((st[0].possT / Math.max(1, st[0].possT + st[1].possT)) * 100) : 50
  const pick = (k) => (e) => setCfg({ ...cfg, [k]: isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) })
  return (
    <div className="card" style={{ padding: 12 }}>
      <h3 style={{ margin: '0 0 6px' }}>실시간 시뮬레이션 시험</h3>
      <p style={{ margin: '0 0 8px', fontSize: '.78rem', color: 'var(--muted)' }}>선수 22명이 매 순간 판단하며 움직이고, 슛과 골이 그 움직임에서 나옵니다. 아직 경기 화면과 기록에는 연결되지 않았습니다.</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8, fontSize: '.8rem' }}>
        <select value={cfg.home} onChange={pick('home')}>{data.teams.map((t, i) => <option key={t.id} value={i}>{t.name}</option>)}</select>
        <select value={cfg.ph} onChange={pick('ph')}>{PHILS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
        <span>vs</span>
        <select value={cfg.away} onChange={pick('away')}>{data.teams.map((t, i) => <option key={t.id} value={i}>{t.name}</option>)}</select>
        <select value={cfg.pa} onChange={pick('pa')}>{PHILS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
        <button className="btn ghost small" onClick={() => setCfg({ ...cfg, seed: cfg.seed + 1 })}>다시 시작</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontWeight: 800 }}>
        <span style={{ color: teams[0].color }}>▲ {teams[0].name}</span>
        <span style={{ fontSize: '1.2rem' }}>{hud.score[0]} : {hud.score[1]}</span>
        <span style={{ color: teams[1].color }}>▼ {teams[1].name}</span>
        <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{hud.done ? '경기 종료' : `${hud.min}'`}</span>
      </div>
      <div style={{ minHeight: 20, fontSize: '.85rem', marginBottom: 6 }}>{hud.text}</div>
      <canvas ref={cvRef} style={{ display: 'block', width: '100%', aspectRatio: `${H} / ${W}`, borderRadius: 10 }} />
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="btn ghost small" onClick={() => setPaused(!paused)}>{paused ? '▶ 계속' : '⏸ 멈춤'}</button>
        {[1, 2, 4, 8].map((s) => <button key={s} className={`btn small ${speed === s ? 'primary' : 'ghost'}`} onClick={() => setSpeed(s)}>{s}x</button>)}
      </div>
      {st && <p style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 8 }}>점유율 {poss}% : {100 - poss}% · 슛 {st[0].shots} : {st[1].shots} · 유효 {st[0].on} : {st[1].on} · 패스 {st[0].passes} : {st[1].passes} · 코너 {st[0].corners} : {st[1].corners} · 파울 {st[0].fouls} : {st[1].fouls}</p>}
    </div>
  )
}
