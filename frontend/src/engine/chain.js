// 공격 전개 사슬 (내 경기 엔진): 공을 한 번 가질 때마다 빌드업 → 전진 → 마무리 단계를 거치고,
// 단계마다 '그 자리의 선수끼리' 세부 능력치로 맞붙는다. 결과가 그대로 화면 장면이 된다.
//   1) 빌드업  짧게(패스·안정성 vs 상대의 압박) / 길게(롱패스 → 공중볼 싸움). 짧게 풀다 뺏기면 상대 역습이 시작된다
//   2) 전진    측면 돌파(드리블 vs 태클) / 중앙 콤비네이션(패스·찬스 창출 vs 위치 선정) / 뒷공간 스루패스(찬스 창출 vs 수비 라인 높이)
//   3) 마무리  크로스 후 헤더 / 박스 안 슈팅 / 1대1 — 막히면 코너킥·걷어냄 (세트피스는 공격의 결과로만 생긴다)
// 다른 팀끼리의 경기는 빠른 엔진(match.js의 한 번 주사위)을 그대로 쓴다. 두 엔진의 결과 분포가 같도록, 사슬 전체가 찬스로 이어질 확률을
// 빠른 엔진의 '찬스 확률(pCh)'에 맞춰 두었다 — 팀 전력·전술 상성·경기 흐름은 pCh에 이미 들어 있고, 사슬은 그 확률을 '어디서·누가'로 나눈다.
import { buildSlots } from './formation.js'
import { W, computeFrame } from './positions.js'

/** 손잡이: tools/diag_engine.mjs --mine 으로 빠른 엔진과 분포를 맞춘다 */
export const CHAIN = {
  s1Short: 0.62, // 짧은 빌드업이 전진으로 이어지는 기본 확률
  s1Long: 0.52, // 롱볼을 따내 전진으로 이어지는 기본 확률
  s1Avg: 0.58, // 역습 장면의 기준 (빌드업 없이 시작)
  kDuel: 75, // 맞붙는 선수의 능력 차가 이만큼이면 성공 확률이 e배 (30~99 척도)
  pressCut: 0.12, // 상대 압박 강도 100이면 짧은 빌드업 성공률 −12% (0이면 +12%)
  counter: 0.04, // 짧은 빌드업을 압박으로 뺏었을 때 곧바로 역습으로 이어질 확률
  counterK: 1.3, // 역습 장면의 전진 성공 배수
  foul1: 0.34, // 빌드업이 끊길 때 반칙으로 끊긴 비율 (중원 프리킥)
  nearK: 1.3, // 반칙·태클 기록이 그 자리에서 맞붙은 선수에게 갈 가중치 (나머지는 규율·태클 능력대로)
  tackle1: 0.55, // 빌드업을 뺏을 때 태클로 기록되는 비율 (나머지는 패스 차단)
  // 전진이 막혔을 때의 결과 비율 (나머지는 그냥 공을 잃음)
  wing: { offside: 0.02, tackle: 0.3, foul: 0.26, corner: 0.16, long: 0.09 },
  combo: { offside: 0.05, tackle: 0.24, foul: 0.22, corner: 0.03, long: 0.27 },
  through: { offside: 0.28, tackle: 0.36, foul: 0.12, corner: 0.03, long: 0.06 },
  knock: { tackle: 0.36, foul: 0.2, corner: 0.05, long: 0.12 }, // 롱볼을 따낸 뒤 떨궈 준 공이 막혔을 때
  // 반칙 위치 (전진 단계): 박스 안 · 직접 프리킥 거리 · 측면 크로스 프리킥 (나머지는 중원)
  zone: { wing: [0.018, 0.06, 0.3], combo: [0.025, 0.2, 0.08], through: [0.03, 0.14, 0.06] },
  // 마무리 방식별 보정: [결정력 더하기, 유효슛 확률 더하기]
  finish: { cross: [-0.035, -0.04], cutback: [0.01, 0.02], combo: [0, 0], oneOnOne: [0.07, 0.08], counter: [0.05, 0.06], knock: [-0.02, -0.02] },
  crossShare: 0.55, // 측면 돌파 후 크로스로 마무리하는 비율 (나머지는 컷백·직접 슈팅)
  qCal: 0.014, // 전체 결정력 보정
  chCal: 1.0, // 전체 찬스 수 보정 (통로를 유리한 쪽으로 고르는 만큼 성공률이 올라가는 것을 되돌린다)
}

/** 장면 종류 (화면·통계 표시용) */
export const SCENE_LABEL = {
  build: '짧은 빌드업', long: '롱볼', press: '압박 탈취', dribble: '측면 돌파', combo: '중앙 콤비네이션', through: '스루패스',
  cross: '크로스', oneOnOne: '1대1', counter: '역습', longshot: '중거리 슛',
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const avg = (v, fb = 60) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : fb)

/** 경기 상태 → 위치 모델에 넣을 선발 배열 (자리 좌표 포함) */
function lineupsOf(match, r) {
  return match.sides.map((sd, i) => {
    const all = buildSlots(sd.tactics.formation)
    const used = new Set()
    return r[i].xi.map((p) => {
      const k = all.findIndex((s, j) => !used.has(j) && s.role === p.slot)
      if (k >= 0) used.add(k)
      return { id: p.id, slot: p.slot, pos: p.pos, sx: all[k]?.x, sy: all[k]?.y }
    })
  })
}

/**
 * 위치에서 읽는 상황 (4-1의 위치 모델): 공을 가진 선수 주변과 수비 뒷공간
 *  near = 가장 가까운 수비까지 거리(m) · ahead = 공과 골문 사이에 남은 수비 수 · behind = 수비 맨 뒷줄 뒤 공간(m)
 */
function situation(match, r, atk, laneKey, carrierId, minute) {
  const lineups = lineupsOf(match, r)
  if (lineups.some((l) => l.some((p) => p.sx === undefined))) return { near: 4, ahead: 4, behind: 22 }
  const tick = { m: minute, t: atk, k: 'build', ch: laneKey, w: carrierId, p: carrierId }
  const f = computeFrame(lineups, tick, 1, false, match.sides.map((s) => s.tactics))
  const dfn = 1 - atk
  const c = f.pos[f.carrier] || f.ball
  const goalX = atk === 0 ? W : 0
  const ds = lineups[dfn].filter((p) => p.pos !== 'GK').map((p) => f.pos[p.id])
  const near = Math.min(...ds.map((q) => Math.hypot(q.x - c.x, q.y - c.y)))
  const ahead = ds.filter((q) => Math.abs(goalX - q.x) < Math.abs(goalX - c.x)).length
  const behind = Math.min(...ds.map((q) => Math.abs(goalX - q.x)))
  return { near, ahead, behind }
}

/**
 * 한 번의 공격을 사슬로 진행한다. env는 match.js의 step이 넘긴다 (난수·판정 함수·이 분의 전력)
 *  반환 없음 — 결과는 env의 판정 함수들이 경기 상태에 직접 기록한다
 */
export function playChain(env) {
  const { match, rng, r, atk, dfn, minute, pCh, lanes, t, to, skill, hash, withEvents } = env
  const { det, createOf, crossOf, tackleOf, aerialOf } = skill
  const C = CHAIN
  const xa = r[atk].xi.filter((p) => p.pos !== 'GK')
  const xd = r[dfn].xi.filter((p) => p.pos !== 'GK')
  if (!xa.length || !xd.length) return
  const names = [match.sides[0].name, match.sides[1].name]
  const cs = (match.cs ??= [{}, {}])
  const count = (side, ev, ok) => { const c = (cs[side][ev] ??= [0, 0]); c[0]++; if (ok) c[1]++ }
  const mark = (o) => Object.assign(env.tick(), o)
  const say = (text, type = 'chance') => { if (withEvents) env.say({ type, text }) }
  const sometimes = (key, p) => hash(`ch-${key}-${match.seed}-${minute}-${match.plus}`) < p
  // 세부 능력: 원래 값과 반반 (평균은 그대로, 같은 수준 안에서 성향이 갈린다)
  const passOf = (p) => p.att * 0.25 + p.def * 0.25 + det(p, '패스', (p.att + p.def) / 2) * 0.5
  const calmOf = (p) => det(p, '안정성', (p.att + p.def) / 2)
  const dribOf = (p) => p.att * 0.5 + det(p, '드리블', p.att) * 0.5
  const posOf = (p) => p.def * 0.5 + det(p, '위치 선정', p.def) * 0.5
  const pressOf = (p) => (p.att + p.def) * 0.25 + det(p, '태클', p.def) * 0.5
  // 대결: 두 선수가 '각자 자기 팀 평균보다 얼마나 나은가'를 비교한다 — 팀 전체의 전력 차는 pCh에 이미 들어 있으므로 여기서 또 세지 않는다
  //   (처음엔 능력치를 그대로 비교해서 강팀이 단계마다 한 번씩 더 유리해졌고, 3골 차 대승이 22%까지 늘었다)
  const meanOf = (xi, fn) => avg(xi.map(fn), 65)
  const duel = (a, fa, d, fd) => Math.exp(clamp((fa(a) - meanOf(xa, fa)) - (fd(d) - meanOf(xd, fd)), -30, 30) / C.kDuel)
  const pick = (arr, w) => rng.weighted(arr, arr.map(w))
  const byRole = (xi, roles) => xi.filter((p) => roles.includes(p.slot))
  const lane = (key) => lanes.find((c) => c.key === key)
  const playerOf = (xi, who) => xi.find((p) => p.id === who?.id)
  // 누가 반칙·태클을 했나: 그 자리에서 맞붙은 선수가 가장 유력하지만, 규율이 낮은 선수는 반칙을, 태클이 좋은 선수는 태클을 더 자주 한다
  //   (맞붙은 선수로만 정했더니 실제 기록과의 순위 상관이 경고 0.43 → 0.21, 태클 0.55 → 0.42로 떨어졌다)
  const foulerNear = (near) => pick(xd, (p) => ({ DF: 2, MF: 1.6, FW: 0.6 })[p.pos] * clamp((120 - det(p, '규율', 70)) / 50, 0.4, 1.8) * (p.id === near.id ? C.nearK : 1))
  const tacklerNear = (near) => pick(xd, (p) => ({ DF: 2, MF: 1.4, FW: 0.3 })[p.pos] * tackleOf(p) * (p.id === near.id ? C.nearK : 1))

  // ── 역습으로 시작한 공격: 빌드업 없이 곧바로 전진 ──
  const counter = match.counter && match.counter.t === atk
  if (match.counter) match.counter = null

  // ── 1) 빌드업 ──
  let route = null
  let s1 = 1
  let base = 1 // 이 빌드업 방식의 기본 성공률 — 전진 단계 확률을 여기에 맞춰, 짧게 풀든 길게 넘기든 찬스로 이어질 확률(pCh)이 같게 한다
  if (!counter) {
    const pLong = clamp(0.12 + ((t.passing - 50) / 50) * 0.36 + (t.phil === 'direct' ? 0.2 : 0) + (to.press >= 70 ? 0.07 : 0), 0.04, 0.85)
    const long = rng.random() < pLong
    if (long) {
      // 롱볼: 최전방 타깃의 공중볼 vs 센터백의 공중볼
      const targets = byRole(xa, ['ST']).length ? byRole(xa, ['ST']) : xa.filter((p) => p.pos === 'FW').length ? xa.filter((p) => p.pos === 'FW') : xa
      const target = pick(targets, (p) => Math.max(1, aerialOf(p) - 40) ** 2)
      const cbs = byRole(xd, ['CB']).length ? byRole(xd, ['CB']) : xd.filter((p) => p.pos === 'DF').length ? xd.filter((p) => p.pos === 'DF') : xd
      const marker = pick(cbs, (p) => Math.max(1, aerialOf(p) - 40) ** 2)
      const passer = pick(xa.filter((p) => p.pos === 'DF' || p.slot === 'DM').length ? xa.filter((p) => p.pos === 'DF' || p.slot === 'DM') : xa, (p) => passOf(p))
      s1 = clamp(C.s1Long * duel(target, aerialOf, marker, aerialOf) * (1 + (passOf(passer) - meanOf(xa, passOf)) / 300), 0.15, 0.8)
      base = C.s1Long
      const won = rng.random() < s1
      count(atk, 'long', won)
      mark({ ev: 'long', ch: 'air', w: target.id, a: passer.id, d: marker.id })
      if (!won) {
        mark({ lost: marker.id })
        if (sometimes('lb', 0.18)) say(`${passer.name}의 롱볼, ${marker.name}(${names[dfn]})이(가) 머리로 걷어냅니다.`)
        return
      }
      route = { key: 'knock', target }
    } else {
      // 짧은 빌드업: 뒤에서 푸는 선수의 패스·안정성 vs 가장 앞에서 압박하는 선수
      const backs = xa.filter((p) => p.pos === 'DF' || p.slot === 'DM' || p.slot === 'CM')
      const builder = pick(backs.length ? backs : xa, (p) => ({ DF: 1.6, MF: 1.2, FW: 0.5 })[p.pos] || 1)
      const fronts = xd.filter((p) => p.pos === 'FW' || p.slot === 'AM' || p.slot === 'CM')
      const presser = pick(fronts.length ? fronts : xd, (p) => pressOf(p))
      const calm = (p) => passOf(p) * 0.6 + calmOf(p) * 0.4
      s1 = clamp(C.s1Short * duel(builder, calm, presser, pressOf) * (1 - ((to.press - 50) / 50) * C.pressCut) * (t.phil === 'possession' ? 1.04 : 1), 0.2, 0.88)
      base = C.s1Short
      const ok = rng.random() < s1
      count(atk, 'build', ok)
      if (!ok) {
        mark({ ev: 'press', a: builder.id, d: presser.id, lost: presser.id })
        count(dfn, 'press', true)
        const y = rng.random()
        if (y < C.foul1) { env.foul(foulerNear(presser), 'mid'); return } // 압박하다 반칙 → 중원 프리킥
        if (rng.random() < C.tackle1) match.ps[tacklerNear(presser).id].tk++
        // 높은 곳에서 뺏으면 곧바로 역습 (상대가 역습 철학이면 더 자주)
        if (rng.random() < C.counter * (to.phil === 'counter' ? 1.5 : 1) * (0.7 + to.press / 170)) {
          match.counter = { t: dfn }
          if (sometimes('pw', 0.6)) say(`🔥 ${presser.name}(${names[dfn]})이(가) ${builder.name}의 공을 뺏습니다 — 역습!`)
        }
        return
      }
      mark({ ev: 'build', a: builder.id })
    }
  }

  // ── 2) 전진: 어느 길로 가나 (전술이 그 통로를 쓰는 비중 × 그 통로의 매치업 유불리 × 상대 라인 높이) ──
  if (!route) {
    const opts = []
    for (const key of ['left', 'right']) { const c = lane(key); if (c) opts.push({ key: 'wing', lane: c, w: c.w * Math.exp(c.adv / 12) }) }
    const cc = lane('center')
    if (cc) opts.push({ key: 'combo', lane: cc, w: cc.w * Math.exp(cc.adv / 12) })
    opts.push({ key: 'through', lane: cc || null, w: clamp(0.45 + ((to.line - 50) / 50) * 0.55 + (t.phil === 'counter' ? 0.45 : 0) + (t.passing >= 60 ? 0.15 : 0), 0.12, 1.6) })
    route = counter ? { key: 'counter', lane: cc || null } : pick(opts, (o) => o.w)
  }

  // 그 길에서 맞붙는 선수들
  let carrier
  let stopper
  let e2 = 1
  if (route.key === 'wing') {
    carrier = playerOf(xa, route.lane.a) || pick(xa, () => 1)
    stopper = playerOf(xd, route.lane.d) || pick(xd.filter((p) => p.pos === 'DF').length ? xd.filter((p) => p.pos === 'DF') : xd, (p) => tackleOf(p))
    e2 = duel(carrier, dribOf, stopper, tackleOf)
  } else if (route.key === 'combo') {
    const mids = xa.filter((p) => p.pos === 'MF' || p.slot === 'ST')
    carrier = pick(mids.length ? mids : xa, (p) => createOf(p) ** 2)
    const shield = xd.filter((p) => p.slot === 'DM' || p.slot === 'CM' || p.slot === 'CB')
    stopper = pick(shield.length ? shield : xd, (p) => posOf(p))
    e2 = duel(carrier, (p) => passOf(p) * 0.5 + createOf(p) * 0.5, stopper, posOf)
  } else if (route.key === 'knock') {
    carrier = route.target
    stopper = pick(xd.filter((p) => p.pos === 'DF').length ? xd.filter((p) => p.pos === 'DF') : xd, (p) => posOf(p))
    e2 = duel(carrier, aerialOf, stopper, posOf) * 1.05
  } else {
    // 스루패스·역습: 넣어 주는 선수의 찬스 창출 vs 마지막 수비의 위치 선정 + 수비 뒷공간
    const makers = xa.filter((p) => p.pos === 'MF' || p.slot === 'LW' || p.slot === 'RW')
    carrier = pick(makers.length ? makers : xa, (p) => createOf(p) ** 2)
    const lasts = byRole(xd, ['CB']).length ? byRole(xd, ['CB']) : xd
    stopper = pick(lasts, (p) => 1 / Math.max(20, posOf(p)))
    e2 = duel(carrier, createOf, stopper, posOf)
  }
  // 위치에서 읽는 상황: 가까운 수비가 멀수록 돌파가 쉽고, 뒷공간이 넓을수록 스루패스가 통한다
  const sit = situation(match, r, atk, route.lane?.key || 'center', carrier.id, minute)
  if (route.key === 'wing') e2 *= 1 + clamp((sit.near - 3.2) / 22, -0.08, 0.14)
  if (route.key === 'through' || route.key === 'counter') e2 *= 1 + clamp((sit.behind - 20) / 60, -0.15, 0.3)
  const ev = route.key === 'wing' ? 'dribble' : route.key === 'knock' ? 'long' : route.key
  const s2 = clamp((pCh / (counter ? C.s1Avg : base)) * e2 * C.chCal * (counter ? C.counterK : 1), 0.02, 0.85)
  const through = rng.random() < s2
  if (route.key !== 'knock') count(atk, ev, through)
  mark({ ev, ch: route.lane?.key ?? (route.key === 'knock' ? 'air' : 'center'), w: carrier.id, a: carrier.id, d: stopper.id })

  if (!through) {
    // 전진이 막혔다: 태클 · 반칙 · 수비 맞고 코너킥 · 오프사이드 · 막히자 중거리
    const F = C[route.key === 'counter' ? 'through' : route.key]
    let y = rng.random()
    if (F.offside) {
      const pOff = F.offside * r[dfn].offside
      if (y < pOff) { match.stats[atk].offsides++; mark({ r: 'offside', lost: stopper.id }); return }
      y -= pOff
    }
    if (y < F.tackle) { match.ps[tacklerNear(stopper).id].tk++; mark({ lost: stopper.id }); return }
    y -= F.tackle
    const pFoul = F.foul * r[dfn].foul
    if (y < pFoul) {
      const z = rng.random()
      const Z = C.zone[route.key === 'counter' ? 'through' : route.key === 'knock' ? 'combo' : route.key]
      env.foul(foulerNear(stopper), z < Z[0] ? 'pen' : z < Z[0] + Z[1] ? 'fk' : z < Z[0] + Z[1] + Z[2] ? 'fkx' : 'mid')
      return
    }
    y -= pFoul
    if (y < F.corner) { env.corner(); return }
    y -= F.corner
    if (y < F.long) { count(atk, 'longshot', true); mark({ ev: 'longshot' }); env.shoot(true); return }
    mark({ lost: stopper.id })
    return
  }

  // ── 3) 마무리 ──
  const box = xa.filter((p) => p.id !== carrier.id)
  const helped = (p) => (rng.random() < p ? carrier : false) // 길을 연 선수의 도움으로 기록될 확률 (false = 도움 없는 골)
  let kind
  let opts
  if (route.key === 'wing') {
    if (rng.random() < C.crossShare) {
      // 크로스: 올리는 선수의 크로스 + 박스 안 선수의 공중볼 vs 센터백
      kind = 'cross'
      const dAir = avg(xd.filter((p) => p.slot === 'CB').map(aerialOf), 70)
      opts = { lane: route.lane, assister: helped(0.9), shooterK: (p) => (p.id === carrier.id ? 0 : clamp((aerialOf(p) - 40) / 35, 0.3, 1.8)), q: (crossOf(carrier) - 70) / 600 - (dAir - 70) / 900 }
    } else {
      kind = 'cutback'
      opts = { lane: route.lane, shooterK: (p) => (p.id === carrier.id ? 1.6 : 1), assister: undefined }
    }
  } else if (route.key === 'combo') {
    kind = 'combo'
    opts = { lane: route.lane, shooterK: (p) => (p.id === carrier.id ? 0.5 : 1), assister: helped(0.7) }
  } else if (route.key === 'knock') {
    kind = 'knock'
    opts = { lane: lane('air') || null, shooterK: (p) => (p.id === carrier.id ? 0.7 : p.slot === 'AM' || p.pos === 'FW' ? 1.3 : 1), assister: helped(0.6) }
  } else {
    // 1대1: 뒷공간으로 뛰는 선수 (공격수 위주) vs 골키퍼
    kind = route.key === 'counter' ? 'counter' : 'oneOnOne'
    opts = { lane: route.lane, shooterK: (p) => (p.id === carrier.id ? 0 : p.pos === 'FW' ? 1.5 : p.slot === 'AM' ? 1 : 0.5), assister: helped(0.8) }
  }
  const [q, on] = C.finish[kind]
  // 공과 골문 사이에 수비가 많이 남아 있으면 슈팅 각이 좁다
  const crowd = clamp((4 - sit.ahead) * 0.004, -0.016, 0.016)
  if (kind === 'cross' || kind === 'oneOnOne' || kind === 'counter') count(atk, kind === 'cross' ? 'cross' : kind, true)
  if (!box.length) opts.shooterK = () => 1
  mark({ fin: kind })
  env.shoot(false, { ...opts, q: (opts.q || 0) + q + crowd + C.qCal, on })
}
