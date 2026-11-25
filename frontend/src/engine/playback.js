// 경기장 연속 재생: 한 장면(tick)을 '대본'(누가 공을 잡고 → 어디로 패스 → 슛/뺏김)으로 풀고, 선수 22명과 공을 매 프레임 움직인다.
//   - 대본은 '지금 공을 누가 갖고 있는가'에서 시작한다: 같은 팀이면 그 선수가 이어서 풀고, 상대가 갖고 있으면 가장 가까운 선수가 뺏으면서 시작한다.
//     (처음엔 장면마다 임의의 수비수에게 공이 날아가며 시작해서, 뺏은 직후 멈칫하고 엉뚱한 패스가 나왔다)
//   - 공을 잡는 순서는 실제 그 장면을 만든 선수들(엔진의 tick.a·tick.w·슈터)이고, 사이가 멀면 가까운 동료를 한 명 거친다.
//   - 실패한 장면은 실패한 방식대로 그린다: 스루패스·롱볼·콤비네이션은 패스가 '차단'되고, 돌파·빌드업은 '태클'당하고,
//     오프사이드는 공이 넘어간 뒤 깃발이 올라간다. 슛은 슛이 기록된 장면에서만 나온다.
//   - 구간마다 상단 문구(label)를 갖는다 → 화면에 보이는 것과 문구가 같이 간다.
// 결과(골·슛·카드)는 엔진이 이미 정했다 — 여기서는 보여 주기만 한다. 난수는 쓰지 않는다(선수 ID 해시만).
import { H, W, applyRestart, computeFrame, setPieceFrame } from './positions.js'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const lerp = (a, b, t) => a + (b - a) * t
const hashId = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const SHOT = new Set(['goal', 'save', 'miss'])
const isGk = (p) => p.pos === 'GK' || p.slot === 'GK'
/** 1배속에서 대본 1초를 몇 초에 보여 주나: 주요 장면(슈팅·세트피스·카드)은 거의 실제 속도, 평범한 공방은 빠르게 넘긴다 */
export const PLAY_RATE = { key: 0.85, plain: 0.6 }
const SIDE_KO = { left: '왼쪽 ', right: '오른쪽 ' }
const RESTART_LABEL = { goalkick: '골킥', gk: '골키퍼가 잡았습니다', throw: '스로인', fk: '프리킥', offside: '오프사이드' }
const SP_LABEL = { corner: '코너킥', fk: '직접 프리킥', fkx: '프리킥 크로스', pen: '페널티킥' }

/** 그 장면에서 길을 여는 방식의 이름 */
function routeLabel(tick) {
  if (tick.ev === 'dribble') return `${SIDE_KO[tick.ch] || ''}측면 돌파`
  return { press: '빌드업', build: '빌드업', long: '롱볼', combo: '중앙 콤비네이션', through: '스루패스', counter: '역습', longshot: '중거리 슛' }[tick.ev] || '공격'
}

/**
 * 장면 → 대본 { dur(초), segs, revealAt, rate }
 *  sim: 지금 재생 상태(공 가진 선수·공 위치·선수 위치) — 없으면 가운데에서 시작한 것으로 본다
 *  구간(seg): { type, t0, t1, label, who(공 가진/차는 선수), to(받는 선수), kind(ground·loft·cross), pt·ptTo(계획한 자리), s(공격 진행도 0~1) }
 *   type: win(상대 공을 뺏으며 시작) · recv(공이 첫 선수에게) · hold · pass · cut(패스가 차단됨) · tackle · shot · after · whistle · restart
 *         setup·kick·clear (세트피스) · idle
 */
export function scriptOf(lineups, tick, tactics, sim = null) {
  if (!tick || !lineups) return { dur: 2, segs: [{ type: 'idle', t0: 0, t1: 2, label: '' }], revealAt: 0, rate: 1 }
  const segs = []
  let t = 0
  const add = (type, d, o = {}) => { segs.push({ type, t0: t, t1: t + d, ...o }); t += d }
  const shot = SHOT.has(tick.k)
  let revealAt = 0
  if (tick.sp) {
    // 세트피스: 자리 잡기 → 킥 → (걷어냄) → 슈팅 결과
    const aerial = tick.sp === 'corner' || tick.sp === 'fkx'
    const name = SP_LABEL[tick.sp]
    add('setup', tick.sp === 'pen' ? 1.6 : 1.2, { label: name }) // 키커가 공 앞에 설 때까지 기다린다 (stepSim)
    if (aerial) {
      add('kick', 1.2, { kind: 'cross', label: name })
      if (tick.k === 'clear') { add('clear', 0.8, { label: `${name} · 걷어냅니다` }); revealAt = t }
      else { add('shot', 0.45, { label: `${name} · 헤더!` }); revealAt = t; add('after', tick.k === 'goal' ? 1.8 : 0.9, { label: `${name} · ${resultLabel(tick)}` }) }
    } else { add('shot', tick.sp === 'pen' ? 0.4 : 0.6, { label: `${name} · 슛!` }); revealAt = t; add('after', tick.k === 'goal' ? 1.8 : 1.0, { label: `${name} · ${resultLabel(tick)}` }) }
    if (tick.r) add('restart', 1.0, { label: RESTART_LABEL[tick.r] })
    return { dur: Math.max(t, revealAt / 0.72), segs, revealAt, sp: true, rate: PLAY_RATE.key }
  }

  const atk = tick.t
  const dfn = 1 - atk
  const dir = atk === 0 ? 1 : -1
  const mine = lineups[atk]
  const theirs = lineups[dfn]
  const byId = Object.fromEntries([...mine, ...theirs].map((p) => [p.id, p]))
  const sideOf = (id) => (mine.some((p) => p.id === id) ? atk : theirs.some((p) => p.id === id) ? dfn : null)
  const f0 = computeFrame(lineups, tick, 0, false, tactics)
  const P = sim?.pos || {}
  const where = (id) => P[id] || f0.pos[id]
  const ball = sim?.ball || { x: W / 2, y: H / 2 }
  const field = (side) => lineups[side].filter((p) => !isGk(p) && where(p.id))
  const nearest = (side, pt, skip = []) => field(side).filter((p) => !skip.includes(p.id)).map((p) => ({ id: p.id, d: dist(where(p.id), pt) })).sort((a, b) => a.d - b.d)[0]?.id

  // ── 어디서, 누가 시작하나 ──
  const has = (id) => id && sideOf(id) === atk
  const prevTick = sim?.tick || null
  const carrier = sim?.carrier && where(sim.carrier) ? sim.carrier : null
  const carrierSide = carrier ? sideOf(carrier) : null
  const afterRestart = !!prevTick?.r // 앞 장면이 골킥·프리킥·스로인·오프사이드로 끝났나 (공 가진 선수 = 재개하는 선수)
  const kickoff = !sim || !prevTick || prevTick.k === 'goal' // 경기·후반 시작, 골 다음: 가운데에서 다시 시작한다
  const hsh = (k) => (hashId(`${tick.m}-${tick.i}-${k}`) % 1000) / 1000
  let start
  let startMode
  let origin // 이 공격이 시작되는 자리 (경기장 좌표)
  if (kickoff) {
    origin = { x: W / 2, y: H / 2 }
    start = nearest(atk, origin) || mine[0].id
    startMode = 'kickoff'
  } else if (carrierSide === atk) {
    start = carrier; origin = { ...where(carrier) }; startMode = 'keep' // 우리 선수가 갖고 있다: 그 자리에서 이어 간다
  } else if (carrierSide === dfn && afterRestart) {
    // 상대가 재개한 공을 우리가 따낸다: 골킥은 하프라인 근처에, 프리킥·스로인은 그 자리에서 조금 앞에 떨어진다
    const farKick = prevTick.r === 'goalkick' || prevTick.r === 'gk'
    origin = farKick ? { x: W / 2 + dir * (hsh('lx') - 0.5) * 18, y: 12 + hsh('ly') * (H - 24) } : { x: clamp(ball.x - dir * 16, 6, W - 6), y: clamp(ball.y + (hsh('ly') - 0.5) * 16, 6, H - 6) }
    start = nearest(atk, origin) || mine[0].id
    startMode = 'land'
  } else if (carrierSide === dfn) {
    origin = { ...where(carrier) } // 상대가 가진 공을 그 자리에서 뺏는다
    start = nearest(atk, origin) || mine[0].id
    startMode = 'win'
  } else {
    origin = { x: clamp(ball.x, 3, W - 3), y: clamp(ball.y, 3, H - 3) } // 주인 없는 공: 가장 가까운 선수가 잡는다
    start = nearest(atk, origin) || mine[0].id
    startMode = 'recv'
  }
  // 공격 경로: 시작 자리의 깊이(u0)에서 그 장면이 끝나는 깊이(uEnd)까지. 높은 곳에서 뺏었으면 거기서 바로 이어진다 (뒤로 끌려가지 않는다)
  const uOf = (pt) => (atk === 0 ? pt.x : W - pt.x) // 자기 골문에서의 거리
  const vOf = (pt) => (atk === 0 ? pt.y : H - pt.y)
  const world = (u, v) => ({ x: atk === 0 ? u : W - u, y: atk === 0 ? v : H - v })
  const u0 = clamp(uOf(origin), 5, 97)
  const v0 = vOf(origin)
  const evk = tick.ev
  const uEnd = shot ? (evk === 'longshot' ? clamp(Math.max(u0, 76), 0, 84) : Math.max(u0 + 1, 91))
    : evk === 'press' ? Math.min(98, u0 + 5)
      : evk === 'long' ? clamp(Math.max(u0 + 28, 68), 0, 90)
        : evk ? clamp(Math.max(u0 + 10, 72), 0, 92)
          : clamp(Math.max(u0 + 10, 58), 0, 90)
  const flankV = tick.ch === 'left' ? H / 2 - 23 : tick.ch === 'right' ? H / 2 + 23 : clamp(v0, H / 2 - 9, H / 2 + 9)
  const refAt = (sv) => {
    const k = clamp(sv, 0, 1)
    const v = k >= 0.95 && shot ? H / 2 + (flankV - H / 2) * 0.25 : lerp(v0, flankV, Math.min(1, k * 1.7)) // 마무리는 박스 안쪽에서
    return world(lerp(u0, uEnd, k), v)
  }
  // 그 장면을 만든 선수들과 각자 공을 잡는 진행도
  const key = [] // [{ id, s }]
  const a = has(tick.a) ? tick.a : null
  const w = has(tick.w) ? tick.w : null
  const shooter = shot && has(tick.p) ? tick.p : null
  const ev = tick.ev
  // 빌드업이 뺏기는 장면: 공 가진 선수가 이미 올라와 있으면(뺏은 직후 등) 뒤로 돌리지 않고 그 자리에서 압박에 걸린다
  // 빌드업이 뺏기는 장면: 공 가진 선수 근처에서 벌어진다 (뺏은 직후라면 바로 그 선수가 다시 압박에 걸린다)
  if (ev === 'press') key.push({ id: a && dist(where(a), origin) < 18 ? a : start, s: 0.6 })
  else if (ev === 'long') { if (a) key.push({ id: a, s: 0.08 }); if (w && w !== a) key.push({ id: w, s: 0.8, loft: true }) }
  else if (ev === 'dribble') key.push({ id: a || w || start, s: 0.62, carry: true })
  else if (ev === 'combo') key.push({ id: a || start, s: 0.6 })
  else if (ev === 'through' || ev === 'counter') key.push({ id: a || start, s: ev === 'counter' ? 0.4 : 0.55 })
  else if (ev === 'longshot') { /* 슈터가 먼 거리에서 때린다 */ }
  else if (w) key.push({ id: w, s: 0.6 })
  if (shooter && key.at(-1)?.id !== shooter) key.push({ id: shooter, s: ev === 'longshot' ? 0.72 : 1, cross: tick.fin === 'cross', loft: tick.fin === 'knock' && false })
  if (!key.length) key.push({ id: start, s: shot ? 1 : 0.5 })
  // 시작 선수 → 첫 핵심 선수 사이가 멀면 가까운 동료 한 명을 거친다 (지그재그·초장거리 패스 방지)
  const nodes = [{ id: start, pt: { ...origin }, s: 0 }]
  const fit = (id, target, fromPt) => dist(where(id), target) + Math.max(0, (fromPt.x - where(id).x) * dir - 6) * 2 // 자리에서 멀수록, 공보다 뒤에 있을수록 나쁘다
  const actorFor = (k, fromPt) => {
    if (k.id === shooter || k.id === nodes.at(-1).id) return k.id
    const target = refAt(k.s)
    const own = fit(k.id, target, fromPt)
    const taken = [...nodes.map((n) => n.id), ...key.map((x) => x.id)]
    const best = field(atk).filter((p) => !taken.includes(p.id)).map((p) => ({ id: p.id, v: fit(p.id, target, fromPt) })).sort((x, y) => x.v - y.v)[0]
    return best && best.v < own - 8 ? best.id : k.id
  }
  // 받는 자리: 계획한 자리 쪽으로, 그 선수가 뛰어서 닿을 수 있는 만큼만 (슈터는 끝까지 — 공 가진 선수가 기다려 준다)
  const spotFor = (id, target, maxRun) => { const p = where(id); const d = dist(p, target); return d <= maxRun ? target : { x: lerp(p.x, target.x, maxRun / d), y: lerp(p.y, target.y, maxRun / d) } }
  for (const k0 of key) {
    const k = { ...k0, id: actorFor(k0, nodes.at(-1).pt) }
    if (k.id === nodes.at(-1).id) { Object.assign(nodes.at(-1), { carry: k.carry, s: Math.max(nodes.at(-1).s, k.s), pt: nodes.length === 1 ? nodes[0].pt : refAt(k.s), goto: refAt(k.s) }); continue }
    const from = nodes.at(-1)
    const to = spotFor(k.id, refAt(k.s), k.id === shooter ? 99 : 14)
    if (!k.loft && dist(from.pt, to) > 30 && nodes.length === 1) {
      const midPt = { x: lerp(from.pt.x, to.x, 0.5), y: lerp(from.pt.y, to.y, 0.5) }
      const mid = nearest(atk, midPt, [from.id, k.id, ...key.map((x) => x.id)])
      if (mid && dist(where(mid), midPt) < 18) nodes.push({ id: mid, pt: { x: lerp(where(mid).x, midPt.x, 0.6), y: lerp(where(mid).y, midPt.y, 0.6) }, s: lerp(from.s, k.s, 0.5) })
    }
    nodes.push({ id: k.id, pt: to, s: k.s, carry: k.carry, loft: k.loft, cross: k.cross })
  }
  // 백패스는 짧게만: 다음 선수의 자리가 공보다 10m 넘게 뒤면 앞으로 당긴다 (공격 방향 기준)
  for (let i = 1; i < nodes.length; i++) {
    const back = (nodes[i - 1].pt.x - nodes[i].pt.x) * dir
    if (back > 10) nodes[i].pt = { x: nodes[i - 1].pt.x - dir * 8, y: nodes[i].pt.y } // 받을 선수가 올라와 받는다 (공 가진 선수가 기다린다)
  }

  // ── 실패 방식 ──
  const offside = tick.r === 'offside'
  // 화면에서 공을 뺏는 선수: 엔진이 정한 선수가 너무 멀면 그 자리에서 가장 가까운 수비
  const last = nodes.at(-1)
  let taker = !shot && tick.lost && sideOf(tick.lost) === dfn ? tick.lost : null
  if (!shot && tick.lost && !taker) taker = nearest(dfn, last.pt) || null
  if (taker && dist(where(taker), last.pt) > 16) taker = nearest(dfn, last.pt) || taker
  const cutPass = taker && !offside && (ev === 'through' || ev === 'counter' || ev === 'combo' || (ev === 'long' && !shot)) // 패스가 차단되는 장면
  const route = routeLabel(tick)

  // ── 구간 ──
  if (startMode === 'kickoff') { add('kickoff', 1.0, { who: start, label: '킥오프', s: 0 }); add('recv', 0.4, { who: start, pt: origin, label: '킥오프', s: 0 }) }
  else if (startMode === 'win') add('win', 0.7, { who: start, from: carrier, label: '공을 뺏어냅니다', s: 0 })
  else if (startMode === 'land') add('recv', 1.0, { who: start, pt: origin, loft: true, label: prevTick.r === 'goalkick' || prevTick.r === 'gk' ? '골킥을 따냅니다' : '공을 따냅니다', s: 0 })
  else if (startMode === 'recv') add('recv', 0.6, { who: start, pt: origin, label: '세컨드 볼', s: 0 })
  nodes.forEach((nd, i) => {
    const isLast = i === nodes.length - 1
    const isKey = nd.id === a || nd.id === w
    const label = isLast && shooter === nd.id && nodes.length > 1 ? finLabel(tick, route) : isKey || isLast ? route : '빌드업'
    // 롱볼이 차단되는 장면: 넘겨 주는 선수까지만 잡고, 공은 날아가다 수비 머리에 걸린다
    if (cutPass && ev === 'long' && isLast && nodes.length > 1 && nd.id === w) return
    add('hold', (i === 0 ? 0.55 : 0.45) + (nd.carry ? 1.2 : 0) + (ev === 'counter' && isLast ? 0.4 : 0), { who: nd.id, pt: nd.pt, next: nodes[i + 1]?.pt || null, nextId: nodes[i + 1]?.id || null, nextShooter: !!nodes[i + 1] && nodes[i + 1].id === shooter, carry: !!nd.carry, label, s: nd.s, last: isLast })
    const nx = nodes[i + 1]
    if (nx && !(cutPass && ev === 'long' && nx.id === w && i + 1 === nodes.length - 1)) {
      const d = dist(nd.pt, nx.pt)
      const kind = nx.cross ? 'cross' : nx.loft || d > 30 ? 'loft' : 'ground'
      add('pass', clamp(d / (kind === 'ground' ? 17 : 22), 0.4, 2.4), { who: nd.id, to: nx.id, ptFrom: nd.pt, ptTo: nx.pt, kind, label: nx.cross ? `${route} → 크로스` : nx.id === shooter && (tick.fin === 'oneOnOne' || tick.fin === 'counter') ? `${route} → 1대1` : i + 1 === nodes.length - 1 ? route : '빌드업', s: lerp(nd.s, nx.s, 0.5) })
    }
  })
  const lastHold = [...segs].reverse().find((sg) => sg.type === 'hold')
  if (shot) {
    // 슛이 날아가는 시간: 거리에 맞춘다 (먼 거리 슛이 순간이동하거나 골문에 닿기 전에 장면이 끝나지 않게)
    const goalAt = { x: atk === 0 ? W : 0, y: H / 2 }
    add('shot', clamp(dist(last.pt, goalAt) / 30, 0.45, 1.2), { who: last.id, label: `${finLabel(tick, route)} · 슛!`, s: 1 })
    revealAt = t
    add('after', tick.k === 'goal' ? 1.8 : 1.0, { who: last.id, label: `${finLabel(tick, route)} · ${resultLabel(tick)}`, s: 1 })
  } else if (offside) {
    // 넘겨 준 공을 가장 앞선 공격수가 받지만 깃발이 올라간다
    const runner = field(atk).filter((p) => p.id !== last.id).sort((x, y) => (where(y.id).x - where(x.id).x) * dir)[0]?.id || last.id
    // 공은 그 공격수가 뛰어드는 앞 공간으로 간다 (선수가 닿을 수 없는 먼 곳으로 차지 않는다)
    const rp = where(runner)
    const ptTo = { x: clamp(Math.max((rp.x + dir * 7) * dir, (last.pt.x + dir * 6) * dir) * dir, 4, W - 4), y: clamp(rp.y + (H / 2 - rp.y) * 0.2, 8, H - 8) }
    add('pass', clamp(dist(last.pt, ptTo) / 20, 0.6, 1.6), { who: last.id, to: runner, ptFrom: last.pt, ptTo, kind: 'ground', label: `${route}`, s: 0.9 })
    revealAt = t
    add('whistle', 0.9, { who: runner, label: `${route} · 오프사이드`, s: 0.9 })
  } else if (cutPass) {
    // 패스가 차단된다: 받을 선수 쪽으로 가던 공을 수비가 끊는다
    const goalX = atk === 0 ? W : 0
    const from = (lastHold || { pt: last.pt }).pt
    const aim = ev === 'long' ? refAt(0.8) : { x: lerp(from.x, goalX - dir * 12, 0.6), y: lerp(from.y, H / 2, 0.5) }
    const cutAt = { x: lerp(from.x, aim.x, 0.7), y: lerp(from.y, aim.y, 0.7) }
    add('cut', clamp(dist(from, cutAt) / (ev === 'long' ? 22 : 17), 0.45, 1.4), { who: lastHold?.who ?? last.id, to: taker, ptTo: cutAt, kind: ev === 'long' ? 'loft' : 'ground', label: route, s: 0.75 })
    revealAt = t
    add('after', 0.45, { who: taker, lost: true, label: `${route} · ${ev === 'long' ? '수비가 걷어냅니다' : '패스가 차단됩니다'}`, s: 0.75 })
  } else if (taker) {
    add('tackle', 0.7, { who: last.id, to: taker, label: route, s: last.s })
    revealAt = t
    add('after', 0.4, { who: taker, lost: true, label: `${route} · ${ev === 'press' ? '압박에 뺏깁니다' : '태클에 막힙니다'}`, s: last.s })
  } else {
    revealAt = t
    add('after', tick.k === 'card' ? 1.2 : 0.4, { who: last.id, label: tick.k === 'card' ? `${route} · 반칙!` : route, s: last.s, foul: tick.k === 'card' })
  }
  if (tick.r && !offside) add('restart', 1.0, { label: RESTART_LABEL[tick.r] })
  return { dur: Math.max(t, revealAt / 0.72), segs, revealAt, rate: shot || tick.k === 'card' ? PLAY_RATE.key : PLAY_RATE.plain, taker, nodes: nodes.map((n) => n.id) }
}
function resultLabel(tick) { return tick.k === 'goal' ? '골!' : tick.k === 'save' ? '선방!' : tick.k === 'miss' ? '빗나감' : '' }
function finLabel(tick, route) {
  const fin = { cross: '크로스', oneOnOne: '1대1', counter: '1대1', cutback: '컷백', knock: '떨궈 준 공' }[tick.fin]
  return fin ? `${route} → ${fin}` : route
}

/** 그 장면을 1배속으로 보여 줄 시간(ms). sim을 주면 지금 공 소유 상태에서 이어지는 대본 길이 */
export const clipMs = (lineups, tick, tactics, sim = null) => { const sc = scriptOf(lineups, tick, tactics, sim); return Math.round(sc.dur * 1000 * (sc.rate || PLAY_RATE.plain)) }

/** 재생 상태 (선수·공의 지금 위치를 들고 다닌다) */
export function makeSim() {
  return { pos: {}, lag: {}, ball: { x: W / 2, y: H / 2, z: 0 }, t: 0, script: null, tick: null, seg: -1, from: null, carrier: null, label: '', stall: 0, done: false, revealed: false }
}

/** 새 장면 시작: 위치·공 소유는 그대로 두고 대본만 새로 짠다. 골 다음 장면은 킥오프 자리(가운데)에서 */
/** 명단 맞추기: 새로 들어온 선수는 기본 자리에 세우고, 나간 선수는 지운다 */
export function syncPlayers(sim, lineups, tactics) {
  if (!lineups) return
  const idle = computeFrame(lineups, null, 0, false, tactics).pos
  for (const side of lineups) for (const p of side) if (!sim.pos[p.id]) sim.pos[p.id] = { x: idle[p.id].x, y: idle[p.id].y }
  const live = new Set(lineups.flat().map((p) => p.id))
  for (const id of Object.keys(sim.pos)) if (!live.has(id)) { delete sim.pos[id]; delete sim.lag[id] }
  if (sim.carrier && !live.has(sim.carrier)) sim.carrier = null
}
export function startClip(sim, lineups, tick, tactics) {
  const prev = sim.tick
  syncPlayers(sim, lineups, tactics)
  if (!tick || prev?.k === 'goal') { sim.ball = { x: W / 2, y: H / 2, z: 0 }; sim.carrier = null }
  sim.script = scriptOf(lineups, tick, tactics, { ...sim, tick: prev })
  sim.tick = tick
  sim.t = 0
  sim.seg = -1
  sim.from = null
  sim.label = sim.script.segs[0]?.label || ''
  sim.stall = 0
  sim.done = false
  sim.revealed = false
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
 * dt(대본 시간, 초)만큼 진행 → sim (pos·ball·carrier·label이 갱신된다)
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
  if (si !== sim.seg) { sim.seg = si; sim.from = { ...sim.ball }; sim.label = seg.label ?? sim.label; sim.stall = 0; sim.base = seg.who && sim.pos[seg.who] ? { ...sim.pos[seg.who] } : null } // 구간이 바뀔 때 공의 출발점을 기억한다
  // 기다리기: 조건(선수가 자리에 도착 등)이 될 때까지 이 구간을 넘어가지 않는다 (최대 max초). 시간표대로만 흘러가면 키커가 코너로 가는 중에 공이 날아간다
  const waitFor = (ok, max) => { if (!ok && sim.stall < max) { sim.stall += dt; sim.t = Math.min(sim.t, seg.t1 - 0.02) } }
  const u = clamp((sim.t - seg.t0) / Math.max(0.001, seg.t1 - seg.t0), 0, 1)
  const P = sim.pos
  let targets
  const fast = new Set() // 전력 질주하는 선수
  const ball = sim.ball
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
  // 패스·슛·킥: 구간이 끝날 때 도착하도록 날아가되 속도 한계를 넘지 않는다. h = 포물선 높이(m)
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
  const feet = (id, d) => ({ x: P[id].x + d * 0.9, y: P[id].y, z: 0 })
  const stick = (id, d) => { const q = feet(id, d); if (sim.carrier !== id && dist(ball, q) > 1.4 && !chase(q)) return false; ball.x = q.x; ball.y = q.y; ball.z = 0; sim.carrier = id; return true }

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
    if (seg.type === 'setup') {
      // 공은 킥 지점에 놓이고, 키커가 그 앞에 설 때까지 기다린다
      const placed = chase(f.ball, 26)
      const kt = f.carrier
      const ready = placed && (!kt || !P[kt] || dist(P[kt], targets[kt]) < 1.6)
      if (kt) fast.add(kt)
      sim.carrier = ready ? kt : null
      waitFor(ready, 13) // 키커가 멀리 있으면 달려오는 데 시간이 걸린다
    }
    else if (seg.type === 'kick') { home(f.ball, 34, 7); sim.carrier = null }
    else if (seg.type === 'clear') {
      // 걷어낸 공: 가까운 수비 쪽 선수가 잡는다 (다음 장면이 거기서 이어진다)
      home(f.ball, 30, 5)
      const near = lineups[1 - tick.t].filter((p) => !isGk(p) && P[p.id]).map((p) => ({ id: p.id, d: dist(P[p.id], f.ball) })).sort((a, b) => a.d - b.d)[0]
      if (near) { targets[near.id] = { ...targets[near.id], x: f.ball.x, y: f.ball.y }; fast.add(near.id); sim.carrier = u > 0.9 && near.d < 3 ? near.id : null }
    } else if (seg.type === 'shot' || seg.type === 'after') {
      home(shotEnd(tick), 36, seg.type === 'shot' ? (tick.sp === 'pen' ? 0.6 : 1.5) : 0)
      sim.carrier = null
    } else if (seg.type === 'restart') { const got = chase(f.ball, 28); if (f.carrier) fast.add(f.carrier); const there = got && (!f.carrier || !P[f.carrier] || dist(P[f.carrier], targets[f.carrier]) < 1.8); sim.carrier = there ? f.carrier : null; waitFor(there, 5) }
    if (tick.p) fast.add(tick.p)
  } else {
    const atk = tick.t
    const dir = atk === 0 ? 1 : -1
    const who = seg.who && P[seg.who] ? seg.who : null
    const shotStage = (seg.type === 'shot' || seg.type === 'after') && SHOT.has(tick.k)
    // 팀 블록: 지금 공 위치와 이 구간의 진행도에서 다시 계산한다
    let f = computeFrame(lineups, tick, 0, shotStage, tactics, { x: ball.x, y: ball.y, prog: clamp(seg.s ?? 0.5, 0, 1), holder: who })
    targets = f.pos
    if (who) fast.add(who)
    if (sim.carrier && P[sim.carrier] && seg.type !== 'kickoff') targets[sim.carrier] = { ...targets[sim.carrier], x: P[sim.carrier].x, y: P[sim.carrier].y }
    if (seg.type === 'kickoff') {
      // 골 다음·경기 시작: 양 팀이 자기 진영으로 돌아가고 공은 가운데에 놓인다. 다 돌아오면 시작한다
      targets = computeFrame(lineups, null, 0, false, tactics).pos
      targets[who] = { ...targets[who], x: W / 2 - dir * 0.8, y: H / 2 }
      ball.x = W / 2; ball.y = H / 2; ball.z = 0
      sim.carrier = null
      let far = 0
      for (const side of lineups) for (const p of side) { if (P[p.id] && targets[p.id] && dist(P[p.id], targets[p.id]) > 5) far++; fast.add(p.id) }
      waitFor(far <= 2, 6)
    } else if (seg.type === 'win') {
      // 상대가 가진 공을 뺏으며 시작: 달려들어 붙으면 공이 넘어온다
      const from = seg.from && P[seg.from] ? seg.from : null
      if (from && sim.carrier === from) {
        if (dist(P[who], P[from]) < 2.2 || u > 0.9) stick(who, dir)
        else { targets[who] = { ...targets[who], x: P[from].x, y: P[from].y }; const q = feet(from, -dir); ball.x = q.x; ball.y = q.y; ball.z = 0 }
      } else stick(who, dir)
      waitFor(sim.carrier === who, 1.5)
    } else if (seg.type === 'recv') {
      if (seg.pt) {
        // 떨어지는 자리로 선수가 먼저 뛰어가고, 공은 그 자리로 날아온다 (상대가 찬 골킥·걷어낸 공)
        targets[who] = { ...targets[who], x: seg.pt.x, y: seg.pt.y }
        const near = dist(P[who], seg.pt) < 2.5
        const got = chase(near ? feet(who, dir) : seg.pt, seg.loft ? 26 : 30)
        sim.carrier = got && near ? who : null
      } else {
        targets[who] = { ...targets[who], x: lerp(P[who].x, ball.x, 0.5), y: lerp(P[who].y, ball.y, 0.5) } // 공을 맞으러 간다
        sim.carrier = chase(feet(who, dir)) ? who : sim.carrier === who ? who : null
      }
      waitFor(sim.carrier === who, 3)
    } else if (seg.type === 'hold') {
      // 공을 몰고 간다: 계획한 자리 → 다음 자리(없으면 골문) 쪽으로
      const goal = { x: atk === 0 ? W - 9 : 9, y: GOAL_Y }
      const ahead = seg.next || goal
      const k = seg.carry ? 0.6 : 0.2
      const base = sim.base || seg.pt
      targets[who] = { ...targets[who], x: lerp(base.x, ahead.x, u * k), y: lerp(base.y, ahead.y, u * k) }
      stick(who, dir)
      if (seg.nextId && P[seg.nextId] && seg.next) {
        targets[seg.nextId] = { ...targets[seg.nextId], x: seg.next.x, y: seg.next.y }
        fast.add(seg.nextId)
        waitFor(dist(P[seg.nextId], seg.next) < 10 || u < 0.9, seg.nextShooter ? 4 : 3)
      }
      // 곧 뺏길 장면이면 수비가 미리 붙으러 온다
      if (seg.last && sc.taker && P[sc.taker]) { targets[sc.taker] = { ...targets[sc.taker], x: P[who].x + dir * 1.6, y: P[who].y }; fast.add(sc.taker) }
    } else if (seg.type === 'pass') {
      const to = seg.to && P[seg.to] ? seg.to : who
      targets[to] = { ...targets[to], x: seg.ptTo.x, y: seg.ptTo.y } // 받을 자리로 먼저 간다
      fast.add(to)
      const there = dist(P[to], seg.ptTo) < 3 || sim.stall > 1.8 // 끝내 못 오면 공이 선수에게 간다
      const arrived = home(there ? feet(to, dir) : seg.ptTo, seg.kind === 'ground' ? 30 : 36, seg.kind === 'loft' ? 8 : seg.kind === 'cross' ? 5.5 : 0)
      const got = arrived && dist(P[to], ball) < 2.5
      sim.carrier = got && u > 0.85 ? to : null
      waitFor(got || u < 0.9, 2.4) // 공이 받는 선수에게 닿은 뒤에 다음으로 넘어간다
    } else if (seg.type === 'cut') {
      // 차단: 수비가 패스 길목으로 들어와 끊는다
      const to = seg.to && P[seg.to] ? seg.to : null
      if (to) { targets[to] = { ...targets[to], x: seg.ptTo.x, y: seg.ptTo.y }; fast.add(to) }
      const inPlace = to && dist(P[to], seg.ptTo) < 3
      const got = home(inPlace ? feet(to, -dir) : seg.ptTo, 30, seg.kind === 'loft' ? 8 : 0)
      sim.carrier = got && inPlace && u > 0.8 ? to : null
      waitFor(sim.carrier === to || u < 0.9, 1.5)
    } else if (seg.type === 'tackle') {
      const to = seg.to && P[seg.to] ? seg.to : null
      if (to) {
        fast.add(to)
        // 수비가 붙어야 공이 넘어간다 (붙을 때까지 기다린다)
        if (sim.carrier === to || dist(P[to], P[who]) < 2.2) stick(to, -dir)
        else { targets[to] = { ...targets[to], x: P[who].x + dir * 0.6, y: P[who].y }; stick(who, dir) }
        waitFor(sim.carrier === to, 2.5)
      }
    } else if (seg.type === 'shot') { home(shotEnd(tick), 36, tick.ev === 'longshot' ? 2.5 : 1.2); sim.carrier = null }
    else if (seg.type === 'whistle') { if (who) stick(who, dir) }
    else if (seg.type === 'after') {
      if (SHOT.has(tick.k)) {
        const inGoal = home(shotEnd(tick), 36, 0) // 슛이 아직 날아가는 중이면 마저 간다
        sim.carrier = null
        waitFor(inGoal || u < 0.5, 2)
        if (tick.k === 'save') { const gk = lineups[1 - atk].find(isGk); if (gk && P[gk.id]) { targets[gk.id] = { ...targets[gk.id], x: ball.x, y: ball.y }; fast.add(gk.id) } }
      } else if (who) {
        if (!stick(who, seg.lost ? -dir : dir) && seg.lost && u > 0.5) { const q = feet(who, -dir); ball.x = q.x; ball.y = q.y; ball.z = 0; sim.carrier = who }
        if (seg.lost) targets[who] = { ...targets[who], x: P[who].x - dir * 1.5, y: P[who].y }
      }
    } else if (seg.type === 'restart') {
      f = applyRestart({ ...f, ball: { ...ball }, carrier: sim.carrier }, tick, lineups)
      targets = f.pos
      sim.carrier = chase(f.ball, 28) ? f.carrier : null
      if (f.carrier) fast.add(f.carrier)
    }
  }

  // 선수 이동: 목표를 조금 늦게 따라가고(반응), 속도 한계 안에서 달린다
  for (const side of [0, 1]) for (const p of lineups[side]) {
    const q = P[p.id]
    const tg = targets[p.id]
    if (!q || !tg) continue
    const defending = tick && side !== tick.t
    const lag = (sim.lag[p.id] ??= { x: tg.x, y: tg.y })
    const follow = clamp(dt / (fast.has(p.id) ? 0.08 : defending ? 0.28 : 0.14), 0, 1) // 수비는 공을 보고 한 박자 늦게 움직인다
    lag.x += (tg.x - lag.x) * follow
    lag.y += (tg.y - lag.y) * follow
    const dx = lag.x - q.x
    const dy = lag.y - q.y
    const d = Math.hypot(dx, dy)
    if (d < 0.02) continue
    const pace = 0.92 + (hashId(p.id) % 17) / 100 // 선수마다 조금씩 다른 빠르기
    const vmax = (fast.has(p.id) ? 8.2 : isGk(p) ? 4 : 5.6) * pace
    const v = Math.min(vmax, d * 3.2) // 가까워지면 속도를 줄인다
    const stepLen = Math.min(d, v * dt)
    q.x = clamp(q.x + (dx / d) * stepLen, 0.8, W - 0.8)
    q.y = clamp(q.y + (dy / d) * stepLen, 0.8, H - 0.8)
  }
  // 화면(경기 화면)이 읽는 신호: 결과가 드러났다 · 이 장면이 끝났다
  if (sim.t >= sc.revealAt) sim.revealed = true
  if (sim.t >= sc.dur - 1e-6) sim.done = true
  return sim
}
