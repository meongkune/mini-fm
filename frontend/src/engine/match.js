// Mini FM 경기 엔진 v2 — 1분씩 진행한다.
// 경기 상태(match)는 순수 객체라 저장·복원이 되고, 중간에 교체·전술 변경·하프타임 지시를 넣을 수 있다.
// 팀 데이터(선수 능력치)는 상태에 넣지 않고 매번 ctx로 받는다: ctx = { teams: [home, away], status }
//   status[playerId] = { cond: 0~100(컨디션), morale: 0~100(사기), form: 평균 평점 } — 없으면 기본값
import { MENTALITY, PRESSING, playerOvrOf } from './engine.js'
import { ROLE_POS, assignSlots, buildSlots, fitOf, shapeMods } from './formation.js'

const DEFAULT_TACTICS = { formation: '4-4-2', mentality: 'balanced', pressing: 'normal', line: 'normal', tempo: 'normal' }
// 팀 지시: 수비 라인 높이, 템포
export const LINE = { low: { mid: -3, def: 3, offside: 0.6 }, normal: { mid: 0, def: 0, offside: 1 }, high: { mid: 3, def: -2, offside: 1.7 } }
export const TEMPO = { slow: { att: -2, mid: 2, acc: 0.03, drain: 0.95 }, normal: { att: 0, mid: 0, acc: 0, drain: 1 }, fast: { att: 3, mid: -1, acc: -0.03, drain: 1.1 } }
// AI 구단 전형: 구단마다 고정 (다양한 상대를 만나도록)
const AI_SHAPES = ['4-4-2', '4-3-3', '4-2-3-1', '4-1-4-1', '3-5-2', '4-4-1-1', '4-3-3', '4-2-3-1']
export const aiFormation = (teamId) => AI_SHAPES[[...String(teamId)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AI_SHAPES.length]
export const MAX_SUBS = 5

// ── 난수: 상태에 정수 하나만 저장 (mulberry32) ──
function rngOf(match) {
  const random = () => {
    let a = (match.rng = (match.rng + 0x6d2b79f5) | 0)
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const weighted = (arr, weights) => {
    const total = weights.reduce((s, w) => s + w, 0)
    if (!(total > 0)) return arr[Math.floor(random() * arr.length)]
    let r = random() * total
    for (let i = 0; i < arr.length; i++) { r -= weights[i]; if (r < 0) return arr[i] }
    return arr[arr.length - 1]
  }
  return { random, weighted, pick: (arr) => arr[Math.floor(random() * arr.length)] }
}
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296 }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const avg = (v, fb = 50) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : fb)

const emptyStats = () => ({ poss: 0, shots: 0, onTarget: 0, xg: 0, passes: 0, passesOk: 0, corners: 0, fouls: 0, offsides: 0, saves: 0, yellow: 0, red: 0 })
const emptyPs = (from) => ({ from, to: null, g: 0, a: 0, sh: 0, sot: 0, kp: 0, tk: 0, sv: 0, yc: 0, rc: 0, xg: 0, conceded: 0 })

/** 출전 가능 여부 (부상·징계) */
export const available = (status, id) => !(status?.[id]?.inj > 0) && !(status?.[id]?.susp > 0)

/** 컨디션·출전 가능을 고려해 포메이션 자리마다 선수를 배정 (자리 순서 = 포메이션 자리 순서) */
export function pickLineup(team, formation = '4-4-2', status = {}, { useCondition = true, keep = {} } = {}) {
  return assignSlots(team, formation, { status, useCondition, keep, available: (id) => available(status, id) }).filter(Boolean)
}

export function createMatch({ home, away, homeCfg = {}, awayCfg = {}, seed, status = {}, myIdx = null }) {
  const sideState = (team, cfg) => {
    const tactics = { ...DEFAULT_TACTICS, ...(cfg.tactics || {}) }
    if (!cfg.tactics?.formation && !cfg.lineup) tactics.formation = aiFormation(team.id)
    const byId = Object.fromEntries(team.players.map((p) => [p.id, p]))
    // 정해 둔 자리는 그대로, 비었거나 출전할 수 없는 자리만 가장 알맞은 선수로 채운다
    const keep = {}
    ;(cfg.lineup || []).slice(0, 11).forEach((id, i) => { if (id && byId[id] && available(status, id)) keep[i] = id })
    const slots = buildSlots(tactics.formation).map((x) => x.role)
    const ids = assignSlots(team, tactics.formation, { status, keep, available: (id) => available(status, id) })
    const onPitch = []
    const slotRoles = []
    ids.forEach((id, i) => { if (id) { onPitch.push(id); slotRoles.push(slots[i]) } })
    const energy = {}
    for (const p of team.players) energy[p.id] = status[p.id]?.cond ?? 100
    return { teamId: team.id, name: team.short || team.name, tactics, onPitch, slots: slotRoles, subsLeft: MAX_SUBS, subs: [], sentOff: [], injured: [], yellows: {}, energy }
  }
  const s = seed ?? Math.floor(Math.random() * 1e9) + 1
  const match = {
    seed: s, rng: s, minute: 0, myIdx,
    teams: [home.id, away.id],
    sides: [sideState(home, homeCfg), sideState(away, awayCfg)],
    stats: [emptyStats(), emptyStats()],
    score: [0, 0],
    ps: {},
    talk: [0, 0], // 하프타임 지시 효과 (경기력 배수 보정)
    scorers: [],
    events: [],
    timeline: [],
  }
  match.sides.forEach((sd) => sd.onPitch.forEach((id) => { match.ps[id] = emptyPs(0) }))
  match.events.push({ minute: 0, type: 'info', text: `킥오프! ${match.sides[0].name} vs ${match.sides[1].name}` })
  return match
}

// 그 분의 선수 실효 능력치: 체력·사기·폼·하프타임 지시
function effective(match, ctx, idx, p) {
  const sd = match.sides[idx]
  const st = ctx.status?.[p.id] || {}
  const e = sd.energy[p.id] ?? 100
  const f = (0.8 + 0.2 * e / 100) * (0.97 + 0.06 * (st.morale ?? 50) / 100) * (1 + clamp(((st.form ?? 6.6) - 6.6) * 0.02, -0.03, 0.03)) * (1 + match.talk[idx])
  return { ...p, att: p.att * f, def: p.def * f }
}

function sideRatings(match, ctx, idx) {
  const sd = match.sides[idx]
  const team = ctx.teams[idx]
  const byId = Object.fromEntries(team.players.map((p) => [p.id, p]))
  // 자리 적합도만큼 능력치가 깎이고, 엔진에서는 '자리의' 포지션으로 뛴다
  const xi = []
  sd.onPitch.forEach((id, i) => {
    const p = byId[id]
    if (!p) return
    const e = effective(match, ctx, idx, p)
    const fit = fitOf(p, sd.slots[i])
    xi.push({ ...e, att: e.att * fit, def: e.def * fit, pos: ROLE_POS[sd.slots[i]], realPos: p.pos })
  })
  const g = Object.fromEntries(['GK', 'DF', 'MF', 'FW'].map((pos) => [pos, xi.filter((p) => p.pos === pos)]))
  const f = shapeMods(sd.tactics.formation)
  const m = MENTALITY[sd.tactics.mentality] || MENTALITY.balanced
  const pr = PRESSING[sd.tactics.pressing] || PRESSING.normal
  const ln = LINE[sd.tactics.line] || LINE.normal
  const tp = TEMPO[sd.tactics.tempo] || TEMPO.normal
  const missing = 11 - xi.length // 퇴장·부상으로 빈 자리
  const penalty = (g.GK.length !== 1 ? 15 : 0) + missing * 6
  return {
    xi,
    attack: avg([...g.FW.map((p) => p.att), ...g.FW.map((p) => p.att), ...g.MF.map((p) => p.att)]) + f.att + m.att + tp.att - penalty,
    midfield: avg(g.MF.map((p) => (p.att + p.def) / 2)) + f.mid + pr.mid + ln.mid + tp.mid - penalty,
    defense: avg([...g.DF.map((p) => p.def), ...g.DF.map((p) => p.def), ...g.MF.map((p) => p.def)]) + f.def + m.def + ln.def - penalty,
    keeper: avg(g.GK.map((p) => p.def), 40),
    gk: g.GK[0] || null,
    drain: pr.drain * tp.drain,
    acc: tp.acc,
    offside: ln.offside,
  }
}

const GOAL_LINES = [
  (p, t) => `⚽ 골! ${p}(${t})의 오른발 슛이 골망을 가릅니다!`,
  (p, t) => `⚽ 골! ${p}(${t}), 문전 혼전 상황에서 침착하게 밀어 넣습니다!`,
  (p, t) => `⚽ 골!! ${p}(${t})의 환상적인 중거리포!`,
  (p, t) => `⚽ 골! ${p}(${t})이(가) 헤더로 마무리합니다!`,
]
const SAVE_LINES = [(p, t) => `🧤 ${p}(${t})의 슛, 골키퍼 선방!`, (p, t) => `🧤 ${p}(${t}) 일대일 찬스! 하지만 골키퍼가 막아냅니다.`]
const MISS_LINES = [(p, t) => `${p}(${t})의 슛이 골대를 살짝 벗어납니다.`, (p, t) => `${p}(${t}), 크로스바를 넘기는 슛.`, (p, t) => `🥅 ${p}(${t})의 슛이 골대를 맞고 나옵니다!`]

function removeFromPitch(match, idx, id, minute) {
  const sd = match.sides[idx]
  const i = sd.onPitch.indexOf(id)
  if (i >= 0) { sd.onPitch = sd.onPitch.filter((_, j) => j !== i); sd.slots = sd.slots.filter((_, j) => j !== i) }
  if (match.ps[id]) match.ps[id].to = minute
}

/** 교체: 성공하면 true */
export function substitute(match, ctx, idx, outId, inId, { auto = false } = {}) {
  const sd = match.sides[idx]
  if (sd.subsLeft <= 0 || !sd.onPitch.includes(outId) || sd.onPitch.includes(inId)) return false
  if (match.ps[inId] || !available(ctx.status, inId) || sd.injured.includes(inId)) return false // 이미 뛰었거나 출전 불가
  const team = ctx.teams[idx]
  const pOut = team.players.find((p) => p.id === outId)
  const pIn = team.players.find((p) => p.id === inId)
  if (!pIn) return false
  const minute = match.minute
  sd.onPitch = sd.onPitch.map((x) => (x === outId ? inId : x))
  sd.subsLeft--
  sd.subs.push({ minute, out: outId, in: inId })
  if (match.ps[outId]) match.ps[outId].to = minute
  match.ps[inId] = emptyPs(minute)
  match.events.push({ minute, type: 'sub', team: idx, text: `🔁 ${sd.name} 교체: ${pIn.name} ↔ ${pOut?.name ?? ''}${auto ? '' : ''}` })
  return true
}

/** 교체 후보: 이 경기에 아직 안 뛰었고 출전 가능한 선수 */
export function benchOf(match, ctx, idx) {
  const sd = match.sides[idx]
  return ctx.teams[idx].players.filter((p) => !match.ps[p.id] && available(ctx.status, p.id) && !sd.injured.includes(p.id))
}

// AI 교체: 부상자는 바로, 60·70·80분에 지친 선수를 같은 포지션으로
function aiSubs(match, ctx, idx) {
  const sd = match.sides[idx]
  if (sd.subsLeft <= 0) return
  const team = ctx.teams[idx]
  const byId = Object.fromEntries(team.players.map((p) => [p.id, p]))
  const bench = () => benchOf(match, ctx, idx)
  const bestFor = (role) => bench().filter((p) => p.pos !== 'GK' || role === 'GK').sort((a, c) => playerOvrOf(c) * fitOf(c, role) - playerOvrOf(a) * fitOf(a, role))[0]
  if ([60, 70, 80].includes(match.minute)) {
    const tired = sd.onPitch.map((id) => byId[id]).filter((p) => p && p.pos !== 'GK').sort((a, b) => sd.energy[a.id] - sd.energy[b.id])[0]
    if (tired && sd.energy[tired.id] < 82) {
      const sub = bestFor(sd.slots[sd.onPitch.indexOf(tired.id)])
      if (sub) substitute(match, ctx, idx, tired.id, sub.id, { auto: true })
    }
  }
}

function injure(match, ctx, idx, rng, withEvents) {
  const sd = match.sides[idx]
  const team = ctx.teams[idx]
  const cands = sd.onPitch.map((id) => team.players.find((p) => p.id === id)).filter(Boolean)
  if (!cands.length) return null
  const p = rng.weighted(cands, cands.map((x) => (x.pos === 'GK' ? 0.3 : 1) * (1.4 - (sd.energy[x.id] ?? 100) / 100)))
  sd.injured.push(p.id)
  const games = rng.weighted([1, 2, 3, 4, 6, 10], [30, 25, 18, 12, 10, 5])
  match.injuries = [...(match.injuries || []), { id: p.id, team: idx, games, minute: match.minute }]
  if (withEvents) match.events.push({ minute: match.minute, type: 'injury', team: idx, player: p.name, text: `🚑 ${p.name}(${sd.name}) 부상! 더 뛰기 어려워 보입니다.` })
  return p
}

/** 1분 진행. 내 팀 선수가 다치면 { type: 'injury' } 를 돌려 교체 화면을 띄울 수 있게 한다. */
export function step(match, ctx, { withEvents = true } = {}) {
  const rng = rngOf(match)
  const minute = ++match.minute
  if (withEvents && minute === 46) match.events.push({ minute: 45, type: 'info', text: '후반전 시작!' })
  const r = [sideRatings(match, ctx, 0), sideRatings(match, ctx, 1)]
  const mid = [r[0].midfield + 3, r[1].midfield] // 홈 어드밴티지
  const atk = rng.random() < clamp(0.5 + (mid[0] - mid[1]) / 80, 0.2, 0.8) ? 0 : 1
  const dfn = 1 - atk
  const S = match.stats
  S[atk].poss++
  const n = 8 + Math.floor(rng.random() * 6)
  const acc = clamp(0.8 + (r[atk].midfield - r[dfn].midfield) / 200 + r[atk].acc, 0.62, 0.94)
  S[atk].passes += n
  S[atk].passesOk += Math.round(n * acc)
  const tick = { m: minute, t: atk, k: 'build' }
  if (withEvents) match.timeline.push(tick)
  const names = [match.sides[0].name, match.sides[1].name]
  let interrupt = null

  const a = r[atk].attack
  const d = r[dfn].defense

  // 슈팅: long=true면 먼 거리·수비 맞고 굴절되는 낮은 확률의 슈팅
  const shoot = (long) => {
    const shooters = r[atk].xi.filter((p) => p.pos !== 'GK')
    if (!shooters.length) return
    const w = long ? { FW: 1.2, MF: 1.7, DF: 0.6 } : { FW: 3.0, MF: 1.15, DF: 0.55 }
    const shooter = rng.weighted(shooters, shooters.map((p) => w[p.pos] * p.att * p.att / 70)) // 공격력이 높은 선수일수록 슈팅 기회가 많다
    const helpers = shooters.filter((p) => p.id !== shooter.id)
    const assister = helpers.length && rng.random() < (long ? 0.35 : 0.78) ? rng.weighted(helpers, helpers.map((p) => ({ MF: 2.2, FW: 1.6, DF: 0.7 })[p.pos] * p.att)) : null
    S[atk].shots++
    match.ps[shooter.id].sh++
    const quality = long ? 0.09 : 0.3 + (shooter.att - r[dfn].keeper) / 400 + (a - d) / 600
    const pOn = long ? 0.28 : clamp(0.45 + (shooter.att - 60) / 200, 0.25, 0.75)
    const pGoal = clamp(quality, long ? 0.04 : 0.08, 0.55)
    const xg = pOn * pGoal
    S[atk].xg += xg
    match.ps[shooter.id].xg += xg
    Object.assign(tick, { k: 'miss', p: shooter.id })
    if (rng.random() < pOn) {
      S[atk].onTarget++
      match.ps[shooter.id].sot++
      tick.k = 'save'
      if (rng.random() < pGoal) {
        tick.k = 'goal'
        match.score[atk]++
        match.ps[shooter.id].g++
        if (assister) match.ps[assister.id].a++
        for (const id of match.sides[dfn].onPitch) if (match.ps[id]) match.ps[id].conceded++
        match.scorers.push({ minute, team: atk, playerId: shooter.id, name: shooter.name, assistId: assister?.id ?? null, assistName: assister?.name ?? null })
        if (withEvents) match.events.push({ minute, type: 'goal', team: atk, player: shooter.name, assist: assister?.name, text: (long ? `⚽ 골!! ${shooter.name}(${names[atk]})의 먼 거리 슈팅이 그대로 들어갑니다!` : rng.pick(GOAL_LINES)(shooter.name, names[atk])) + (assister ? ` (도움: ${assister.name})` : ''), score: [...match.score] })
      } else {
        S[dfn].saves++
        if (r[dfn].gk) match.ps[r[dfn].gk.id].sv++
        if (assister) match.ps[assister.id].kp++
        if (rng.random() < 0.3) S[atk].corners++
        if (withEvents && !long) match.events.push({ minute, type: 'save', team: atk, text: rng.pick(SAVE_LINES)(shooter.name, names[atk]) })
      }
    } else {
      if (assister) match.ps[assister.id].kp++
      if (rng.random() < (long ? 0.3 : 0.22)) S[atk].corners++
      if (withEvents && !long && rng.random() < 0.5) match.events.push({ minute, type: 'miss', team: atk, text: rng.pick(MISS_LINES)(shooter.name, names[atk]) })
    }
  }

  if (rng.random() > 0.17 + (a - d) / 400) {
    // 결정적 찬스 없이 끝난 공격: 파울·카드, 오프사이드, 중거리 슈팅, 태클
    const x = rng.random()
    const defenders = r[dfn].xi.filter((p) => p.pos !== 'GK')
    if (x < 0.27 && defenders.length) {
      S[dfn].fouls++
      const fouler = rng.weighted(defenders, defenders.map((p) => ({ DF: 2, MF: 1.6, FW: 0.6 })[p.pos]))
      const c = rng.random()
      const sd = match.sides[dfn]
      if (c < 0.003 || (c < 0.07 && sd.yellows[fouler.id])) { // 경고 받은 선수는 조심하므로 두 번째 경고 확률이 낮다
        const second = c >= 0.003
        S[dfn].red++
        if (second) S[dfn].yellow++
        match.ps[fouler.id].rc++
        if (second) match.ps[fouler.id].yc++
        sd.sentOff.push(fouler.id)
        removeFromPitch(match, dfn, fouler.id, minute)
        Object.assign(tick, { k: 'card', p: fouler.id })
        if (withEvents) match.events.push({ minute, type: 'red', team: dfn, player: fouler.name, text: `🟥 ${fouler.name}(${names[dfn]}) 퇴장! ${second ? '경고 누적입니다.' : '위험한 태클에 곧바로 레드카드.'}` })
      } else if (c < 0.17) {
        S[dfn].yellow++
        sd.yellows[fouler.id] = 1
        match.ps[fouler.id].yc++
        Object.assign(tick, { k: 'card', p: fouler.id })
        if (withEvents) match.events.push({ minute, type: 'card', team: dfn, player: fouler.name, text: `🟨 ${fouler.name}(${names[dfn]}) 경고. 거친 태클이었습니다.` })
      }
    } else if (x < 0.27 + 0.05 * r[dfn].offside) {
      S[atk].offsides++ // 수비 라인이 높을수록 상대가 오프사이드에 자주 걸린다
    } else if (x < 0.43) {
      shoot(true)
    } else if (x < 0.75 && defenders.length) {
      const t = rng.weighted(defenders, defenders.map((p) => ({ DF: 2, MF: 1.4, FW: 0.3 })[p.pos] * p.def))
      match.ps[t.id].tk++
    }
  } else {
    shoot(false)
  }
  if (rng.random() < 0.08) S[rng.random() < 0.5 ? 0 : 1].corners++ // 크로스·클리어링에서 나오는 코너킥

  // 부상 (팀당 경기마다 약 0.3명)
  for (const idx of [0, 1]) {
    if (rng.random() < 0.0034) {
      const p = injure(match, ctx, idx, rng, withEvents)
      if (p) {
        if (idx === match.myIdx) interrupt = { type: 'injury', playerId: p.id, name: p.name }
        else {
          const role = match.sides[idx].slots[match.sides[idx].onPitch.indexOf(p.id)]
          const bench = benchOf(match, ctx, idx).filter((x) => x.pos !== 'GK' || role === 'GK')
          const sub = bench.sort((x, y) => playerOvrOf(y) * fitOf(y, role) - playerOvrOf(x) * fitOf(x, role))[0]
          if (sub && match.sides[idx].subsLeft > 0) substitute(match, ctx, idx, p.id, sub.id, { auto: true })
          else removeFromPitch(match, idx, p.id, minute)
        }
      }
    }
  }

  // 체력 소모: 압박이 강하고 지구력이 낮을수록 빨리 지친다
  for (const idx of [0, 1]) {
    const sd = match.sides[idx]
    const team = ctx.teams[idx]
    for (const id of sd.onPitch) {
      const p = team.players.find((x) => x.id === id)
      if (!p) continue
      const gk = p.pos === 'GK' ? 0.35 : 1
      sd.energy[id] = Math.max(0, sd.energy[id] - 0.4 * r[idx].drain * gk * (1.35 - p.sta / 100))
    }
    if (idx !== match.myIdx) aiSubs(match, ctx, idx)
  }

  if (withEvents && minute === 45) match.events.push({ minute: 45, type: 'info', text: `전반 종료. ${match.score[0]} : ${match.score[1]}` })
  if (withEvents && minute === 90) match.events.push({ minute: 90, type: 'info', text: `경기 종료! 최종 스코어 ${match.score[0]} : ${match.score[1]}` })
  return interrupt
}

/** toMinute까지 진행. 내 팀 부상이 나오면 그 분에서 멈춘다 */
export function advance(match, ctx, toMinute, opts) {
  while (match.minute < toMinute) {
    const it = step(match, ctx, opts)
    if (it) return it
  }
  return null
}

/** 경기 중 포메이션 변경: 뛰고 있는 선수들을 새 자리에 다시 배정 */
export function reshape(match, ctx, idx, formation) {
  const sd = match.sides[idx]
  const team = ctx.teams[idx]
  const playing = { players: sd.onPitch.map((id) => team.players.find((p) => p.id === id)).filter(Boolean) }
  const slots = buildSlots(formation).map((x) => x.role)
  const ids = assignSlots(playing, formation, { useCondition: false })
  sd.onPitch = []
  sd.slots = []
  ids.forEach((id, i) => { if (id) { sd.onPitch.push(id); sd.slots.push(slots[i]) } })
  sd.tactics = { ...sd.tactics, formation }
}

/** 내 팀이 다친 선수를 교체하지 않고 계속하면 빈 자리로 뛴다 */
export function dropInjured(match, idx, id) {
  if (match.sides[idx].onPitch.includes(id)) removeFromPitch(match, idx, id, match.minute)
}

/** 선수 평점 (6.0 기준, 3.0~10.0). 경기 중에도 지금까지 기준으로 계산할 수 있다 */
export function ratings(match, ctx) {
  const out = {}
  const [h, w] = match.score
  for (const idx of [0, 1]) {
    const team = ctx.teams[idx]
    const res = idx === 0 ? Math.sign(h - w) : Math.sign(w - h)
    for (const p of team.players) {
      const s = match.ps[p.id]
      if (!s) continue
      const mins = (s.to ?? match.minute) - s.from
      if (mins <= 0 && !s.rc) continue
      const share = clamp(mins / 90, 0.15, 1)
      let r = 6.0 + (playerOvrOf(p) - 75) / 40
      r += s.g * 1.0 + s.a * 0.7 + s.kp * 0.15 + s.sot * 0.1 + s.tk * 0.08 + s.sv * 0.35
      if (p.pos === 'GK') r -= s.conceded * 0.3
      if (p.pos === 'DF') r -= s.conceded * 0.15
      if ((p.pos === 'GK' || p.pos === 'DF') && s.conceded === 0 && mins >= 60 && match.minute >= 90) r += p.pos === 'GK' ? 0.7 : 0.5
      r += (res > 0 ? 0.3 : res < 0 ? -0.3 : 0) * share
      r -= s.yc * 0.3 + s.rc * 1.5
      r += (hash(`${match.seed}-${p.id}`) - 0.5) * 0.8
      out[p.id] = Math.round(clamp(r, 3, 10) * 10) / 10
    }
  }
  return out
}

/** 경기 종료 후 시즌 기록용 요약 */
export function summarize(match, ctx) {
  const rt = ratings(match, ctx)
  const ids = Object.keys(rt)
  const mom = ids.sort((a, b) => rt[b] - rt[a])[0] || null
  const players = {}
  for (const idx of [0, 1]) {
    const conceded = match.score[1 - idx]
    for (const p of ctx.teams[idx].players) {
      const s = match.ps[p.id]
      if (!s || rt[p.id] === undefined) continue
      const mins = (s.to ?? 90) - s.from
      players[p.id] = {
        team: idx, r: rt[p.id], g: s.g, a: s.a, yc: s.yc, rc: s.rc, min: mins,
        cs: (p.pos === 'GK' || p.pos === 'DF') && conceded === 0 && mins >= 60 ? 1 : 0,
        mom: p.id === mom ? 1 : 0,
        start: s.from === 0 ? 1 : 0,
      }
    }
  }
  const energy = {}
  for (const idx of [0, 1]) Object.assign(energy, Object.fromEntries(Object.keys(match.ps).filter((id) => ctx.teams[idx].players.some((p) => p.id === id)).map((id) => [id, match.sides[idx].energy[id]])))
  return {
    score: [...match.score],
    stats: match.stats.map((s) => ({ ...s, xg: Math.round(s.xg * 100) / 100 })),
    scorers: match.scorers,
    players,
    mom,
    injuries: match.injuries || [],
    energy,
  }
}

/** AI 경기: 이벤트 없이 90분 */
export function quickMatch(home, away, status, seed) {
  const ctx = { teams: [home, away], status }
  const match = createMatch({ home, away, seed, status })
  advance(match, ctx, 90, { withEvents: false })
  return summarize(match, ctx)
}
