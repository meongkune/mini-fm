// 경기장 연속 재생: 한 장면(tick)을 '대본'(누가 공을 잡고 → 어디로 패스 → 슛)으로 풀고, 선수 22명과 공을 매 프레임 움직인다.
//   예전에는 한 장면을 정지 화면 2~4개로 만들고 그 사이를 22명이 한꺼번에 미끄러졌다 — 공이 선수 사이를 오가지 않고, 달리는 선수도 없었다.
//   - 공: 대본의 구간마다 발밑에 있거나(hold), 받는 선수를 향해 날아간다(pass — 땅볼·뜬 공·크로스), 슛은 골문으로.
//   - 선수: 목표 자리를 매 프레임 '지금 공 위치'에서 다시 계산하고(positions.js의 팀 블록), 각자 속도 한계 안에서 달려간다.
//           공 가진 선수는 앞으로 몰고, 받을 선수는 받을 자리로 먼저 움직이고, 수비는 한 박자 늦게 따라온다.
//   - 장면이 끝난 자리에서 다음 장면이 이어진다 (위치를 계속 들고 있다).
// 결과(골·슛·카드)는 엔진이 이미 정했다 — 여기서는 보여 주기만 한다. 난수는 쓰지 않는다(선수 ID 해시만).
import { H, W, applyRestart, computeFrame, setPieceFrame } from './positions.js'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const lerp = (a, b, t) => a + (b - a) * t
const hashId = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const SHOT = new Set(['goal', 'save', 'miss'])
/** 1배속에서 대본 1초를 몇 초에 보여 주나: 주요 장면(슈팅·세트피스·카드)은 거의 실제 속도, 평범한 공방은 빠르게 넘긴다 */
export const PLAY_RATE = { key: 0.85, plain: 0.58 }

/**
 * 장면 → 대본 { dur(초), segs: [{ type, t0, t1, … }], chain, pts, revealAt }
 *  type: recv(공이 첫 선수에게) · hold(발밑, i번째 선수) · pass(i → i+1, kind) · shot · tackle(뺏김) · after(결과) · restart(재개)
 *        setup·kick·clear (세트피스) · idle
 */
export function scriptOf(lineups, tick, tactics) {
  if (!tick || !lineups) return { dur: 2, segs: [{ type: 'idle', t0: 0, t1: 2 }], chain: [], pts: [], revealAt: 0 }
  const segs = []
  let t = 0
  const add = (type, d, o = {}) => { segs.push({ type, t0: t, t1: t + d, ...o }); t += d }
  const shot = SHOT.has(tick.k)
  let revealAt = 0
  if (tick.sp) {
    // 세트피스: 자리 잡기 → 킥 → (걷어냄) → 슈팅 결과
    const aerial = tick.sp === 'corner' || tick.sp === 'fkx'
    add('setup', tick.sp === 'pen' ? 2.2 : 1.7)
    if (aerial) {
      add('kick', 1.2, { kind: 'cross' })
      if (tick.k === 'clear') { add('clear', 0.8); revealAt = t }
      else { add('shot', 0.45); revealAt = t; add('after', 0.9) }
    } else { add('shot', tick.sp === 'pen' ? 0.4 : 0.6); revealAt = t; add('after', 1.0) }
    if (tick.r) add('restart', 1.0)
    return { dur: Math.max(t, revealAt / 0.72), segs, chain: [], pts: [], revealAt, sp: true, rate: PLAY_RATE.key }
  }
  // 오픈 플레이: 공 잡는 선수 순서와 각자 공을 잡는 자리
  const f0 = computeFrame(lineups, tick, 0, false, tactics)
  const chain = f0.chain
  const pts = chain.map((id, i) => { const f = i === 0 ? f0 : computeFrame(lineups, tick, i, false, tactics); const q = f.pos[id]; return { x: q.x, y: q.y, kind: f.kind } })
  add('recv', 0.7)
  chain.forEach((id, i) => {
    // 측면 돌파·역습은 공을 몰고 가는 시간이 길다
    const carry = tick.ev === 'dribble' && id === tick.a ? 1.3 : tick.ev === 'counter' ? 0.5 : 0
    add('hold', (i === 0 ? 0.6 : 0.45) + carry, { i })
    if (i < chain.length - 1) {
      const kind = pts[i + 1].kind === 'loft' || pts[i + 1].kind === 'cross' ? pts[i + 1].kind : 'ground'
      const d = dist(pts[i], pts[i + 1])
      add('pass', clamp(d / (kind === 'ground' ? 17 : 22), 0.4, 1.4), { i, kind })
    }
  })
  if (shot) {
    add('shot', tick.how === 'long' || tick.ev === 'longshot' ? 0.7 : 0.45)
    revealAt = t
    add('after', 1.0)
  } else if (tick.lost) {
    add('tackle', 0.6)
    revealAt = t
    add('after', 0.45, { lost: true })
  } else {
    revealAt = t
    add('after', tick.k === 'card' ? 1.2 : 0.4)
  }
  if (tick.r) add('restart', 1.0)
  return { dur: Math.max(t, revealAt / 0.72), segs, chain, pts, revealAt, rate: shot || tick.k === 'card' ? PLAY_RATE.key : PLAY_RATE.plain }
}

/** 그 장면을 1배속으로 보여 줄 시간(ms) */
export const clipMs = (lineups, tick, tactics) => { const sc = scriptOf(lineups, tick, tactics); return Math.round(sc.dur * 1000 * (sc.rate || PLAY_RATE.plain)) }

/** 재생 상태 (선수·공의 지금 위치를 들고 다닌다) */
export function makeSim() {
  return { pos: {}, lag: {}, ball: { x: W / 2, y: H / 2, z: 0 }, t: 0, script: null, tick: null, seg: -1, from: null, carrier: null, kind: 'ground' }
}

/** 새 장면 시작: 위치는 그대로 두고 대본만 바꾼다. 골 다음 장면은 킥오프 자리(가운데)에서 */
export function startClip(sim, lineups, tick, tactics) {
  const prev = sim.tick
  sim.script = scriptOf(lineups, tick, tactics)
  sim.tick = tick
  sim.t = 0
  sim.seg = -1
  sim.from = null
  if (!tick || prev?.k === 'goal') { sim.ball = { x: W / 2, y: H / 2, z: 0 }; sim.carrier = null }
  // 새로 들어온 선수(교체)는 대기 자리에서 시작
  if (lineups) {
    const idle = computeFrame(lineups, null, 0, false, tactics).pos
    for (const side of lineups) for (const p of side) if (!sim.pos[p.id]) sim.pos[p.id] = { x: idle[p.id].x, y: idle[p.id].y }
    const live = new Set(lineups.flat().map((p) => p.id))
    for (const id of Object.keys(sim.pos)) if (!live.has(id)) { delete sim.pos[id]; delete sim.lag[id] }
  }
}

const GOAL_Y = H / 2
/** 슈팅 결과에 따라 공이 도착하는 곳 */
function shotEnd(tick) {
  const atk = tick.t
  const dir = atk === 0 ? 1 : -1
  const goalX = atk === 0 ? W : 0
  const j = ((hashId(`${tick.m}-${tick.i}-${tick.p}`) % 1000) / 1000) - 0.5
  if (tick.k === 'goal') return { x: goalX + dir * 1.5, y: GOAL_Y + j * 5.5, z: 1 + Math.abs(j) * 2 }
  if (tick.k === 'save') return { x: goalX - dir * 1.6, y: GOAL_Y + j * 6, z: 1 }
  return { x: goalX + dir * 3, y: GOAL_Y + (j > 0 ? 1 : -1) * (5 + Math.abs(j) * 9), z: 2 + Math.abs(j) * 4 }
}

/**
 * dt(대본 시간, 초)만큼 진행 → 화면에 그릴 상태 { pos, ball, carrier }
 *  선수는 목표 자리로 속도 한계 안에서 움직인다 (관여한 선수는 전력 질주, 나머지는 조깅, 수비는 조금 늦게 반응)
 */
export function stepSim(sim, lineups, tactics, dt) {
  const sc = sim.script
  if (!sc || !lineups) return sim
  const tick = sim.tick
  sim.t = Math.min(sc.dur, sim.t + dt)
  let si = sc.segs.findIndex((s) => sim.t < s.t1)
  if (si < 0) si = sc.segs.length - 1
  const seg = sc.segs[si]
  if (si !== sim.seg) { sim.seg = si; sim.from = { ...sim.ball } } // 구간이 바뀔 때 공의 출발점을 기억한다
  const u = clamp((sim.t - seg.t0) / Math.max(0.001, seg.t1 - seg.t0), 0, 1)
  const ease = u * u * (3 - 2 * u)
  const P = sim.pos
  let targets
  let fast = new Set() // 전력 질주하는 선수
  const ball = sim.ball
  const fly = (to, h = 0) => { ball.x = lerp(sim.from.x, to.x, ease); ball.y = lerp(sim.from.y, to.y, ease); ball.z = lerp(sim.from.z || 0, to.z || 0, u) + h * Math.sin(Math.PI * u) }
  const feet = (id, dir) => ({ x: P[id].x + dir * 0.9, y: P[id].y, z: 0 })
  // 공이 그 자리로 '날아간다': 속도 한계가 있어서 멀면 시간이 걸린다 (먼 거리는 뜬 공). 도착하면 true
  const chase = (to, vmax = 30) => {
    const dx = to.x - ball.x
    const dy = to.y - ball.y
    const d = Math.hypot(dx, dy)
    if (d < 0.05) { ball.z = 0; return true }
    const st = Math.min(d, vmax * dt)
    ball.x += (dx / d) * st
    ball.y += (dy / d) * st
    ball.z = d - st > 14 ? Math.min(7, (d - st) * 0.16) : Math.max(0, (ball.z || 0) - 12 * dt)
    return d - st < 1.2
  }
  // 패스·슛·킥: 구간이 끝날 때 도착하도록 날아가되 속도 한계를 넘지 않는다 (받는 선수가 예상보다 멀면 다음 구간까지 이어서 난다)
  //   h = 포물선 높이(m). 구간 시간에 맞춰 솟았다가 떨어진다
  const home = (to, cap = 30, h = 0) => {
    const dx = to.x - ball.x
    const dy = to.y - ball.y
    const d = Math.hypot(dx, dy)
    const left = Math.max(0.04, seg.t1 - sim.t)
    const st = Math.min(d, Math.min(cap, d / left) * dt)
    if (d > 0.01) { ball.x += (dx / d) * st; ball.y += (dy / d) * st }
    ball.z = h ? h * Math.sin(Math.PI * u) + (to.z || 0) * u : lerp(ball.z || 0, to.z || 0, clamp(dt * 6, 0, 1))
    return d - st < 1.2
  }

  if (!tick || seg.type === 'idle') {
    targets = computeFrame(lineups, null, 0, false, tactics).pos
    sim.carrier = null
    ball.z = 0
  } else if (sc.sp) {
    // 세트피스: 단계별 자리로 걸어가고, 킥이 날아간다
    const stage = seg.type === 'setup' ? 0 : seg.type === 'kick' ? 1 : seg.type === 'clear' ? 2 : 1
    const shotStage = seg.type === 'shot' || seg.type === 'after' || seg.type === 'restart'
    let f = setPieceFrame(lineups, tick, stage, shotStage && SHOT.has(tick.k))
    if (seg.type === 'restart') f = applyRestart(f, tick, lineups)
    targets = f.pos
    sim.carrier = seg.type === 'setup' ? f.carrier : seg.type === 'restart' ? f.carrier : null
    if (seg.type === 'setup') chase(f.ball, 26)
    else if (seg.type === 'kick') home(f.ball, 34, 7)
    else if (seg.type === 'clear') home(f.ball, 30, 5)
    else if (seg.type === 'shot' || seg.type === 'after') home(shotEnd(tick), 36, seg.type === 'shot' ? (tick.sp === 'pen' ? 0.6 : 1.5) : 0)
    else if (seg.type === 'restart') chase(f.ball, 28)
    if (tick.p) fast.add(tick.p)
  } else {
    const atk = tick.t
    const dir = atk === 0 ? 1 : -1
    const chain = sc.chain
    const n = chain.length
    const i = seg.i ?? (seg.type === 'recv' ? 0 : n - 1)
    const holder = chain[Math.min(i, n - 1)]
    const next = chain[Math.min(i + 1, n - 1)]
    const frac = seg.type === 'pass' ? u : seg.type === 'hold' ? u * 0.3 : seg.type === 'recv' ? 0 : 1
    const prog = n > 1 ? clamp((i + frac) / (n - 1), 0, 1) : 1
    const shotStage = seg.type === 'shot' || seg.type === 'after' || seg.type === 'restart'
    let f = computeFrame(lineups, tick, Math.min(i, n - 1), shotStage && SHOT.has(tick.k), tactics, { x: ball.x, y: ball.y, prog, holder })
    targets = f.pos
    // 공 가진 선수는 자기 자리에서 다음 자리 쪽으로 몰고 간다 / 받을 선수는 받을 자리로 먼저 간다
    const here = sc.pts[Math.min(i, n - 1)]
    const there = sc.pts[Math.min(i + 1, n - 1)]
    const goal = { x: atk === 0 ? W - 8 : 8, y: GOAL_Y }
    const ahead = i < n - 1 ? there : goal
    const carryK = tick.ev === 'dribble' && holder === tick.a ? 0.55 : 0.22
    if (seg.type === 'recv' || seg.type === 'hold') targets[holder] = { ...targets[holder], x: lerp(here.x, ahead.x, seg.type === 'hold' ? u * carryK : 0), y: lerp(here.y, ahead.y, seg.type === 'hold' ? u * carryK : 0) }
    if (seg.type === 'pass' || seg.type === 'hold') targets[next] = { ...targets[next], x: there.x, y: there.y }
    fast.add(holder); fast.add(next)
    if (seg.type === 'recv') sim.carrier = chase(feet(holder, dir)) ? holder : null
    else if (seg.type === 'hold') {
      // 아직 공이 오는 중이면 계속 날아오고, 도착했으면 발밑에 붙는다
      const q = feet(holder, dir)
      if (sim.carrier !== holder && dist(ball, q) > 1.4 && !chase(q)) sim.carrier = null
      else { ball.x = q.x; ball.y = q.y; ball.z = 0; sim.carrier = holder }
    }
    else if (seg.type === 'pass') { home(feet(next, dir), 30, seg.kind === 'loft' ? 8 : seg.kind === 'cross' ? 5.5 : 0); sim.carrier = null }
    else if (seg.type === 'shot') { home(shotEnd(tick), 36, tick.ev === 'longshot' ? 2.5 : 1.2); sim.carrier = null }
    else if (seg.type === 'tackle' || (seg.type === 'after' && seg.lost)) {
      // 뺏기는 장면: 수비수가 달려들어 붙으면 공이 넘어간다 (붙기 전에는 공 가진 선수 발밑)
      const d = tick.lost
      if (P[d]) {
        fast.add(d)
        const got = sim.carrier === d || dist(P[d], P[holder]) < 2.2
        if (got) { const q = feet(d, -dir); if (dist(ball, q) > 1.4) chase(q, 16); else { ball.x = q.x; ball.y = q.y; ball.z = 0 } sim.carrier = d }
        else { targets[d] = { ...targets[d], x: P[holder].x + dir * 0.6, y: P[holder].y }; const q = feet(holder, dir); ball.x = q.x; ball.y = q.y; ball.z = 0; sim.carrier = holder }
      }
    } else if (seg.type === 'after') {
      if (SHOT.has(tick.k)) home(shotEnd(tick), 36, 0) // 슛이 아직 날아가는 중이면 마저 간다
      if (tick.k === 'save') { const gk = lineups[1 - atk].find((p) => p.pos === 'GK' || p.slot === 'GK'); if (gk && P[gk.id]) { targets[gk.id] = { ...targets[gk.id], x: ball.x, y: ball.y }; fast.add(gk.id) } sim.carrier = null }
      else if (!SHOT.has(tick.k)) { const q = feet(holder, dir); ball.x = q.x; ball.y = q.y; sim.carrier = holder }
    } else if (seg.type === 'restart') {
      f = applyRestart({ ...f, ball: { ...ball }, carrier: sim.carrier }, tick, lineups)
      targets = f.pos
      sim.carrier = chase(f.ball, 28) ? f.carrier : null
    }
  }

  // 선수 이동: 목표를 조금 늦게 따라가고(반응), 속도 한계 안에서 달린다
  for (const side of [0, 1]) for (const p of lineups[side]) {
    const q = P[p.id]
    const tg = targets[p.id]
    if (!q || !tg) continue
    const defending = tick && side !== tick.t
    const lag = (sim.lag[p.id] ??= { x: tg.x, y: tg.y })
    const follow = clamp(dt / (defending ? 0.28 : 0.14), 0, 1) // 수비는 공을 보고 한 박자 늦게 움직인다
    lag.x += (tg.x - lag.x) * follow
    lag.y += (tg.y - lag.y) * follow
    const dx = lag.x - q.x
    const dy = lag.y - q.y
    const d = Math.hypot(dx, dy)
    if (d < 0.02) continue
    const gk = p.pos === 'GK' || p.slot === 'GK'
    const pace = 0.92 + (hashId(p.id) % 17) / 100 // 선수마다 조금씩 다른 빠르기
    const vmax = (fast.has(p.id) ? 8.2 : gk ? 4 : 5.6) * pace
    const v = Math.min(vmax, d * 3.2) // 가까워지면 속도를 줄인다
    const stepLen = Math.min(d, v * dt)
    q.x = clamp(q.x + (dx / d) * stepLen, 0.8, W - 0.8)
    q.y = clamp(q.y + (dy / d) * stepLen, 0.8, H - 0.8)
  }
  return sim
}
