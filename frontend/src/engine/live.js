// 실시간 경기 시뮬레이션: 선수 22명이 매 순간 판단하고(패스·드리블·슛·압박·침투) 움직이며, 슛과 골은 그 움직임에서 나온다.
//   지금까지의 방식(엔진이 분마다 결과를 먼저 정하고 화면이 그것을 그림으로 지어낸다)과 순서가 반대다 — 화면에 보이는 것이 곧 결과다.
//   순수 함수·결정적: 난수는 넘겨받은 rng만 쓴다. 화면 없이 돌려도 같은 결과가 나온다(건너뛰기 = 같은 계산).
//   단위: 미터·초. 홈(0)은 x 증가 방향으로, 원정(1)은 x 감소 방향으로 공격한다.
import { H, W, computeFrame, setPieceFrame } from './positions.js'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const lerp = (a, b, t) => a + (b - a) * t
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const hashId = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
const isGk = (p) => p.pos === 'GK' || p.slot === 'GK'
const GOAL_HALF = 3.66
const BOX_X = 16.5
const BOX_HALF = 20.16

/** 조정 손잡이 */
export const LIVE = {
  dt: 0.1,
  playSeconds: 600, // 한 경기의 실제 플레이 시간(초) — 이것이 90분으로 환산된다
  thinkMin: 0.35, thinkMax: 0.95, // 공 가진 선수가 다음 판단까지 걸리는 시간
  tackleEvery: 0.55, tackleBase: 0.2, foulBase: 0.085,
  passSpeed: 17, loftSpeed: 21, shotSpeed: 27,
  xg: [[7, 0.3], [11, 0.15], [15, 0.085], [19, 0.05], [24, 0.028], [30, 0.014]], // 거리별 기본 득점 확률
  shootBias: 1.0, // 슛을 고르는 정도
  riskW: { possession: 1.7, balanced: 1.25, counter: 1.05, direct: 0.95 },
  gainW: { possession: 0.75, balanced: 1.0, counter: 1.25, direct: 1.3 },
}

/** 경기 상태 만들기. lineups: [[선수…],[선수…]] (id·pos·slot·sx·sy·att·def·sta), tactics: [홈, 원정], rng: { random() } */
export function createLive({ lineups, tactics, rng }) {
  const players = []
  lineups.forEach((xi, side) => xi.forEach((p) => {
    const h = (k) => (hashId(p.id + k) % 1000) / 1000
    const pos = isGk(p) ? 'GK' : p.pos
    const att = p.att ?? 65
    const def = p.def ?? 65
    const sta = p.sta ?? 70
    players.push({
      id: p.id, side, pos, slot: p.slot, name: p.name, number: p.number, gk: pos === 'GK',
      x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, sprint: false,
      pace: 6.3 + (sta - 70) / 45 + (pos === 'FW' ? 0.35 : pos === 'MF' ? 0.15 : 0) + (h('p') - 0.5) * 0.7,
      tech: pos === 'DF' ? att * 0.8 + 8 : att, pass: pos === 'MF' ? att * 0.55 + def * 0.35 + 9 : att * 0.6 + def * 0.3 + 5,
      tackle: def, finish: pos === 'FW' ? att + 3 : pos === 'MF' ? att - 2 : att - 10, keep: def, aggr: 0.8 + h('a') * 0.5,
      think: 0, stun: 0, noTouch: 0, runT: h('r') * 3, run: false,
    })
  }))
  const L = {
    t: 0, clock: 0, lineups, tactics, rng, players, byId: Object.fromEntries(players.map((p) => [p.id, p])),
    ball: { x: W / 2, y: H / 2, z: 0, vx: 0, vy: 0, vz: 0, owner: null, to: null, from: null, loft: false },
    poss: 0, anchors: {}, anchorAt: -1, dead: null, shot: null, tackleT: 0, score: [0, 0], events: [],
    stats: [0, 1].map(() => ({ shots: 0, on: 0, goals: 0, passes: 0, passOk: 0, fouls: 0, corners: 0, offsides: 0, tackles: 0, possT: 0, xg: 0 })),
    half: 1,
  }
  const idle = computeFrame(lineups, null, 0, false, tactics).pos
  for (const p of players) { p.x = idle[p.id].x; p.y = idle[p.id].y; p.tx = p.x; p.ty = p.y }
  restart(L, 'kickoff', 0, { x: W / 2, y: H / 2 })
  return L
}

const dirOf = (side) => (side === 0 ? 1 : -1)
const goalX = (side) => (side === 0 ? W : 0) // 그 팀이 공격하는 골문
const uOf = (side, x) => (side === 0 ? x : W - x) // 자기 골문에서의 거리
const team = (L, side) => L.players.filter((p) => p.side === side)
const field = (L, side) => L.players.filter((p) => p.side === side && !p.gk)
const inBox = (side, x, y) => Math.abs(x - goalX(side)) < BOX_X && Math.abs(y - H / 2) < BOX_HALF // side가 공격하는 박스 안인가

/** 멈춘 공으로 다시 시작: 킥오프·골킥·코너킥·프리킥·스로인·페널티킥 */
function restart(L, type, side, spot, extra = {}) {
  const b = L.ball
  Object.assign(b, { x: spot.x, y: spot.y, z: 0, vx: 0, vy: 0, vz: 0, owner: null, to: null, from: null, loft: false })
  L.shot = null
  L.poss = side
  let taker
  if (type === 'goalkick') taker = L.players.find((p) => p.side === side && p.gk)
  else if (type === 'kickoff') taker = field(L, side).sort((p, q) => uOf(side, q.x) - uOf(side, p.x) || (p.id < q.id ? -1 : 1))[0]
  else taker = field(L, side).sort((p, q) => dist(p, spot) - dist(q, spot))[0]
  L.dead = { type, side, spot: { ...spot }, taker: taker?.id ?? null, wait: 0, ...extra }
  L.events.push({ t: L.t, type: 'restart', kind: type, side })
}

/** 팀 대형의 기준 자리(공 위치·소유 팀에 따라). 0.3초마다 다시 계산한다 */
function anchors(L) {
  if (L.t - L.anchorAt < 0.3 && L.anchorAt >= 0) return L.anchors
  const b = L.ball
  const d = L.dead
  let pos
  if (d && d.type === 'kickoff') pos = computeFrame(L.lineups, null, 0, false, L.tactics).pos
  else if (d && d.type === 'corner') pos = setPieceFrame(L.lineups, { t: d.side, m: Math.floor(L.clock / 7), i: 0, sp: 'corner', side: d.spot.y > H / 2 ? 1 : -1, kt: d.taker, p: d.taker, k: 'clear' }, 0, false).pos
  else {
    const side = L.poss
    const u = uOf(side, b.x)
    const holder = b.owner || nearest(L, side, b)?.id
    pos = computeFrame(L.lineups, { t: side, m: Math.floor(L.clock / 7), i: 0, k: 'build', ev: 'build' }, 0, false, L.tactics, { x: clamp(b.x, 2, W - 2), y: clamp(b.y, 2, H - 2), prog: clamp((u - 28) / 55, 0, 1), holder }).pos
  }
  L.anchors = pos
  L.anchorAt = L.t
  return pos
}
function nearest(L, side, pt, skip = null) {
  let best = null
  let bd = 1e9
  for (const p of L.players) { if (p.side !== side || p.id === skip) continue; const d = dist(p, pt); if (d < bd) { bd = d; best = p } }
  return best
}
const nearOppDist = (L, p, pt = p) => { let bd = 99; for (const o of L.players) if (o.side !== p.side && !o.gk) { const d = dist(o, pt); if (d < bd) bd = d } return bd }
/** 상대의 맨 뒤에서 두 번째 선수 위치(오프사이드 선) — side가 공격할 때 */
function offsideLine(L, side) {
  const xs = L.players.filter((p) => p.side !== side).map((p) => uOf(side, p.x)).sort((a, b) => b - a)
  return Math.max(W / 2, xs[1] ?? W / 2, uOf(side, L.ball.x))
}
const laneDist = (o, a, b) => { const vx = b.x - a.x, vy = b.y - a.y; const k = clamp(((o.x - a.x) * vx + (o.y - a.y) * vy) / Math.max(1e-6, vx * vx + vy * vy), 0, 1); return { d: Math.hypot(o.x - a.x - vx * k, o.y - a.y - vy * k), k } }

/** 그 자리에서 슛했을 때의 득점 확률(xG): 거리·각도·막아선 수비·압박·결정력·골키퍼 */
function xgOf(L, p, pt = p) {
  const g = { x: goalX(p.side), y: H / 2 }
  const d = dist(pt, g)
  if (d > 32) return 0
  let base = LIVE.xg.at(-1)[1] * 0.5
  for (let i = 0; i < LIVE.xg.length; i++) { const [dd, v] = LIVE.xg[i]; if (d <= dd) { const [pd, pv] = i ? LIVE.xg[i - 1] : [0, v * 1.15]; base = lerp(pv, v, (d - pd) / Math.max(0.1, dd - pd)); break } }
  const ang = Math.atan2(GOAL_HALF * 2 * Math.abs(pt.x - g.x), d * d - GOAL_HALF * GOAL_HALF + 1e-6) // 골문이 보이는 각
  const angK = clamp(Math.abs(ang) / 0.5, 0.25, 1.15)
  let block = 0
  for (const o of L.players) if (o.side !== p.side && !o.gk) { const l = laneDist(o, pt, g); if (l.d < 1.3 && l.k > 0.05 && l.k < 0.95) block++ }
  const press = nearOppDist(L, p, pt) < 1.6 ? 0.75 : 1
  const gk = L.players.find((o) => o.side !== p.side && o.gk)
  const skill = 1 + (p.finish - 72) / 110 - ((gk?.keep ?? 72) - 72) / 220
  return clamp(base * angK * Math.max(0.35, 1 - block * 0.3) * press * skill, 0, 0.75)
}

/** 공 가진 선수의 판단 */
function decide(L, p) {
  const b = L.ball
  const rng = L.rng
  const side = p.side
  const dir = dirOf(side)
  const phil = L.tactics?.[side]?.phil || 'balanced'
  const riskW = LIVE.riskW[phil] ?? 1.25
  const gainW = LIVE.gainW[phil] ?? 1
  const u = uOf(side, p.x)
  const pressure = nearOppDist(L, p)
  const g = { x: goalX(side), y: H / 2 }
  const dGoal = dist(p, g)
  const opps = L.players.filter((o) => o.side !== side)
  const line = offsideLine(L, side)
  const dead = L.dead && L.dead.taker === p.id ? L.dead.type : null
  // ── 슛 ──
  const xg = dead ? 0 : xgOf(L, p)
  let best = { kind: 'dribble', v: -9 }
  if (xg > 0 && dGoal < 27) {
    // 좋은 자리가 아니어도 때린다: 실제 축구의 슛 대부분은 득점 확률 10% 안팎이다
    const v = (xg * 2.2 + (dGoal < 16 ? 0.55 : dGoal < 22 ? 0.45 : 0.3) + (pressure > 2.5 ? 0.12 : 0) + (p.pos === 'MF' && dGoal > 16 ? 0.12 : 0)) * LIVE.shootBias
    if (v > best.v) best = { kind: 'shoot', v, xg }
  }
  // ── 패스 ──
  for (const m of L.players) {
    if (m.side !== side || m.id === p.id) continue
    const len = dist(p, m)
    if (len < 5 || len > 52) continue
    if (m.gk && (pressure > 4 || u > 40)) continue
    const um = uOf(side, m.x)
    const off = !dead && um > line + 0.3 && um > u && um > W / 2
    const lead = { x: clamp(m.x + m.vx * 0.7, 1.5, W - 1.5), y: clamp(m.y + m.vy * 0.7, 1.5, H - 1.5) }
    const loft = len > 27
    let risk = 0
    for (const o of opps) {
      if (o.gk) continue
      const l = laneDist(o, p, lead)
      if (l.k <= 0.04) continue
      const reach = 1.0 + len * l.k * (loft ? 0.02 : 0.05)
      if (l.d < reach) risk += loft && l.k < 0.75 ? 0.15 : 1 - l.d / reach
    }
    risk += loft ? 0.35 : 0
    const space = Math.min(7, nearOppDist(L, m, lead)) / 7
    const gain = (um - u) / 20
    const box = inBox(side, lead.x, lead.y) ? 0.45 : 0
    let v = gainW * gain * (gain < 0 ? 0.5 : 1) + 0.55 * space + box - riskW * risk + (xgOf(L, m, lead) * 2.4)
    if (off) v -= 0.45 + (p.pass - 70) / 60 // 오프사이드인 동료에게는 잘 주지 않는다 (가끔 걸린다)
    if (pressure < 2.2 && gain < 0.1) v += 0.3 // 압박받으면 안전하게 뒤로
    if (m.gk) v -= 0.5
    if (m.id === b.from) v -= 0.25 // 바로 되돌려 주는 패스는 덜 고른다
    v += (rng.random() - 0.5) * 0.3
    if (v > best.v) best = { kind: 'pass', v, to: m.id, lead, loft, off }
  }
  // ── 드리블 ──
  if (!dead && !p.gk) {
    let ahead = 99
    for (const o of opps) { const dx = (o.x - p.x) * dir; if (dx > 0 && dx < 7 && Math.abs(o.y - p.y) < 3.5) ahead = Math.min(ahead, dx) }
    const v = 0.3 + (ahead > 6 ? 0.45 : ahead > 3.5 ? 0.1 : -0.25 + (p.tech - 72) / 60) + (u > 60 ? 0.1 : 0) - (pressure < 1.5 ? 0.35 : 0) + (rng.random() - 0.5) * 0.25
    if (v > best.v) best = { kind: 'dribble', v }
  }
  // ── 걷어내기: 자기 박스 근처에서 압박받고 줄 곳이 없을 때 ──
  if (!dead && u < 24 && pressure < 2.5 && best.v < 0.15) best = { kind: 'clear', v: 0.2 }
  return best
}

function kickTo(L, p, target, speed, loft) {
  const b = L.ball
  const d = Math.max(0.5, dist(p, target))
  const err = (1 - clamp(p.pass / 100, 0.4, 0.97)) * d * 0.16 // 패스 정확도: 멀수록·능력이 낮을수록 빗나간다
  const tx = target.x + (L.rng.random() - 0.5) * 2 * err
  const ty = target.y + (L.rng.random() - 0.5) * 2 * err
  const dd = Math.max(0.5, Math.hypot(tx - p.x, ty - p.y))
  const T = dd / speed
  b.owner = null
  b.vx = ((tx - p.x) / dd) * speed * (loft ? 1 : 1.22) // 땅볼은 굴러가며 느려진다
  b.vy = ((ty - p.y) / dd) * speed * (loft ? 1 : 1.22)
  b.z = loft ? 0.3 : 0
  b.vz = loft ? 4.9 * T : 0 // 도착할 때 내려오게
  b.loft = loft
  b.from = p.id
  p.noTouch = 0.45
}

function act(L, p, c) {
  const b = L.ball
  const side = p.side
  const S = L.stats[side]
  if (c.kind === 'pass') {
    S.passes++
    if (c.off) { // 오프사이드: 공이 떠난 뒤 깃발
      S.offsides++
      L.events.push({ t: L.t, type: 'offside', side, p: c.to })
      kickTo(L, p, c.lead, c.loft ? LIVE.loftSpeed : LIVE.passSpeed, c.loft)
      b.to = c.to
      L.pendingOff = { at: L.t + 0.7, side: 1 - side, spot: { x: L.byId[c.to].x, y: L.byId[c.to].y } }
      return
    }
    kickTo(L, p, c.lead, c.loft ? LIVE.loftSpeed : LIVE.passSpeed, c.loft)
    b.to = c.to
    L.events.push({ t: L.t, type: 'pass', side, from: p.id, to: c.to, loft: c.loft })
  } else if (c.kind === 'clear') {
    const dir = dirOf(side)
    kickTo(L, p, { x: clamp(p.x + dir * 42, 3, W - 3), y: clamp(p.y + (p.y > H / 2 ? 10 : -10), 3, H - 3) }, LIVE.loftSpeed, true)
    b.to = null
    L.events.push({ t: L.t, type: 'clear', side, from: p.id })
  } else if (c.kind === 'shoot') {
    const rng = L.rng
    const g = { x: goalX(side), y: H / 2 }
    const xg = c.xg
    S.shots++
    S.xg += xg
    const d = dist(p, g)
    // 막힘 → 유효 → 골. 유효 슛 비율은 거리·결정력에 따라
    let blockers = 0
    for (const o of L.players) if (o.side !== side && !o.gk) { const l = laneDist(o, p, g); if (l.d < 1.2 && l.k > 0.04 && l.k < 0.6) blockers++ }
    const pBlock = clamp(blockers * 0.2, 0, 0.5)
    const pOn = clamp(0.5 - d / 90 + (p.finish - 72) / 250, 0.2, 0.68)
    const r1 = rng.random()
    let res
    if (r1 < pBlock) res = 'block'
    else if (rng.random() < pOn) { S.on++; res = rng.random() < clamp(xg / pOn / (1 - pBlock), 0.03, 0.9) ? 'goal' : 'save' }
    else res = 'miss'
    const j = rng.random() - 0.5
    const end = res === 'goal' ? { x: g.x + dirOf(side) * 1.2, y: g.y + j * 6 } : res === 'save' ? { x: g.x - dirOf(side) * 1.0, y: g.y + j * 5 } : res === 'miss' ? { x: g.x + dirOf(side) * 3, y: g.y + (j > 0 ? 1 : -1) * (4.5 + Math.abs(j) * 10) } : null
    const target = end || { x: lerp(p.x, g.x, 0.35), y: lerp(p.y, g.y, 0.35) }
    const dd = Math.max(0.5, dist(p, target))
    b.owner = null; b.to = null; b.from = p.id
    b.vx = ((target.x - p.x) / dd) * LIVE.shotSpeed; b.vy = ((target.y - p.y) / dd) * LIVE.shotSpeed
    b.z = 0.2; b.vz = res === 'miss' ? 5 + Math.abs(j) * 5 : 2.2; b.loft = true
    p.noTouch = 0.6
    L.shot = { side, p: p.id, res, at: L.t + dd / LIVE.shotSpeed, end: target, xg, d }
    L.events.push({ t: L.t, type: 'shot', side, p: p.id, res, xg, d })
  }
}

/** 한 걸음(dt초) 진행 */
export function stepLive(L, dt = LIVE.dt) {
  const b = L.ball
  const rng = L.rng
  L.t += dt
  const A = anchors(L)
  const owner = b.owner ? L.byId[b.owner] : null
  if (owner) { L.poss = owner.side; if (!L.dead) L.stats[owner.side].possT += dt }
  if (!L.dead) L.clock += dt

  // ── 목표 자리 ──
  for (const p of L.players) { const a = A[p.id]; p.tx = a ? a.x : p.x; p.ty = a ? a.y : p.y; p.sprint = false; if (p.stun > 0) p.stun -= dt; if (p.noTouch > 0) p.noTouch -= dt }

  if (L.dead) {
    // 멈춘 공: 차는 선수가 공으로 가고, 나머지는 자리를 잡는다. 준비되면 찬다
    const d = L.dead
    d.wait += dt
    const tk = d.taker ? L.byId[d.taker] : null
    b.x = d.spot.x; b.y = d.spot.y; b.z = 0; b.vx = b.vy = b.vz = 0; b.owner = null
    if (tk) {
      const dir = dirOf(tk.side)
      tk.tx = d.spot.x - dir * 0.7; tk.ty = d.spot.y; tk.sprint = true
      // 상대는 프리킥·코너킥에서 9m 떨어진다
      for (const o of L.players) if (o.side !== tk.side && dist({ x: o.tx, y: o.ty }, d.spot) < 9.15 && d.type !== 'goalkick') { const dd = Math.max(0.1, dist({ x: o.tx, y: o.ty }, d.spot)); o.tx = d.spot.x + ((o.tx - d.spot.x) / dd) * 9.3; o.ty = d.spot.y + ((o.ty - d.spot.y) / dd) * 9.3 }
      let settled = 0
      for (const p of L.players) if (Math.hypot(p.x - p.tx, p.y - p.ty) < 4) settled++
      for (const p of L.players) if (Math.hypot(p.x - p.tx, p.y - p.ty) > 6) p.sprint = true
      const ready = dist(tk, { x: tk.tx, y: tk.ty }) < 1.2 && d.wait > (d.type === 'kickoff' ? 1.2 : 0.9) && (settled >= 17 || d.wait > 9) && d.type !== 'pen'
      if (ready) {
        L.dead = null
        b.owner = tk.id
        if (d.type === 'corner' || d.type === 'fkx') {
          // 박스 안으로 올린다: 골문 앞 7~10m
          const dirA = dirOf(tk.side)
          const tgt = { x: goalX(tk.side) - dirA * (6 + rng.random() * 5), y: H / 2 + (rng.random() - 0.5) * 9 }
          L.stats[tk.side].passes++
          kickTo(L, tk, tgt, LIVE.loftSpeed, true)
          b.to = null
          L.events.push({ t: L.t, type: 'cross', side: tk.side, from: tk.id })
        } else {
          L.dead = { ...d, kicking: true } // decide가 '멈춘 공'으로 본다
          const c = decide(L, tk)
          L.dead = null
          if (c.kind === 'pass') act(L, tk, c)
          else { const m = nearest(L, tk.side, tk, tk.id); if (m) act(L, tk, { kind: 'pass', to: m.id, lead: { x: m.x, y: m.y }, loft: dist(tk, m) > 27 }) }
        }
      }
    }
  } else if (owner) {
    // ── 공을 가진 선수 ──
    const dir = dirOf(owner.side)
    owner.think -= dt
    const pressure = nearOppDist(L, owner)
    if (owner.think <= 0) {
      const c = decide(L, owner)
      owner.think = lerp(LIVE.thinkMin, LIVE.thinkMax, rng.random()) * (pressure < 2.5 ? 0.7 : 1) * (owner.gk ? 1.8 : 1)
      if (c.kind === 'dribble') {
        // 골문 쪽으로, 앞이 막혔으면 빈 쪽으로 비켜서 몰고 간다
        const g = { x: goalX(owner.side), y: H / 2 }
        let ay = 0
        for (const o of L.players) if (o.side !== owner.side) { const dx = (o.x - owner.x) * dir; if (dx > 0 && dx < 8 && Math.abs(o.y - owner.y) < 5) ay += (owner.y - o.y > 0 ? 1 : -1) * (8 - dx) }
        const gy = uOf(owner.side, owner.x) > 70 ? (g.y - owner.y) * 0.6 : 0
        owner.drib = { x: clamp(owner.x + dir * 9, 2, W - 2), y: clamp(owner.y + clamp(ay, -6, 6) + gy, 2, H - 2) }
      } else { owner.drib = null; act(L, owner, c) }
    }
    if (b.owner === owner.id) {
      if (owner.drib) { owner.tx = owner.drib.x; owner.ty = owner.drib.y; owner.sprint = pressure > 3 }
      else { owner.tx = owner.x + dir * 1.5; owner.ty = owner.y }
      // 압박: 가까운 수비가 붙고, 붙으면 태클을 시도한다
      const dfn = field(L, 1 - owner.side).filter((o) => o.stun <= 0).sort((p, q) => dist(p, owner) - dist(q, owner))
      const press = L.tactics?.[1 - owner.side]?.press ?? 50
      const n = uOf(owner.side, owner.x) > 62 || press >= 65 ? 2 : 1
      dfn.slice(0, n).forEach((o, i) => { o.tx = owner.x + dir * (i ? 2.2 : 0.6); o.ty = owner.y + (i ? (o.y > owner.y ? 2 : -2) : 0); o.sprint = true })
      L.tackleT -= dt
      const tk = dfn[0]
      if (tk && dist(tk, owner) < 1.5 && L.tackleT <= 0 && !owner.gk) {
        L.tackleT = LIVE.tackleEvery
        const r = rng.random()
        const pWin = clamp(LIVE.tackleBase + (tk.tackle - owner.tech) / 180, 0.06, 0.45)
        const pFoul = LIVE.foulBase * tk.aggr * (inBox(owner.side, owner.x, owner.y) ? 0.35 : 1) // 박스 안에서는 조심한다
        if (r < pWin && uOf(tk.side, tk.x) < 20 && rng.random() < 0.3) { L.stats[tk.side].tackles++; L.stats[owner.side].corners++; L.events.push({ t: L.t, type: 'tackle', side: tk.side, p: tk.id, from: owner.id, out: true }); restart(L, 'corner', owner.side, { x: owner.side === 0 ? W - 0.5 : 0.5, y: owner.y < H / 2 ? 0.5 : H - 0.5 }) } // 걷어낸 공이 골라인 밖으로
        else if (r < pWin) { L.stats[tk.side].tackles++; b.owner = tk.id; tk.think = 0.4; owner.stun = 0.7; b.from = null; L.events.push({ t: L.t, type: 'tackle', side: tk.side, p: tk.id, from: owner.id }) }
        else if (r < pWin + pFoul) {
          L.stats[tk.side].fouls++
          const pen = inBox(owner.side, owner.x, owner.y)
          L.events.push({ t: L.t, type: 'foul', side: tk.side, p: tk.id, on: owner.id, pen })
          const spot = pen ? { x: goalX(owner.side) - dir * 11, y: H / 2 } : { x: owner.x, y: owner.y }
          const uu = uOf(owner.side, spot.x)
          restart(L, pen ? 'pen' : uu > 70 && Math.abs(spot.y - H / 2) > 16 ? 'fkx' : 'fk', owner.side, spot)
        } else tk.stun = 0.65 // 제쳐졌다
      }
    }
  } else {
    // ── 주인 없는 공: 받을 선수와 가장 빨리 닿을 수 있는 선수들이 쫓는다 ──
    const fut = []
    { let x = b.x, y = b.y, vx = b.vx, vy = b.vy, z = b.z, vz = b.vz
      for (let i = 1; i <= 14; i++) { for (let k = 0; k < 2; k++) { x += vx * 0.1; y += vy * 0.1; if (z > 0 || vz > 0) { vz -= 9.8 * 0.1; z = Math.max(0, z + vz * 0.1) } else { vx *= 0.94; vy *= 0.94 } } fut.push({ t: i * 0.2, x: clamp(x, 0, W), y: clamp(y, 0, H), z }) } }
    const eta = (p) => { for (const f of fut) if (f.z < (p.gk ? 2.5 : 1.9) && dist(p, f) <= p.pace * f.t + 0.9) return f; return null }
    for (const side of [0, 1]) {
      const c = L.players.filter((p) => p.side === side && p.stun <= 0 && p.noTouch <= 0 && (!p.gk || inBox(1 - side, b.x, b.y) || fut.some((f) => inBox(1 - side, f.x, f.y) && f.z < 2.4)))
        .map((p) => ({ p, f: eta(p) })).filter((q) => q.f || q.p.id === b.to).sort((q, r) => (q.f?.t ?? 9) - (r.f?.t ?? 9)).slice(0, 2)
      for (const q of c) { const f = q.f || fut.at(-1); q.p.tx = f.x; q.p.ty = f.y; q.p.sprint = true }
    }
    if (b.to && L.byId[b.to]) { const m = L.byId[b.to]; const f = eta(m) || fut.at(-1); m.tx = f.x; m.ty = f.y; m.sprint = true }
  }

  // ── 공 없는 선수: 침투·지원·마크 ──
  if (!L.dead) {
    const side = L.poss
    const dir = dirOf(side)
    const line = offsideLine(L, side)
    for (const p of L.players) {
      if (p.gk || p.id === b.owner || p.sprint) continue
      if (p.side === side) {
        p.runT -= dt
        if (p.runT <= 0) { p.run = !p.run && rng.random() < (p.pos === 'FW' ? 0.75 : p.pos === 'MF' ? 0.5 : 0.14); p.runT = p.run ? 1.6 + rng.random() * 1.6 : 1.2 + rng.random() * 2.2; p.early = rng.random() < 0.3 }
        const u = uOf(side, p.x)
        if (p.run && uOf(side, b.x) > 30 && u >= uOf(side, b.x) - 4) {
          // 뒷공간으로 뛴다 — 공이 떠나기 전에는 오프사이드 선에 맞춘다
          const tu = Math.min(line + (p.early ? 1.2 : -0.4) + (b.owner ? 0 : 6), 101) // 가끔 너무 일찍 뛰어 오프사이드에 걸린다
          p.tx = side === 0 ? tu : W - tu
          p.ty = p.ty + (H / 2 - p.ty) * 0.2
          p.sprint = true
        } else if (b.owner && dist(p, L.byId[b.owner]) < 20) {
          // 가까운 동료: 상대에게서 떨어져 패스 각도를 만든다
          const o = nearest(L, 1 - side, { x: p.tx, y: p.ty })
          if (o && dist(o, { x: p.tx, y: p.ty }) < 5) { const dd = Math.max(0.5, dist(o, { x: p.tx, y: p.ty })); p.tx += ((p.tx - o.x) / dd) * 3; p.ty += ((p.ty - o.y) / dd) * 3 }
        }
        // 오프사이드 자리에 서 있지 않는다
        if (!p.run && uOf(side, p.tx) > line - 0.3 && uOf(side, p.tx) > W / 2) p.tx = side === 0 ? line - 0.5 : W - (line - 0.5)
      } else if (p.pos === 'DF' || p.pos === 'MF') {
        // 수비: 자기 구역에 들어온 공격수를 골문 쪽에서 막아선다
        let m = null
        let md = p.pos === 'DF' ? 9 : 6
        for (const a of L.players) if (a.side === side && !a.gk && a.id !== b.owner) { const d = dist(a, { x: p.tx, y: p.ty }); if (d < md) { md = d; m = a } }
        if (m) { const k = p.pos === 'DF' ? 0.55 : 0.35; p.tx = lerp(p.tx, m.x + dir * 1.8, k); p.ty = lerp(p.ty, m.y, k) }
      }
    }
    // 골키퍼: 공과 골문 사이
    for (const s of [0, 1]) {
      const k = L.players.find((p) => p.side === s && p.gk)
      if (!k || k.id === b.owner || k.sprint) continue
      const gx = s === 0 ? 0 : W
      const d = Math.hypot(b.x - gx, b.y - H / 2)
      const out = clamp(d * 0.11, 1.2, 7)
      k.tx = gx + ((b.x - gx) / Math.max(1, d)) * out
      k.ty = H / 2 + ((b.y - H / 2) / Math.max(1, d)) * out * 0.8
    }
  }

  // ── 선수 이동 ──
  for (const p of L.players) {
    if (p.stun > 0.3) { p.vx *= 0.7; p.vy *= 0.7 }
    const dx = p.tx - p.x
    const dy = p.ty - p.y
    const d = Math.hypot(dx, dy)
    const top = p.pace * (p.sprint ? 1 : 0.62) * (p.id === b.owner ? 0.86 : 1) * (p.gk ? 0.8 : 1)
    const want = Math.min(top, d * 2.6)
    const wx = d > 0.05 ? (dx / d) * want : 0
    const wy = d > 0.05 ? (dy / d) * want : 0
    const acc = clamp(dt * 3.2, 0, 1)
    p.vx += (wx - p.vx) * acc
    p.vy += (wy - p.vy) * acc
    p.x = clamp(p.x + p.vx * dt, 0.5, W - 0.5)
    p.y = clamp(p.y + p.vy * dt, 0.5, H - 0.5)
  }

  // ── 공 ──
  if (L.dead) return L
  if (b.owner) {
    const o = L.byId[b.owner]
    const sp = Math.hypot(o.vx, o.vy)
    const dir = dirOf(o.side)
    b.x = o.x + (sp > 0.5 ? (o.vx / sp) * 0.8 : dir * 0.8)
    b.y = o.y + (sp > 0.5 ? (o.vy / sp) * 0.8 : 0)
    b.z = 0; b.vx = o.vx; b.vy = o.vy; b.vz = 0
  } else {
    b.x += b.vx * dt
    b.y += b.vy * dt
    if (b.z > 0 || b.vz > 0) { b.vz -= 9.8 * dt; b.z += b.vz * dt; if (b.z <= 0) { b.z = 0; b.vz = b.vz < -3 ? -b.vz * 0.35 : 0; b.vx *= 0.75; b.vy *= 0.75 } }
    else { const f = Math.pow(0.55, dt); b.vx *= f; b.vy *= f }
    // 슛 결과
    if (L.shot && L.t >= L.shot.at) { finishShot(L); return L }
    // 오프사이드 깃발
    if (L.pendingOff && L.t >= L.pendingOff.at) { const o = L.pendingOff; L.pendingOff = null; restart(L, 'fk', o.side, o.spot); return L }
    // 공 잡기: 닿은 선수들 가운데 한 명 (둘이 다투면 능력치로)
    if (!L.shot) {
      const near = L.players.filter((p) => p.noTouch <= 0 && p.stun <= 0 && b.z < (p.gk && inBox(1 - p.side, p.x, p.y) ? 2.5 : 1.9) && dist(p, b) < (p.gk ? 1.5 : 1.05))
      if (near.length) {
        let win = near[0]
        if (near.length > 1) {
          const ws = near.map((p) => Math.max(5, (b.z > 1 ? p.tackle * 0.5 + p.tech * 0.5 : p.tech) - 40) * (p.id === b.to ? 1.5 : 1) / (0.4 + dist(p, b)))
          let r = rng.random() * ws.reduce((a, c) => a + c, 0)
          for (let i = 0; i < near.length; i++) { r -= ws[i]; if (r <= 0) { win = near[i]; break } }
        }
        const from = b.from ? L.byId[b.from] : null
        if (from && from.side === win.side && from.id !== win.id) L.stats[win.side].passOk++
        if (from && from.side !== win.side) {
          L.events.push({ t: L.t, type: 'intercept', side: win.side, p: win.id })
          // 자기 박스 안에서 끊은 공은 자주 골라인 밖으로 나간다 (측면에서 올라온 공이면 더)
          if (!win.gk && inBox(from.side, win.x, win.y) && rng.random() < (Math.abs(from.y - H / 2) > 14 ? 0.5 : 0.28)) { L.stats[from.side].corners++; restart(L, 'corner', from.side, { x: from.side === 0 ? W - 0.5 : 0.5, y: win.y < H / 2 ? 0.5 : H - 0.5 }); return L }
        }
        // 박스 안에서 뜬 공을 공격수가 따내면 바로 헤더
        if (b.z > 1 && !win.gk && inBox(win.side, win.x, win.y) && from && from.side === win.side) { b.owner = win.id; const xg = xgOf(L, win) * 0.75; act(L, win, { kind: 'shoot', xg }); return L }
        b.owner = win.id; b.to = null; b.loft = false; b.z = 0
        win.think = lerp(0.25, 0.6, rng.random()) * (b.from && from && from.side !== win.side ? 1.3 : 1)
        win.drib = null
        L.pendingOff = null
      }
    }
    // 밖으로 나간 공
    if (!b.owner && !L.shot) {
      const last = b.from ? L.byId[b.from].side : L.poss
      if (b.y < 0 || b.y > H) restart(L, 'throw', 1 - last, { x: clamp(b.x, 1, W - 1), y: b.y < 0 ? 0.4 : H - 0.4 })
      else if (b.x < 0 || b.x > W) {
        const atGoalOf = b.x < 0 ? 0 : 1 // 그 골문을 지키는 팀
        if (last === atGoalOf) { L.stats[1 - atGoalOf].corners++; restart(L, 'corner', 1 - atGoalOf, { x: b.x < 0 ? 0.5 : W - 0.5, y: b.y < H / 2 ? 0.5 : H - 0.5 }) }
        else restart(L, 'goalkick', atGoalOf, { x: b.x < 0 ? 5.5 : W - 5.5, y: H / 2 + (b.y < H / 2 ? -7 : 7) })
      }
    }
  }
  return L
}

function finishShot(L) {
  const s = L.shot
  const b = L.ball
  const rng = L.rng
  L.shot = null
  const dfn = 1 - s.side
  const gk = L.players.find((p) => p.side === dfn && p.gk)
  if (s.res === 'goal') {
    L.score[s.side]++
    L.stats[s.side].goals++
    L.events.push({ t: L.t, type: 'goal', side: s.side, p: s.p, clock: L.clock })
    restart(L, 'kickoff', dfn, { x: W / 2, y: H / 2 })
  } else if (s.res === 'save') {
    L.events.push({ t: L.t, type: 'save', side: dfn, p: gk?.id })
    if (rng.random() < 0.55 && gk) { b.owner = gk.id; b.vx = b.vy = b.vz = 0; b.z = 0; b.from = null; gk.x = clamp(b.x, 0.6, W - 0.6); gk.y = b.y; gk.think = 1.6 }
    else if (rng.random() < 0.75) { L.stats[s.side].corners++; restart(L, 'corner', s.side, { x: dfn === 0 ? 0.5 : W - 0.5, y: b.y < H / 2 ? 0.5 : H - 0.5 }) }
    else { b.vx = -b.vx * 0.3 + (rng.random() - 0.5) * 8; b.vy = (rng.random() - 0.5) * 14; b.vz = 3; b.from = gk?.id ?? null } // 쳐낸 공이 흐른다
  } else if (s.res === 'block') {
    L.events.push({ t: L.t, type: 'block', side: dfn })
    if (rng.random() < 0.45) { L.stats[s.side].corners++; restart(L, 'corner', s.side, { x: dfn === 0 ? 0.5 : W - 0.5, y: b.y < H / 2 ? 0.5 : H - 0.5 }) }
    else { b.vx = -b.vx * 0.25 + (rng.random() - 0.5) * 6; b.vy = (rng.random() - 0.5) * 12; b.vz = 2; b.z = 0.3; b.from = null }
  } else restart(L, 'goalkick', dfn, { x: dfn === 0 ? 5.5 : W - 5.5, y: H / 2 + (b.y < H / 2 ? -7 : 7) })
}

/** 페널티킥은 직접 차기 화면과 같은 확률(약 76%)로 정한다 — 멈춘 공 처리에서 불린다 */
export function resolvePen(L) {
  const d = L.dead
  if (!d || d.type !== 'pen') return null
  const tk = L.byId[d.taker]
  const gk = L.players.find((p) => p.side !== d.side && p.gk)
  const p = clamp(0.76 + ((tk?.finish ?? 72) - 75) / 250 - ((gk?.keep ?? 72) - 75) / 300, 0.6, 0.9)
  const r = L.rng.random()
  const res = r < p ? 'goal' : r < p + (1 - p) * 0.7 ? 'save' : 'miss'
  L.stats[d.side].shots++
  if (res !== 'miss') L.stats[d.side].on++
  L.events.push({ t: L.t, type: 'shot', side: d.side, p: d.taker, res, pen: true, xg: p })
  L.dead = null
  if (res === 'goal') { L.score[d.side]++; L.stats[d.side].goals++; L.events.push({ t: L.t, type: 'goal', side: d.side, p: d.taker, pen: true, clock: L.clock }); restart(L, 'kickoff', 1 - d.side, { x: W / 2, y: H / 2 }) }
  else restart(L, 'goalkick', 1 - d.side, { x: d.side === 0 ? W - 5.5 : 5.5, y: H / 2 + 7 })
  return res
}

/** 한 경기를 끝까지 돌린다 (화면 없이) */
export function runLive(L, onFrame = null) {
  const half = LIVE.playSeconds / 2
  let guard = 0
  while (L.clock < LIVE.playSeconds && guard++ < 60000) {
    if (L.dead && L.dead.type === 'pen' && L.dead.wait > 2.5) resolvePen(L)
    if (L.half === 1 && L.clock >= half) { L.half = 2; restart(L, 'kickoff', 1, { x: W / 2, y: H / 2 }) }
    stepLive(L)
    if (onFrame) onFrame(L)
  }
  return L
}
