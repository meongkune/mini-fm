// Mini FM 경기 엔진 v2 — 1분씩 진행한다.
// 경기 상태(match)는 순수 객체라 저장·복원이 되고, 중간에 교체·전술 변경·하프타임 지시를 넣을 수 있다.
// 팀 데이터(선수 능력치)는 상태에 넣지 않고 매번 ctx로 받는다: ctx = { teams: [home, away], status }
//   status[playerId] = { cond: 0~100(컨디션), morale: 0~100(사기), form: 평균 평점 } — 없으면 기본값
import { MENTALITY, PRESSING, playerOvrOf } from './engine.js'
import { ROLE_POS, assignSlots, buildSlots, fitOf, shapeMods } from './formation.js'
import { aiTactics, edges, tacOf } from './tactics.js'
import { CHANNEL_LABEL, aerialOf, channels } from './matchups.js'
import { attrsOf } from '../game/attributes.js'

const DEFAULT_TACTICS = { formation: '4-4-2', mentality: 'balanced', pressing: 'normal', line: 'normal', tempo: 'normal' }
// 팀 지시: 수비 라인 높이, 템포
export const LINE = { low: { mid: -3, def: 3, offside: 0.6 }, normal: { mid: 0, def: 0, offside: 1 }, high: { mid: 3, def: -2, offside: 1.7 } }
export const TEMPO = { slow: { att: -2, mid: 2, acc: 0.03, drain: 0.95 }, normal: { att: 0, mid: 0, acc: 0, drain: 1 }, fast: { att: 3, mid: -1, acc: -0.03, drain: 1.1 } }
// AI 구단 전형: 구단마다 고정 (다양한 상대를 만나도록)
const AI_SHAPES = ['4-4-2', '4-3-3', '4-2-3-1', '4-1-4-1', '3-5-2', '4-4-1-1', '4-3-3', '4-2-3-1']
export const aiFormation = (teamId) => AI_SHAPES[[...String(teamId)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AI_SHAPES.length]
export const MAX_SUBS = 5
// 전력 차가 결과에 미치는 정도 (클수록 이변이 잦다)
const HOME_ADV = 5
// 그날 컨디션(팀 전체 운)의 폭: 표준편차 약 2% (예전 3.5%는 팀 간 전력 차만큼 커서, 강팀 승률이 낮고 3골 차 대승이 실제의 1.7배였다)
const DAY_SPREAD = 0.035
// 유효슛 비율: 슛 중 골문 안으로 가는 비율을 실제(약 1/3)에 맞추고, 그만큼 유효슛이 골이 될 확률을 올린다 (득점 수는 그대로)
const ON_TARGET_K = 0.78
// 전술 효과 계수 (선수 능력 계수보다 작을수록 = 더 크게 반영)
const K_TMID = 120
const K_TCHANCE = 200
const K_TQUAL = 350
const K_POSS = 150
const K_CHANCE = 520
const K_QUAL = 800
const K_FINISH = 500
const CHANCE = 0.12
// 창의성(공격 쪽) vs 조직력(수비 쪽 전술)이 찬스 수에 미치는 정도
const K_CRE = 450
// 오픈 플레이 결정력 기본값 (세트피스 골이 생긴 만큼 낮췄다)
const OPEN_Q = 0.22
// 중거리 슈팅: 찬스 없이 끝난 공격 중 먼 거리에서 때리는 비율 · 그 슈팅의 질
//   (예전 0.158 · 0.09는 경기당 슛이 30개로 실제 25~27개보다 많았다 → 수를 줄이고 그만큼 질을 올려 중거리 골 수는 그대로)
export const SHOT_W = { open: { FW: 2.45, MF: 1.45, DF: 0.5 }, long: { FW: 1.2, MF: 1.8, DF: 0.4 }, st: 1.4, pow: 3.5 }
const LONG_SHARE = 0.115
const LONG_Q = 0.122
// 개인 매치업: 통로별 유불리(adv, 능력치 차)가 통로 선택(MU_PICK)과 찬스의 질(K_MU)에 미치는 정도
//   adv 10(1~20 척도로 3점쯤)이면 그 통로를 2배 넘게 자주 쓰고, 결정력이 +0.045(기본 0.22의 20%) 오른다
const MU_PICK = 12
const K_MU = 220
const MU_CAP = 14
// 홈 팀이 만드는 찬스 배수 (관중·익숙한 구장) — 점유(HOME_ADV)만으로는 홈 승률이 낮았다
export const HOME = { ch: 1.18 }
// 반칙 위치 비율: 박스 안(페널티킥) · 직접 프리킥 거리 · 측면 크로스 프리킥
const P_PEN = 0.015
const P_FK = 0.05
const P_FKX = 0.09
// 크로스·돌파가 수비 맞고 나가 코너킥이 되는 확률 (분당)
const P_CROSS_CORNER = 0.06

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

const emptyStats = () => ({ poss: 0, shots: 0, onTarget: 0, xg: 0, passes: 0, passesOk: 0, corners: 0, fouls: 0, offsides: 0, saves: 0, yellow: 0, red: 0, pens: 0, penGoals: 0 })
const emptyPs = (from) => ({ from, to: null, g: 0, a: 0, sh: 0, sot: 0, kp: 0, tk: 0, sv: 0, yc: 0, rc: 0, xg: 0, conceded: 0 })

/** 출전 가능 여부 (부상·징계) */
export const available = (status, id) => !(status?.[id]?.inj > 0) && !(status?.[id]?.susp > 0)

/** 컨디션·출전 가능을 고려해 포메이션 자리마다 선수를 배정 (자리 순서 = 포메이션 자리 순서) */
export function pickLineup(team, formation = '4-4-2', status = {}, { useCondition = true, keep = {} } = {}) {
  return assignSlots(team, formation, { status, useCondition, keep, available: (id) => available(status, id) }).filter(Boolean)
}

export function createMatch({ home, away, homeCfg = {}, awayCfg = {}, seed, status = {}, myIdx = null }) {
  // 리그 수준 보정: 엔진의 여러 기준(AI 전술 성향·상성 문턱)이 프리미어리그 수준의 절대값에 맞춰져 있어서, 수준이 낮은 리그는
  //   거의 모든 팀이 '약팀'으로 분류돼 수비적으로 나오고 골이 덜 나왔다 (에레디비시 2.2골 — 실제는 3골대).
  //   두 팀의 평균 수준이 기준(81)보다 낮으면 양 팀을 똑같이 올려서 본다 → 두 팀의 차이는 그대로
  const lift = Math.max(0, LEVEL_REF - (levelOf(home) + levelOf(away)) / 2)
  const sideState = (team, cfg) => {
    // 상대(AI)는 구단 고유 전형 + 전력에 맞는 스타일 (강팀: 점유·압박, 약팀: 역습·수비)
    const strength = levelOf(team) + lift
    const tactics = cfg.tactics ? { ...DEFAULT_TACTICS, ...cfg.tactics } : { ...DEFAULT_TACTICS, ...aiTactics(team, strength), formation: aiFormation(team.id) }
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
    return { teamId: team.id, name: team.short || team.name, tactics, onPitch, slots: slotRoles, vacant: [], subsLeft: MAX_SUBS, subs: [], sentOff: [], injured: [], yellows: {}, energy }
  }
  const s = seed ?? Math.floor(Math.random() * 1e9) + 1
  const match = {
    seed: s, rng: s, minute: 0, myIdx,
    plus: 0, added: [null, null], stop: 0, // 추가시간: 지금 +몇 분 · 전반/후반 추가시간 · 쌓인 지연(골·교체·부상·카드)
    teams: [home.id, away.id],
    sides: [sideState(home, homeCfg), sideState(away, awayCfg)],
    stats: [emptyStats(), emptyStats()],
    score: [0, 0],
    ps: {},
    talk: [0, 0], // 하프타임 지시 효과 (경기력 배수 보정)
    // 그날의 컨디션(운): 같은 전력이라도 경기마다 ±4% 안팎으로 달라진다 → 약팀이 이기는 날도 있다
    day: [dayForm(s, 1), dayForm(s, 2)],
    lift,
    scorers: [],
    events: [],
    timeline: [],
  }
  match.sides.forEach((sd) => sd.onPitch.forEach((id) => { match.ps[id] = emptyPs(0) }))
  match.events.push({ minute: 0, type: 'info', text: `킥오프! ${match.sides[0].name} vs ${match.sides[1].name}` })
  return match
}

const LEVEL_REF = 81
const levelOf = (team) => { const o = team.players.map(playerOvrOf).sort((a, b) => b - a).slice(0, 11); return o.length ? o.reduce((a, b) => a + b, 0) / o.length : LEVEL_REF }

// 경기마다 고정되는 '그날 컨디션' (정규분포 근사, 표준편차 약 3.5%)
function dayForm(seed, k) {
  let u = 0
  for (let i = 0; i < 4; i++) u += hash(`day-${seed}-${k}-${i}`)
  return 1 + (u - 2) * DAY_SPREAD
}

// 그 분의 선수 실효 능력치: 체력·사기(±8%)·폼(±5%)·하프타임 지시·태업·그날 컨디션
// (상대 AI는 사기·폼 기본값이라 사실상 OVR과 그날 컨디션만 반영된다)
function effFactor(match, ctx, idx, p) {
  const sd = match.sides[idx]
  const st = ctx.status?.[p.id] || {}
  const e = sd.energy[p.id] ?? 100
  return (0.8 + 0.2 * e / 100) * (0.92 + 0.16 * (st.morale ?? 50) / 100) * (1 + clamp(((st.form ?? 6.6) - 6.6) * 0.05, -0.05, 0.05)) * (1 + match.talk[idx]) * (st.sulk > 0 ? 0.94 : 1) * (match.day?.[idx] ?? 1)
}

/** 그 분의 출전 선수(실효 능력치·자리 포지션)와 포지션별 묶음 */
function xiOf(match, ctx, idx) {
  const sd = match.sides[idx]
  const team = ctx.teams[idx]
  const byId = Object.fromEntries(team.players.map((p) => [p.id, p]))
  // 자리 적합도만큼 능력치가 깎이고, 엔진에서는 '자리의' 포지션으로 뛴다
  const xi = []
  sd.onPitch.forEach((id, i) => {
    const p = byId[id]
    if (!p) return
    const fit = fitOf(p, sd.slots[i])
    const k = effFactor(match, ctx, idx, p) * fit
    // 세부 능력치(공격·기술·전술·수비·창의성 / 골키퍼: 선방·예측·빌드업·공중볼)도 같은 배수로
    const lift = match.lift || 0
    const A = {}
    const am = attrsOf(p).map
    for (const key in am) A[key] = am[key] * k + lift
    xi.push({ ...p, att: p.att * k + lift, def: p.def * k + lift, A, pos: ROLE_POS[sd.slots[i]], realPos: p.pos, slot: sd.slots[i] })
  })
  const g = Object.fromEntries(['GK', 'DF', 'MF', 'FW'].map((pos) => [pos, xi.filter((p) => p.pos === pos)]))
  return { xi, g, fwAtt: avg(g.FW.map((p) => p.att), 60), mfAtt: avg(g.MF.map((p) => p.att), 60), dfDef: avg(g.DF.map((p) => p.def), 60) }
}

/** 전술 상성 (양 팀 출전 선수 기준) — 화면 표시용으로도 쓴다 */
export function tacticalEdges(match, ctx, idx) {
  const me = xiOf(match, ctx, idx)
  const op = xiOf(match, ctx, 1 - idx)
  const sd = match.sides[idx]
  const od = match.sides[1 - idx]
  return edges({ tac: sd.tactics, formation: sd.tactics.formation, ...me }, { tac: od.tactics, formation: od.tactics.formation, ...op })
}

// ── 경기 흐름: 점수 차에 따라 그 팀이 만드는 찬스 수(ch, 배수)·찬스의 질(q, 더하기)이 달라진다 ──
//   분 단위 확률이 점수와 무관하면 두 팀 득점이 서로 독립이 되어, 한번 벌어진 경기가 그대로 더 벌어진다(대승 과다·무승부 부족).
//   실제 축구는 앞선 팀이 템포를 늦추고 공을 돌리며(찬스 감소), 뒤진 팀이 숫자를 올려 몰아붙인다(찬스 증가).
//   대신 올라온 뒤 공간으로 나가는 앞선 팀의 역습은 수는 적어도 질이 좋다. 3골 넘게 벌어지면 양쪽 모두 힘을 뺀다.
//   효과는 시간이 갈수록 커진다 (전반 초반의 한 골은 경기 운영을 거의 바꾸지 않는다)
export const FLOW = {
  lead: [0, 0.14, 0.36, 0.55], // 앞선 골 수(1·2·3+)별 찬스 감소 (경기 시작 시점)
  leadLate: 0.16, // 시간이 갈수록 더해지는 감소 (75분에 최대)
  trail: [0, 0.08, 0.14, 0.1], // 뒤진 골 수(1·2·3+)별 찬스 증가
  trailLate: 0.14,
  counter: 0.025, // 앞선 팀 역습의 질 (상대가 1~2골 뒤져 올라올 때, 후반으로 갈수록)
  levelLate: 0, // 동점으로 막판(75분 이후)에 들어갔을 때 양쪽이 몸을 사리는 정도 — 무승부가 이미 충분해 지금은 끈다
  base: 0.94, // 위 효과로 줄어든 전체 득점을 되돌리는 보정
}
function flowOf(match, idx) {
  const diff = match.score[idx] - match.score[1 - idx]
  const t = clamp((match.minute - 10) / 65, 0, 1)
  const k = Math.min(3, Math.abs(diff))
  let ch = FLOW.base
  let q = 0
  if (diff > 0) {
    ch *= 1 - FLOW.lead[k] - FLOW.leadLate * t
    if (k <= 2) q = FLOW.counter * t
  } else if (diff < 0) {
    ch *= 1 + FLOW.trail[k] + (k <= 2 ? FLOW.trailLate * t : 0)
  } else if (match.minute > 75) {
    ch *= 1 - FLOW.levelLate
  }
  return { ch, q }
}

function sideRatings(match, ctx, idx) {
  const sd = match.sides[idx]
  const { xi, g } = xiOf(match, ctx, idx)
  const f = shapeMods(sd.tactics.formation)
  const e = tacticalEdges(match, ctx, idx)
  const t = tacOf(sd.tactics)
  const missing = 11 - xi.length // 퇴장·부상으로 빈 자리
  const penalty = (g.GK.length !== 1 ? 15 : 0) + missing * 6
  // 세부 능력치를 장면별로 쓴다 (FM처럼): 데이터가 없으면 공격·수비로 추정한 값
  const at = (p, k) => p.A?.[k] ?? (k === '수비' || k === '전술' ? p.def : p.att)
  const fwAtt = g.FW.map((p) => at(p, '공격'))
  const dfDef = g.DF.map((p) => at(p, '수비') * 0.7 + at(p, '전술') * 0.3)
  const gk = g.GK[0]
  return {
    xi,
    // 공격(결정적 찬스·마무리): 공격수의 공격 + 미드필더의 공격·창의성
    attack: avg([...fwAtt, ...fwAtt, ...g.MF.map((p) => (at(p, '공격') + at(p, '창의성')) / 2)]) + f.att - penalty,
    // 중원(점유): 미드필더의 기술·전술 + 공수 능력
    midfield: avg(g.MF.map((p) => at(p, '기술') * 0.35 + at(p, '전술') * 0.3 + p.att * 0.15 + p.def * 0.2)) + f.mid - penalty,
    // 수비(찬스 억제): 수비수의 수비·전술 + 미드필더의 수비·전술
    defense: avg([...dfDef, ...dfDef, ...g.MF.map((p) => at(p, '수비') * 0.6 + at(p, '전술') * 0.4)]) + f.def - penalty,
    // 창의성 vs 수비 조직력: 결정적 찬스를 만드는 양
    create: avg([...g.MF, ...g.FW].map((p) => at(p, '창의성')), 60),
    organise: avg([...g.DF, ...g.MF.filter((p) => p.slot === 'DM' || p.slot === 'CM')].map((p) => at(p, '전술')), 60),
    // 패스 정확도: 미드필더 기술
    passTech: avg(g.MF.map((p) => at(p, '기술')), 65),
    // 전술 — 선수 능력보다 크게 반영 (약팀도 전술로 뒤집을 수 있게). 점수 차에 따른 경기 흐름은 flowOf에서 따로 건다
    tAtt: e.att,
    tMid: e.mid,
    tDef: e.def,
    notes: e.notes,
    keeper: gk ? (gk.A?.['선방'] != null ? gk.A['선방'] * 0.6 + gk.A['예측'] * 0.25 + gk.A['공중볼'] * 0.15 : gk.def) : 40,
    gk: g.GK[0] || null,
    drain: (0.6 + t.press * 0.008) * (0.9 + t.tempo * 0.002), // 압박·템포가 높을수록 빨리 지친다
    acc: ((50 - t.tempo) / 50) * 0.03 - ((t.passing - 50) / 50) * 0.04,
    offside: e.offside,
    chance: e.chance,
    quality: e.quality,
    foul: e.foul,
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
  match.stop = (match.stop || 0) + 0.3
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

// ── AI 감독: 경기 중 판단 ──
// 구단마다 감독 성향을 해시로 고정한다 (같은 구단은 늘 같은 성향)
export const aiStyle = (teamId) => ['attacking', 'balanced', 'pragmatic'][Math.floor(hash(`style-${teamId}`) * 3)]
export const AI_STYLE = {
  attacking: ['공격적', '지고 있으면 일찍 올라오고, 앞서도 늦게까지 잠그지 않는다'],
  balanced: ['균형', '점수와 시간에 맞춰 무난하게 운영한다'],
  pragmatic: ['실리적', '앞서면 일찍 내려앉아 지키고, 무리하게 올라오지 않는다'],
}
// 판단 시점 (퇴장 대응은 그 즉시)
const AI_MINUTES = [46, 55, 62, 70, 78, 85]
const STANCE_TEXT = { 2: '총공세에 나섭니다', 1: '라인을 올리고 공격 숫자를 늘립니다', 0: '원래 전술로 돌아갑니다', '-1': '내려앉아 지키는 쪽으로 바꿉니다', '-2': '전원 수비로 잠급니다' }

// 점수·시간·성향·전력 차 → 운영 단계 (-2 잠그기 ~ +2 총공세)
function aiStance(match, ctx, idx, style) {
  const m = match.minute
  const diff = match.score[idx] - match.score[1 - idx]
  let s = 0
  if (diff < 0) {
    if (diff > -3) s = m >= 78 ? 2 : m >= (style === 'attacking' ? 46 : style === 'balanced' ? 55 : 62) ? 1 : 0 // 3골 넘게 지면 체념
  } else if (diff > 0) {
    const hold = style === 'pragmatic' ? 55 : style === 'balanced' ? 70 : 80
    if (m >= hold) s = m >= 85 || (style === 'pragmatic' && m >= 78) ? -2 : -1
    if (diff >= 3) s = Math.max(s, -1)
  } else if (m >= 70) {
    // 동점: 전력이 앞서면 이기러 가고, 밀리면 승점 1을 지킨다
    const gap = levelOf(ctx.teams[idx]) - levelOf(ctx.teams[1 - idx])
    s = gap >= 3 ? 1 : gap <= -3 ? (style === 'attacking' ? 0 : -1) : style === 'attacking' ? 1 : 0
  }
  // 한 명 부족하면 한 단계 내려서 운영한다 (막판에 지고 있을 때만 그대로 올라간다)
  if (match.sides[idx].sentOff.length && !(diff < 0 && m >= 78)) s -= 1
  return clamp(s, -2, 2)
}

// 상대 전술에 맞춘 대응: 지시 하나를 바꿔 봤을 때 상성(내 공격−상대 수비, 상대 공격−내 수비, 중원)이 가장 좋아지는 것을 고른다
const AI_TWEAKS = [
  ['line', 32, '라인을 내려 뒷공간을 지웁니다'], ['line', 72, '라인을 올려 상대를 가둡니다'],
  ['pressing', 78, '전방 압박을 강화합니다'], ['pressing', 38, '압박을 풀고 자리를 지킵니다'],
  ['passing', 78, '길게 넘겨 압박을 건너뜁니다'], ['passing', 28, '짧게 풀어 나옵니다'],
  ['width', 80, '측면을 넓게 씁니다'], ['width', 40, '중앙으로 좁혀 들어갑니다'],
]
function aiAdapt(match, ctx, idx, ai, withEvents) {
  const sd = match.sides[idx]
  const od = match.sides[1 - idx]
  const me = xiOf(match, ctx, idx)
  const op = xiOf(match, ctx, 1 - idx)
  const score = (tac) => {
    const A = { tac, formation: sd.tactics.formation, ...me }
    const B = { tac: od.tactics, formation: od.tactics.formation, ...op }
    const x = edges(A, B)
    const y = edges(B, A)
    return (x.att - y.def) - (y.att - x.def) + (x.mid - y.mid) * 0.6 + (x.chance - y.chance) * 150 + (x.quality - y.quality) * 100
  }
  const now = score(ai.base)
  let best = null
  for (const [key, v, text] of AI_TWEAKS) {
    const cur = tacOf(ai.base)[key === 'pressing' ? 'press' : key]
    if (Math.abs(cur - v) < 15) continue
    // 압박을 올리면 체력이 빨리 닳는다 (상성 점수에는 안 잡히는 비용)
    const gain = score({ ...ai.base, [key]: v }) - now - (key === 'pressing' && v > cur ? 1.5 : 0)
    if (gain >= 4 && (!best || gain > best.gain)) best = { key, v, text, gain }
  }
  if (!best) return
  ai.base = { ...ai.base, [best.key]: best.v }
  if (withEvents) match.events.push({ minute: match.minute, type: 'info', team: idx, text: `🧠 ${sd.name} 벤치: 상대 전술에 맞춰 ${best.text}.` })
}

function aiManage(match, ctx, idx, withEvents) {
  const sd = match.sides[idx]
  const team = ctx.teams[idx]
  const byId = Object.fromEntries(team.players.map((p) => [p.id, p]))
  const style = aiStyle(team.id)
  const ai = (sd.ai ??= { base: { ...sd.tactics }, stance: 0, reds: 0, flags: {} })
  const say = (text) => { if (withEvents) match.events.push({ minute: match.minute, type: 'info', team: idx, text: `🧠 ${sd.name} 벤치: ${text}` }) }
  const bench = () => benchOf(match, ctx, idx)
  const value = (p, role) => playerOvrOf(p) * fitOf(p, role)
  const bestFor = (role) => bench().filter((p) => (p.pos === 'GK') === (role === 'GK')).sort((a, c) => value(c, role) - value(a, role))[0]
  const roleAtIdx = (i) => sd.slots[i]
  const pitch = () => sd.onPitch.map((id, i) => ({ p: byId[id], i, role: roleAtIdx(i) })).filter((x) => x.p)
  // 교체하면서 그 자리의 역할도 바꾼다 (공격수 자리를 수비형 미드 자리로 등)
  const swapIn = (out, sub, role) => {
    const i = sd.onPitch.indexOf(out.id)
    if (!substitute(match, ctx, idx, out.id, sub.id, { auto: true })) return false
    if (role) sd.slots = sd.slots.map((r, j) => (j === i ? role : r))
    return true
  }
  // 뺄 공격 자원: 투톱 중 한 명 → 공격형 미드 → 윙어 → 측면 미드 (원톱은 남긴다)
  const spareAttacker = () => {
    const on = pitch()
    const sts = on.filter((x) => x.role === 'ST')
    for (const group of [sts.length >= 2 ? sts : [], on.filter((x) => x.role === 'AM'), on.filter((x) => x.role === 'LW' || x.role === 'RW'), on.filter((x) => x.role === 'LM' || x.role === 'RM')]) {
      if (group.length) return [...group].sort((a, b) => playerOvrOf(a.p) * (0.8 + 0.2 * sd.energy[a.p.id] / 100) - playerOvrOf(b.p) * (0.8 + 0.2 * sd.energy[b.p.id] / 100))[0]
    }
    return null
  }

  // 1) 퇴장 대응 (그 즉시): 수비수·미드필더·골키퍼가 나갔으면 공격 자원을 빼고 그 자리를 메운다
  while (ai.reds < sd.sentOff.length) {
    const role = sd.lostRoles?.[ai.reds]
    ai.reds++
    if (!role || ROLE_POS[role] === 'FW' || role === 'AM') continue
    const out = role === 'GK' ? (spareAttacker() || pitch().filter((x) => x.role !== 'GK').sort((a, b) => playerOvrOf(a.p) - playerOvrOf(b.p))[0]) : spareAttacker()
    if (!out) continue
    const sub = sd.subsLeft > 0 ? bestFor(role) : null
    if (sub && swapIn(out.p, sub, role)) say(`퇴장에 대응해 ${out.p.name}을(를) 빼고 ${sub.name}(으)로 빈 자리를 메웁니다.`)
    else if (ROLE_POS[role] === 'MF') { sd.slots = sd.slots.map((r, j) => (j === out.i ? role : r)); say(`퇴장에 대응해 ${out.p.name}을(를) 중원으로 내립니다.`) }
  }

  if (match.plus || !AI_MINUTES.includes(match.minute)) return
  const m = match.minute
  // 2) 상대 전술 대응: 하프타임과 70분에 한 번씩 다시 본다
  if (m === 46 || m === 70) aiAdapt(match, ctx, idx, ai, withEvents)
  // 3) 점수·시간에 따른 운영: 기본 전술(base)에서 단계만큼 옮긴다
  const s = aiStance(match, ctx, idx, style)
  const b = tacOf(ai.base)
  sd.tactics = {
    ...sd.tactics, ...ai.base, formation: sd.tactics.formation,
    mentality: clamp(b.mentality + s * 14, 5, 95), line: clamp(b.line + s * 10, 10, 90),
    pressing: clamp(b.press + s * (s > 0 ? 10 : 8), 10, 95), tempo: clamp(b.tempo + s * (s > 0 ? 8 : 10), 10, 90),
  }
  if (s !== ai.stance) { say(`${STANCE_TEXT[s]}.`); ai.stance = s }

  // 4) 교체
  if (m < 55 || sd.subsLeft <= 0) return
  // 경고 받은 수비수·수비형 미드: 퇴장 위험을 줄인다 (대체 선수가 크게 떨어지지 않을 때, 경기당 한 번)
  //   지고 있을 때는 교체 카드를 공격에 쓴다. 실리적인 감독은 일찍, 나머지는 70분 이후에만
  if (!ai.flags.yc && m <= 78 && match.score[idx] >= match.score[1 - idx] && (style === 'pragmatic' || m >= 70)) {
    const risky = pitch().filter((x) => sd.yellows[x.p.id] && (ROLE_POS[x.role] === 'DF' || x.role === 'DM')).sort((a, c) => sd.energy[a.p.id] - sd.energy[c.p.id])[0]
    const sub = risky && bestFor(risky.role)
    if (sub && value(sub, risky.role) >= value(risky.p, risky.role) * (style === 'pragmatic' ? 0.9 : 0.94) && swapIn(risky.p, sub)) { ai.flags.yc = 1; say(`경고가 있는 ${risky.p.name}을(를) 미리 뺍니다.`) }
  }
  // 승부수: 지고 있으면 수비 자원을 빼고 공격수를, 앞서면 공격 자원을 빼고 수비형 미드를 넣는다 (각각 경기당 한 번)
  if (s >= 1 && m >= 62 && !ai.flags.chase && sd.subsLeft > 0) {
    const on = pitch()
    const cbs = on.filter((x) => x.role === 'CB')
    const dms = on.filter((x) => x.role === 'DM')
    const cms = on.filter((x) => x.role === 'CM')
    const group = dms.length ? dms : cbs.length >= 3 ? cbs : cms.length >= 3 ? cms : []
    const out = [...group].sort((a, c) => playerOvrOf(a.p) - playerOvrOf(c.p))[0]
    const sub = out && bench().filter((p) => p.pos === 'FW').sort((a, c) => c.att - a.att)[0]
    if (sub && swapIn(out.p, sub, 'ST')) { ai.flags.chase = 1; say(`${out.p.name}을(를) 빼고 공격수 ${sub.name}을(를) 투입합니다.`) }
  }
  if (s <= -1 && m >= 70 && !ai.flags.hold && sd.subsLeft > 0) {
    const out = spareAttacker()
    const sub = out && bench().filter((p) => p.pos !== 'GK' && p.pos !== 'FW').sort((a, c) => value(c, 'DM') * c.def - value(a, 'DM') * a.def)[0]
    if (sub && swapIn(out.p, sub, 'DM')) { ai.flags.hold = 1; say(`${out.p.name}을(를) 빼고 ${sub.name}(으)로 중원을 두껍게 합니다.`) }
  }
  // 지친 선수: 같은 자리로 (70분 이후에는 한 번에 두 명까지)
  for (let k = 0; k < (m >= 70 ? 2 : 1) && sd.subsLeft > 0; k++) {
    const tired = pitch().filter((x) => x.role !== 'GK').sort((a, c) => sd.energy[a.p.id] - sd.energy[c.p.id])[0]
    if (!tired || sd.energy[tired.p.id] >= (m >= 70 ? 84 : 80)) break
    const sub = bestFor(tired.role)
    if (!sub || !swapIn(tired.p, sub)) break
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
  const kinds = games <= 1 ? ['타박상', '가벼운 발목 염좌', '근육 경련'] : games <= 3 ? ['햄스트링 부상', '종아리 근육 부상', '발목 염좌'] : games <= 6 ? ['허벅지 근육 파열', '무릎 인대 부상', '사타구니 부상'] : ['무릎 인대 파열', '발 골절']
  const kind = rng.pick(kinds)
  match.injuries = [...(match.injuries || []), { id: p.id, team: idx, games, minute: match.minute, kind }]
  if (withEvents) match.events.push({ minute: match.minute, type: 'injury', team: idx, player: p.name, text: `🚑 ${p.name}(${sd.name}) 부상! 더 뛰기 어려워 보입니다.` })
  return p
}

// ── 세트피스 ──
// 공중볼(aerialOf)은 matchups.js
// 킥 능력(코너·프리킥): 기술·창의성 / 페널티: 결정력(공격)·기술
const kickOf = (p) => { const a = p.A || attrsOf(p).map; return ((a['기술'] ?? p.att) + (a['창의성'] ?? p.att)) / 2 }
const penOf = (p) => p.att * 0.6 + kickOf(p) * 0.4
// 코너킥 루틴 vs 상대 코너 수비 → 슈팅으로 이어질 확률 보정
//   니어 포스트는 지역 방어의 앞 공간을, 파 포스트는 대인 방어의 높이 싸움을 노린다
export const CORNER_EDGE = {
  near: { zonal: 0.06, man: -0.02, mixed: 0.02 },
  far: { zonal: -0.02, man: 0.06, mixed: 0.02 },
  short: { zonal: 0, man: 0, mixed: 0 },
  mixed: { zonal: 0.015, man: 0.015, mixed: 0.01 },
}

/** 세트피스 키커: 전술에서 정한 선수(뛰고 있으면) → 없으면 킥 능력이 가장 좋은 선수 */
export function autoTaker(players, kind = 'sp') {
  const field = players.filter((p) => p.pos !== 'GK')
  const score = kind === 'pen' ? penOf : kickOf
  return [...field].sort((a, b) => score(b) - score(a))[0] || null
}
function takerOf(match, idx, xi, kind) {
  const want = kind === 'pen' ? match.sides[idx].tactics.penTaker : match.sides[idx].tactics.spTaker
  return xi.find((p) => p.id === want && p.pos !== 'GK') || autoTaker(xi, kind)
}

/** 전반(1)·후반(2)이 추가시간까지 끝났는가 */
export function halfOver(match, h) {
  const end = h === 1 ? 45 : 90
  if (match.minute > end) return true
  return match.minute === end && match.added?.[h - 1] != null && match.plus >= match.added[h - 1]
}
/** 화면 표시용 시간: 45+2 */
export const clockText = (minute, plus) => (plus ? `${minute}+${plus}` : `${minute}`)

/**
 * 1분(추가시간이면 +1분) 진행. 내 팀 선수가 다치면 { type: 'injury' } 를 돌려 교체 화면을 띄울 수 있게 한다.
 * 한 분 안에서 장면(timeline tick)이 여러 개 나올 수 있다: 슈팅 → 선방 → 코너킥 → 헤더 골
 * 장면마다 그때의 스코어(sc)·이벤트 수(n)를 기록해 두어, 화면이 장면을 차례로 보여줄 때 결과를 미리 보여주지 않는다
 */
export function step(match, ctx, { withEvents = true } = {}) {
  const rng = rngOf(match)
  // 시계: 45·90분이 되면 추가시간(plus)을 센다
  const endIdx = match.minute === 45 ? 0 : match.minute === 90 ? 1 : -1
  if (endIdx >= 0 && match.added?.[endIdx] != null && match.plus < match.added[endIdx]) match.plus++
  else { match.minute++; match.plus = 0 }
  const minute = match.minute
  const ev0 = match.events.length
  const sc0 = match.scorers.length
  if (withEvents && minute === 46 && !match.plus) match.events.push({ minute: 45, type: 'info', text: '후반전 시작!' })
  const r = [sideRatings(match, ctx, 0), sideRatings(match, ctx, 1)]
  const mid = [r[0].midfield + HOME_ADV, r[1].midfield] // 홈 어드밴티지
  const atk = rng.random() < clamp(0.5 + (mid[0] - mid[1]) / K_POSS + (r[0].tMid - r[1].tMid) / K_TMID, 0.22, 0.78) ? 0 : 1
  const dfn = 1 - atk
  const S = match.stats
  S[atk].poss++
  const n = 8 + Math.floor(rng.random() * 6)
  const acc = clamp(0.8 + (r[atk].midfield - r[dfn].midfield) / 200 + (r[atk].passTech - 70) / 400 + r[atk].acc, 0.62, 0.94)
  S[atk].passes += n
  S[atk].passesOk += Math.round(n * acc)
  const names = [match.sides[0].name, match.sides[1].name]
  let interrupt = null

  // 장면: 새 장면을 열기 전에 앞 장면의 결과(스코어·이벤트 수)를 봉인한다
  let tick = null
  const seal = () => { if (tick) Object.assign(tick, { sc: [...match.score], n: match.events.length, gs: match.scorers.length }) }
  const scene = (t) => {
    seal()
    // sc0·n0·gs0 = 장면 시작 전 값 (화면은 장면이 끝날 무렵에야 결과를 드러낸다)
    tick = { m: minute, plus: match.plus, t: atk, i: match.timeline.length, sc0: [...match.score], n0: match.events.length, gs0: match.scorers.length, ...t }
    if (withEvents) match.timeline.push(tick)
    return tick
  }
  scene({ k: 'build' })
  const say = (e) => { if (withEvents) match.events.push({ minute, team: atk, ...e }) }
  // 중계 문구 고르기: 난수를 쓰지 않는다 (문구 때문에 경기 결과가 달라지지 않게)
  const line = (arr, id) => arr[Math.floor(hash(`txt-${match.seed}-${minute}-${match.plus}-${id}`) * arr.length)]

  const a = r[atk].attack
  const d = r[dfn].defense
  const tEdge = r[atk].tAtt - r[dfn].tDef // 전술 상성 (공격 쪽 전술 - 수비 쪽 전술)
  const flow = flowOf(match, atk) // 점수 차에 따른 경기 흐름 (이 분이 시작될 때의 점수 기준)
  const lanes = channels(r[atk].xi, r[dfn].xi, tacOf(match.sides[atk].tactics)) // 개인 매치업 (공격 팀 → 수비 팀)
  const keeper = r[dfn].keeper
  const gkAttr = r[dfn].gk ? r[dfn].gk.A || attrsOf(r[dfn].gk).map : null

  // 슈팅 판정 (오픈 플레이·세트피스 공통): 'goal' | 'save' | 'miss'
  const resolve = ({ shooter, assister, pOn, pGoal, how }) => {
    if (how !== 'pen') { const g = pOn * pGoal; pOn *= ON_TARGET_K; pGoal = Math.min(0.75, g / pOn) }
    S[atk].shots++
    match.ps[shooter.id].sh++
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
        match.stop += 0.5
        match.ps[shooter.id].g++
        if (assister) match.ps[assister.id].a++
        for (const id of match.sides[dfn].onPitch) if (match.ps[id]) match.ps[id].conceded++
        match.scorers.push({ minute, team: atk, playerId: shooter.id, name: shooter.name, assistId: assister?.id ?? null, assistName: assister?.name ?? null, how })
        return 'goal'
      }
      S[dfn].saves++
      if (r[dfn].gk) match.ps[r[dfn].gk.id].sv++
      if (assister) match.ps[assister.id].kp++
      return 'save'
    }
    if (assister) match.ps[assister.id].kp++
    return 'miss'
  }
  const goalEvent = (text, shooter, assister) => say({ type: 'goal', player: shooter.name, assist: assister?.name, text: text + (assister ? ` (도움: ${assister.name})` : ''), score: [...match.score] })
  const field = (idx) => r[idx].xi.filter((p) => p.pos !== 'GK')

  // 코너킥·크로스 프리킥: 키커의 킥 + 공중볼 싸움(공격 4명 vs 수비 5명 + 골키퍼) + 루틴 상성
  const aerialPlay = (sp) => {
    const xa = field(atk)
    const xd = field(dfn)
    if (xa.length < 2) return
    const taker = takerOf(match, atk, r[atk].xi, 'sp')
    if (sp === 'corner') S[atk].corners++
    scene({ k: 'clear', sp, p: taker.id, kt: taker.id, side: rng.random() < 0.5 ? -1 : 1 })
    const routine = sp === 'corner' ? match.sides[atk].tactics.corner || 'mixed' : 'mixed'
    const mark = match.sides[dfn].tactics.cornerDef || 'zonal'
    const top = (arr, k) => arr.map(aerialOf).sort((x, y) => y - x).slice(0, k)
    const targets = xa.filter((p) => p.id !== taker.id)
    const aAir = avg(top(targets, 4), 60)
    const dAir = avg(top(xd, 5), 60)
    const airDiff = (aAir - dAir) * (mark === 'man' ? 1.3 : mark === 'zonal' ? 0.75 : 1) - ((gkAttr?.['공중볼'] ?? 60) - 70) * 0.3
    let pShot = (sp === 'corner' ? 0.33 : 0.24) + (kickOf(taker) - 72) / 250 + airDiff / 120 + (CORNER_EDGE[routine]?.[mark] ?? 0)
    if (routine === 'short') pShot -= 0.1
    if (rng.random() >= clamp(pShot, 0.1, 0.5)) {
      if (hash(`c-${match.seed}-${minute}-${match.plus}`) < 0.25 && withEvents) say({ type: 'chance', text: `${sp === 'corner' ? '🚩 코너킥' : '🎯 프리킥 크로스'}, ${names[dfn]} 수비가 걷어냅니다.` })
      return
    }
    let shooter
    let pOn
    let pGoal
    if (routine === 'short') {
      // 짧게 주고 받아 박스 앞에서 슈팅
      shooter = rng.weighted(targets, targets.map((p) => ({ FW: 2, MF: 2.2, DF: 0.5 })[p.pos] * p.att))
      pOn = 0.42
      pGoal = clamp(0.17 + (shooter.att - keeper) / 400, 0.07, 0.3)
    } else {
      shooter = rng.weighted(targets, targets.map((p) => Math.max(1, aerialOf(p) - 40) ** 2))
      const edge = aerialOf(shooter) - dAir
      pOn = clamp(0.36 + edge / 200, 0.22, 0.55)
      pGoal = clamp(0.22 + edge / 180 - (keeper - 70) / 400, 0.08, 0.4)
    }
    const res = resolve({ shooter, assister: taker, pOn, pGoal, how: sp })
    const what = sp === 'corner' ? '코너킥' : '프리킥'
    const head = routine === 'short' ? '슈팅' : '헤더'
    if (res === 'goal') goalEvent(`⚽ 골!! ${what}에서 ${shooter.name}(${names[atk]})의 ${head}!`, shooter, taker)
    else if (res === 'save') { say({ type: 'save', text: `🧤 ${what}에서 ${shooter.name}(${names[atk]})의 ${head}, 골키퍼가 쳐냅니다!` }); tick.r = 'gk' }
    else { say({ type: 'miss', text: `${what}에서 ${shooter.name}(${names[atk]})의 ${head}가 골대를 벗어납니다.` }); tick.r = 'goalkick' }
  }

  // 직접 프리킥: 키커의 킥 vs 골키퍼
  const directFk = () => {
    const taker = takerOf(match, atk, r[atk].xi, 'sp')
    if (!taker) return
    scene({ k: 'miss', sp: 'fk', p: taker.id, kt: taker.id, side: rng.random() < 0.5 ? -1 : 1 })
    const kick = kickOf(taker)
    const pOn = clamp(0.36 + (kick - 75) / 300, 0.25, 0.5)
    const pGoal = clamp(0.15 + (kick - 75) / 150 - ((gkAttr?.['선방'] ?? keeper) - 70) / 300, 0.06, 0.32)
    const res = resolve({ shooter: taker, assister: null, pOn, pGoal, how: 'fk' })
    if (res === 'goal') goalEvent(`⚽ 프리킥 골!! ${taker.name}(${names[atk]})의 킥이 벽을 넘어 그대로 꽂힙니다!`, taker, null)
    else if (res === 'save') { say({ type: 'save', text: `🧤 ${taker.name}(${names[atk]})의 직접 프리킥, 골키퍼가 막아냅니다!` }); tick.r = 'gk' }
    else { say({ type: 'miss', text: `🎯 ${taker.name}(${names[atk]})의 직접 프리킥이 벽에 막힙니다.` }); tick.r = 'goalkick' }
  }

  // 페널티킥: 키커(결정력·기술) vs 골키퍼(선방) — 평균 성공률 약 76%
  const penalty = (fouler) => {
    const taker = takerOf(match, atk, r[atk].xi, 'pen')
    if (!taker) return
    S[atk].pens++
    match.stop += 0.5
    say({ type: 'pen', text: `⚠️ 페널티킥! ${fouler.name}(${names[dfn]})의 박스 안 반칙. 키커는 ${taker.name}.` })
    scene({ k: 'miss', sp: 'pen', p: taker.id, kt: taker.id, side: rng.random() < 0.5 ? -1 : 1 })
    const p = clamp(0.76 + (penOf(taker) - 75) / 250 - ((gkAttr?.['선방'] ?? keeper) - 75) / 300, 0.6, 0.9)
    const res = resolve({ shooter: taker, assister: null, pOn: 0.93, pGoal: clamp(p / 0.93, 0, 0.97), how: 'pen' })
    if (res === 'goal') { S[atk].penGoals++; goalEvent(`⚽ 골!! ${taker.name}(${names[atk]})가 페널티킥을 침착하게 성공시킵니다!`, taker, null) }
    else if (res === 'save') { say({ type: 'save', text: `🧤 막았습니다! ${names[dfn]} 골키퍼가 ${taker.name}의 페널티킥을 쳐냅니다!` }); tick.r = 'gk' }
    else { say({ type: 'miss', text: `😱 ${taker.name}(${names[atk]})의 페널티킥이 골대를 벗어납니다!` }); tick.r = 'goalkick' }
  }

  // 오픈 플레이 슈팅: long=true면 먼 거리·수비 맞고 굴절되는 낮은 확률의 슈팅
  const shoot = (long) => {
    const shooters = field(atk)
    if (!shooters.length) return
    const w = long ? SHOT_W.long : SHOT_W.open
    // 공격력이 높은 선수일수록 슈팅 기회가 많다. 박스 안 찬스는 중앙 공격수(ST)에게 더 몰린다 → 득점왕이 실제처럼 25~30골
    // 개인 매치업: 찬스가 어느 통로(왼쪽·오른쪽·중앙·공중볼)에서 났는가 — 전술이 그 통로를 쓰는 비중 × 그 통로의 유불리
    const ch = !long && lanes.length ? rng.weighted(lanes, lanes.map((c) => c.w * Math.exp(c.adv / MU_PICK))) : null
    const wide = ch && (ch.key === 'left' || ch.key === 'right') ? ch.a.id : null // 그 측면을 뚫은 선수
    const shooter = rng.weighted(shooters, shooters.map((p) => w[p.pos] * (!long && p.slot === 'ST' ? SHOT_W.st : 1) * (p.att / 70) ** SHOT_W.pow))
    const helpers = shooters.filter((p) => p.id !== shooter.id)
    const assister = helpers.length && rng.random() < (long ? 0.35 : 0.78) ? rng.weighted(helpers, helpers.map((p) => ({ MF: 2.2, FW: 1.6, DF: 0.7 })[p.pos] * p.att * (p.id === wide ? 3 : 1))) : null
    if (ch) tick.ch = ch.key
    const quality = long ? LONG_Q : OPEN_Q + flow.q + (ch ? clamp(ch.adv, -MU_CAP, MU_CAP) / K_MU : 0) + ((shooter.A?.['공격'] ?? shooter.att) - keeper) / K_FINISH + (a - d) / K_QUAL + tEdge / K_TQUAL + r[atk].quality
    const pOn = long ? 0.28 : clamp(0.45 + (shooter.att - 60) / 200, 0.25, 0.75)
    const pGoal = clamp(quality, long ? 0.04 : 0.08, 0.55)
    const res = resolve({ shooter, assister, pOn, pGoal, how: long ? 'long' : 'open' })
    if (res === 'goal') {
      goalEvent(long ? `⚽ 골!! ${shooter.name}(${names[atk]})의 먼 거리 슈팅이 그대로 들어갑니다!` : line(GOAL_LINES, shooter.id)(shooter.name, names[atk]), shooter, assister)
    } else if (res === 'save') {
      if (withEvents && !long) say({ type: 'save', text: line(SAVE_LINES, shooter.id)(shooter.name, names[atk]) })
      if (rng.random() < 0.3) aerialPlay('corner') // 골키퍼가 쳐내 코너킥
      else tick.r = 'gk'
    } else {
      if (hash(`m-${match.seed}-${minute}-${match.plus}`) < 0.5 && withEvents && !long) say({ type: 'miss', text: line(MISS_LINES, shooter.id)(shooter.name, names[atk]) })
      if (rng.random() < (long ? 0.3 : 0.22)) aerialPlay('corner') // 수비 맞고 나가 코너킥
      else tick.r = 'goalkick'
    }
  }

  if (rng.random() > (CHANCE * (0.84 + 0.32 * Math.min(1, minute / 90)) + r[atk].chance + (a - d) / K_CHANCE + (r[atk].create - r[dfn].organise) / K_CRE + tEdge / K_TCHANCE) * flow.ch * (atk === 0 ? HOME.ch : 1)) {
    // 결정적 찬스 없이 끝난 공격: 파울(→ 프리킥·페널티킥), 오프사이드, 중거리 슈팅, 태클, 크로스 → 코너킥
    const x = rng.random()
    const defenders = field(dfn)
    if (x < 0.24 * r[dfn].foul && defenders.length) {
      S[dfn].fouls++
      const fouler = rng.weighted(defenders, defenders.map((p) => ({ DF: 2, MF: 1.6, FW: 0.6 })[p.pos]))
      // 반칙 위치: 박스 안(페널티킥) · 슈팅 거리(직접 프리킥) · 측면(크로스 프리킥) · 그 밖(그냥 재개)
      const z = rng.random()
      const zone = z < P_PEN ? 'pen' : z < P_PEN + P_FK ? 'fk' : z < P_PEN + P_FK + P_FKX ? 'fkx' : 'mid'
      const c = rng.random()
      const sd = match.sides[dfn]
      const yellowAt = zone === 'pen' ? 0.4 : 0.195
      if (c < 0.0015 || (c < 0.035 && sd.yellows[fouler.id])) { // 경고 받은 선수는 조심하므로 두 번째 경고 확률이 낮다
        const second = c >= 0.0015
        S[dfn].red++
        if (second) S[dfn].yellow++
        match.ps[fouler.id].rc++
        if (second) match.ps[fouler.id].yc++
        sd.sentOff.push(fouler.id)
        sd.lostRoles = [...(sd.lostRoles || []), sd.slots[sd.onPitch.indexOf(fouler.id)]] // AI 감독이 빈 자리를 메울 때 쓴다
        removeFromPitch(match, dfn, fouler.id, minute)
        match.stop += 0.5
        Object.assign(tick, { k: 'card', p: fouler.id })
        if (withEvents) match.events.push({ minute, type: 'red', team: dfn, player: fouler.name, text: `🟥 ${fouler.name}(${names[dfn]}) 퇴장! ${second ? '경고 누적입니다.' : '위험한 태클에 곧바로 레드카드.'}` })
      } else if (c < yellowAt) {
        S[dfn].yellow++
        sd.yellows[fouler.id] = 1
        match.ps[fouler.id].yc++
        match.stop += 0.2
        Object.assign(tick, { k: 'card', p: fouler.id })
        if (withEvents) match.events.push({ minute, type: 'card', team: dfn, player: fouler.name, text: `🟨 ${fouler.name}(${names[dfn]}) 경고. ${zone === 'pen' ? '박스 안에서 무리한 태클이었습니다.' : '거친 태클이었습니다.'}` })
      }
      if (zone === 'pen') penalty(fouler)
      else if (zone === 'fk') directFk()
      else if (zone === 'fkx') aerialPlay('fkx')
      else tick.r = 'fk'
    } else if (x < 0.24 * r[dfn].foul + 0.032 * r[dfn].offside) {
      S[atk].offsides++ // 수비 라인이 높을수록 상대가 오프사이드에 자주 걸린다
      tick.r = 'offside'
    } else if (x < 0.24 + 0.032 + LONG_SHARE) {
      shoot(true)
    } else if (x < 0.75 && defenders.length) {
      const t = rng.weighted(defenders, defenders.map((p) => ({ DF: 2, MF: 1.4, FW: 0.3 })[p.pos] * p.def))
      match.ps[t.id].tk++
    }
  } else {
    shoot(false)
  }
  if (rng.random() < P_CROSS_CORNER) aerialPlay('corner') // 크로스·돌파가 수비 맞고 나가 코너킥
  // 아무 일 없이 끝난 장면은 가끔 스로인으로 끊긴다 (화면 연출만, 결과에는 영향 없음)
  if (tick.k === 'build' && !tick.r && hash(`throw-${match.seed}-${minute}-${match.plus}`) < 0.32) tick.r = 'throw'

  // 부상 (팀당 경기마다 약 0.3명)
  for (const idx of [0, 1]) {
    if (rng.random() < 0.0034) {
      const p = injure(match, ctx, idx, rng, withEvents)
      if (p) {
        match.stop += 1
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
    if (idx !== match.myIdx) aiManage(match, ctx, idx, withEvents)
  }

  // 추가시간: 그 하프에 골·교체·부상·카드가 많을수록 길다 (45·90분이 끝날 때 정한다)
  if (!match.plus && (minute === 45 || minute === 90)) {
    const h = minute === 45 ? 0 : 1
    if (match.added[h] == null) {
      const noise = hash(`added-${match.seed}-${h}`)
      match.added[h] = h === 0 ? clamp(Math.round(1 + match.stop * 0.8 + noise * 1.5), 1, 6) : clamp(Math.round(2 + match.stop * 0.8 + noise * 2), 2, 9)
      match.stop = 0
      if (withEvents) match.events.push({ minute, type: 'info', text: `⏱ ${h === 0 ? '전반' : '후반'} 추가시간 ${match.added[h]}분` })
    }
  }
  if (withEvents && minute === 45 && halfOver(match, 1)) match.events.push({ minute, type: 'info', text: `전반 종료. ${match.score[0]} : ${match.score[1]}` })
  if (withEvents && minute === 90 && halfOver(match, 2)) match.events.push({ minute, type: 'info', text: `경기 종료! 최종 스코어 ${match.score[0]} : ${match.score[1]}` })
  // 추가시간에 나온 이벤트·골에는 +분을 붙인다
  if (match.plus) {
    for (let i = ev0; i < match.events.length; i++) match.events[i].plus ??= match.plus
    for (let i = sc0; i < match.scorers.length; i++) match.scorers[i].plus = match.plus
  }
  seal()
  match.evEnd = match.events.length // 화면: 이 분의 장면을 다 보여주기 전에는 이 분 이벤트를 숨긴다
  return interrupt
}

/** 전반(45)·후반(90, 추가시간까지)이나 그 분까지 진행. 내 팀 부상이 나오면 그 분에서 멈춘다 */
export function advance(match, ctx, toMinute, opts) {
  const done = () => (toMinute === 45 ? halfOver(match, 1) : toMinute >= 90 ? halfOver(match, 2) : match.minute >= toMinute)
  while (!done()) {
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
  const fillable = (sd.vacant || []).length // 퇴장으로 빈 자리는 채울 수 없고, 부상으로 비운 자리 수만 유지
  sd.onPitch = []
  sd.slots = []
  sd.vacant = []
  ids.forEach((id, i) => {
    if (id) { sd.onPitch.push(id); sd.slots.push(slots[i]) } else if (sd.vacant.length < fillable) sd.vacant.push(slots[i])
  })
  sd.tactics = { ...sd.tactics, formation }
}

/** 내 팀이 다친 선수를 교체하지 않고 계속하면 빈 자리로 뛴다 */
export function dropInjured(match, idx, id) {
  const sd = match.sides[idx]
  const i = sd.onPitch.indexOf(id)
  if (i < 0) return
  const role = sd.slots[i]
  removeFromPitch(match, idx, id, match.minute)
  sd.vacant = [...(sd.vacant || []), role]
}

/** 빈 자리(부상으로 비운 자리)에 교체 선수 투입 — 교체 카드 1장 */
export function fillVacant(match, ctx, idx, role, inId) {
  const sd = match.sides[idx]
  const v = (sd.vacant || []).indexOf(role)
  if (v < 0 || sd.subsLeft <= 0) return false
  if (match.ps[inId] || !available(ctx.status, inId) || sd.injured.includes(inId)) return false
  const pIn = ctx.teams[idx].players.find((p) => p.id === inId)
  if (!pIn) return false
  sd.vacant = sd.vacant.filter((_, j) => j !== v)
  sd.onPitch = [...sd.onPitch, inId]
  sd.slots = [...sd.slots, role]
  sd.subsLeft--
  sd.subs.push({ minute: match.minute, out: null, in: inId })
  match.ps[inId] = emptyPs(match.minute)
  match.events.push({ minute: match.minute, type: 'sub', team: idx, text: `🔁 ${sd.name} 교체: ${pIn.name} 투입 (${role} 빈 자리)` })
  return true
}

/** 뛰고 있는 두 선수의 자리 맞바꾸기 (교체 카드 안 씀) */
export function swapPositions(match, ctx, idx, a, b) {
  const sd = match.sides[idx]
  if (a === b || a < 0 || b < 0 || a >= sd.onPitch.length || b >= sd.onPitch.length) return false
  const slots = [...sd.slots]
  ;[slots[a], slots[b]] = [slots[b], slots[a]]
  sd.slots = slots
  const name = (id) => ctx.teams[idx].players.find((p) => p.id === id)?.name ?? ''
  match.events.push({ minute: match.minute, type: 'info', text: `↔️ ${sd.name} 위치 변경: ${name(sd.onPitch[a])} → ${slots[a]}, ${name(sd.onPitch[b])} → ${slots[b]}` })
  return true
}

/** 뛰고 있는 선수를 빈 자리로 옮긴다 (원래 자리가 빈 자리가 됨) */
export function moveToVacant(match, ctx, idx, a, role) {
  const sd = match.sides[idx]
  const v = (sd.vacant || []).indexOf(role)
  if (v < 0 || a < 0 || a >= sd.onPitch.length) return false
  const old = sd.slots[a]
  sd.slots = sd.slots.map((r, j) => (j === a ? role : r))
  sd.vacant = sd.vacant.map((r, j) => (j === v ? old : r))
  const name = ctx.teams[idx].players.find((p) => p.id === sd.onPitch[a])?.name ?? ''
  match.events.push({ minute: match.minute, type: 'info', text: `↔️ ${sd.name} 위치 변경: ${name} ${old} → ${role} (${old} 자리 비움)` })
  return true
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

/**
 * 경기 전 예상: 같은 조건으로 n경기를 빠르게 돌려 승·무·패 확률과 평균 득점을 낸다
 * (그날 컨디션·경기 흐름은 매번 달라지므로 확률일 뿐 — 낮은 확률도 터진다)
 */
export function predict(home, away, { homeCfg = {}, awayCfg = {}, status = {}, n = 120 } = {}) {
  let w = 0
  let d = 0
  let gh = 0
  let ga = 0
  for (let i = 1; i <= n; i++) {
    const m = createMatch({ home, away, homeCfg, awayCfg, seed: i * 2654435761 % 1e9 + 7, status })
    advance(m, { teams: [home, away], status }, 90, { withEvents: false })
    const [a, b] = m.score
    gh += a; ga += b
    if (a > b) w++
    else if (a === b) d++
  }
  return { win: w / n, draw: d / n, loss: (n - w - d) / n, gf: gh / n, ga: ga / n }
}

/**
 * 개인 매치업 (화면 표시용): 그 팀이 공격할 때(attack)·수비할 때(defend)의 통로별 비교
 *  rel = 이 경기 전체 통로 평균 대비 유불리 (공격 능력치와 수비 능력치의 척도 차이를 지운 값) — 화면은 이 값으로 유리/불리를 가린다
 *  neutral: 경기 전 화면용 — '그날 컨디션'(경기마다 정해지는 운)을 빼고 본다 (킥오프 전에 그날 운을 미리 보여 주지 않는다)
 */
export function matchupsOf(match, ctx, idx, { neutral = false } = {}) {
  if (neutral) match = { ...match, day: [1, 1] }
  const me = xiOf(match, ctx, idx).xi
  const op = xiOf(match, ctx, 1 - idx).xi
  const attack = channels(me, op, tacOf(match.sides[idx].tactics))
  const defend = channels(op, me, tacOf(match.sides[1 - idx].tactics))
  const all = [...attack, ...defend]
  const mean = all.length ? all.reduce((s, c) => s + c.diff, 0) / all.length : 0
  for (const c of all) { c.rel = c.diff - mean; c.label = CHANNEL_LABEL[c.key] }
  return { attack, defend }
}

/** 진단용: 그 팀의 장면별 전력 (tools/diag_engine.mjs) */
export function sideView(match, ctx, idx) {
  const r = sideRatings(match, ctx, idx)
  return { attack: r.attack, defense: r.defense, midfield: r.midfield, create: r.create, organise: r.organise, keeper: r.keeper, passTech: r.passTech, fwAtt: r.xi.filter((p) => p.pos === 'FW').reduce((a, p) => a + p.att, 0) / Math.max(1, r.xi.filter((p) => p.pos === 'FW').length) }
}
