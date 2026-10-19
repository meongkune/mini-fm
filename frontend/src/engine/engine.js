// Mini FM 경기 시뮬레이션 엔진 (브라우저에서 실행)
// backend/engine.py를 JavaScript로 옮긴 것. 서버 없이 정적 호스팅(GitHub Pages)에서 동작한다.
// 전반이 끝나면 state를 돌려주고, 후반에 그 state를 다시 넘기는 방식은 그대로 유지한다.

export const FORMATIONS = {
  // 포메이션: [DF, MF, FW] 인원, 공격/중원/수비 보정
  '4-4-2': { slots: [4, 4, 2], att: 0, mid: 0, def: 0 },
  '4-3-3': { slots: [4, 3, 3], att: 4, mid: -2, def: -2 },
  '3-5-2': { slots: [3, 5, 2], att: 0, mid: 4, def: -3 },
  '5-3-2': { slots: [5, 3, 2], att: -4, mid: -1, def: 5 },
}
const MENTALITY = {
  attacking: { att: 6, def: -6 },
  balanced: { att: 0, def: 0 },
  defensive: { att: -6, def: 6 },
}
const PRESSING = {
  // 압박: 점유율 보정, 체력 소모 배수
  low: { mid: -3, drain: 0.6 },
  normal: { mid: 0, drain: 1.0 },
  high: { mid: 4, drain: 1.6 },
}
const DEFAULT_TACTICS = { formation: '4-4-2', mentality: 'balanced', pressing: 'normal' }

// 시드를 줄 수 있는 난수 생성기 (mulberry32) — 같은 시드면 같은 경기가 나온다
export function makeRng(seed) {
  let a = seed >>> 0
  const random = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    random,
    choice: (arr) => arr[Math.floor(random() * arr.length)],
    weighted: (arr, weights) => {
      const total = weights.reduce((s, w) => s + w, 0)
      let r = random() * total
      for (let i = 0; i < arr.length; i++) {
        r -= weights[i]
        if (r < 0) return arr[i]
      }
      return arr[arr.length - 1]
    },
  }
}

const avg = (values, fallback = 50) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : fallback)

/** 포메이션에 맞춰 포지션별 능력치가 높은 선수로 베스트 11을 고른다. */
export function autoLineup(team, formation = '4-4-2') {
  const [df, mf, fw] = (FORMATIONS[formation] || FORMATIONS['4-4-2']).slots
  const need = { GK: 1, DF: df, MF: mf, FW: fw }
  const key = { GK: (p) => p.def, DF: (p) => p.def, MF: (p) => p.att + p.def, FW: (p) => p.att }
  const lineup = []
  for (const [pos, n] of Object.entries(need)) {
    const pool = team.players.filter((p) => p.pos === pos).sort((a, b) => key[pos](b) - key[pos](a))
    lineup.push(...pool.slice(0, n).map((p) => p.id))
  }
  return lineup
}

/** 팀 + 선발 + 전술 → 경기에 쓸 종합 능력치 */
function side(team, lineupIds, tacticsIn) {
  const tactics = { ...DEFAULT_TACTICS, ...(tacticsIn || {}) }
  if (!FORMATIONS[tactics.formation]) tactics.formation = '4-4-2'
  const byId = Object.fromEntries(team.players.map((p) => [p.id, p]))
  let ids = (lineupIds || []).filter((id) => byId[id]).slice(0, 11)
  if (ids.length < 11) ids = autoLineup(team, tactics.formation)
  const xi = ids.map((id) => byId[id])
  const group = Object.fromEntries(['GK', 'DF', 'MF', 'FW'].map((pos) => [pos, xi.filter((p) => p.pos === pos)]))

  const f = FORMATIONS[tactics.formation]
  const m = MENTALITY[tactics.mentality] || MENTALITY.balanced
  const pr = PRESSING[tactics.pressing] || PRESSING.normal

  // 포메이션 인원과 실제 포지션이 다르면 감점 (포지션 이탈)
  const [df, mf, fw] = f.slots
  const mismatch = Math.abs(group.DF.length - df) + Math.abs(group.MF.length - mf) + Math.abs(group.FW.length - fw)
  const penalty = mismatch * 2.5 + (group.GK.length !== 1 ? 15 : 0)

  const attack = avg([...group.FW.map((p) => p.att), ...group.FW.map((p) => p.att), ...group.MF.map((p) => p.att)]) + f.att + m.att
  const midfield = avg(group.MF.map((p) => (p.att + p.def) / 2)) + f.mid + pr.mid
  const defense = avg([...group.DF.map((p) => p.def), ...group.DF.map((p) => p.def), ...group.MF.map((p) => p.def)]) + f.def + m.def
  const keeper = avg(group.GK.map((p) => p.def), 40)
  return {
    teamId: team.id,
    name: team.short || team.name,
    xi,
    tactics,
    attack: attack - penalty,
    midfield: midfield - penalty,
    defense: defense - penalty,
    keeper,
    stamina: avg(xi.map((p) => p.sta)),
    drain: pr.drain,
  }
}

/** 55분 이후 체력 저하. 압박이 강할수록, 체력이 낮을수록 더 떨어진다. */
const fatigue = (s, minute) => (minute <= 55 ? 0 : ((minute - 55) / 35) * 8 * s.drain * (100 - s.stamina) / 40)

function pickScorer(rng, s) {
  const weight = { FW: 3.0, MF: 1.4, DF: 0.35, GK: 0 }
  return rng.weighted(s.xi, s.xi.map((p) => weight[p.pos] * p.att))
}

const GOAL_LINES = [
  (m, p, t) => `${m}' ⚽ 골! ${p}(${t})의 오른발 슛이 골망을 가릅니다!`,
  (m, p, t) => `${m}' ⚽ 골! ${p}(${t}), 문전 혼전 상황에서 침착하게 밀어 넣습니다!`,
  (m, p, t) => `${m}' ⚽ 골!! ${p}(${t})의 환상적인 중거리포!`,
  (m, p, t) => `${m}' ⚽ 골! ${p}(${t})이(가) 헤더로 마무리합니다!`,
]
const SAVE_LINES = [
  (m, p, t) => `${m}' 🧤 ${p}(${t})의 슛, 골키퍼 선방!`,
  (m, p, t) => `${m}' 🧤 ${p}(${t}) 일대일 찬스! 하지만 골키퍼가 막아냅니다.`,
]
const MISS_LINES = [
  (m, p, t) => `${m}' ${p}(${t})의 슛이 골대를 살짝 벗어납니다.`,
  (m, p, t) => `${m}' ${p}(${t}), 크로스바를 넘기는 슛.`,
  (m, p, t) => `${m}' 🥅 ${p}(${t})의 슛이 골대를 맞고 나옵니다!`,
]
const CARD_LINE = (m, p, t) => `${m}' 🟨 ${p}(${t}) 경고. 거친 태클이었습니다.`

export function newState(seed) {
  return {
    seed: seed ?? Math.floor(Math.random() * 1e9) + 1,
    minute: 0,
    score: [0, 0],
    shots: [0, 0],
    onTarget: [0, 0],
    possessionTicks: [0, 0],
    scorers: [],
  }
}

/**
 * 경기 시뮬레이션.
 * half=1 → 1~45분, half=2 → 46~90분(state 필요), half=0 → 90분 전체(빠른 시뮬, 이벤트 없음 가능)
 */
export function simulate(homeTeam, awayTeam, { homeCfg = {}, awayCfg = {}, half = 0, state = null, withEvents = true } = {}) {
  const st = state ? structuredClone(state) : newState()
  const sides = [side(homeTeam, homeCfg.lineup, homeCfg.tactics), side(awayTeam, awayCfg.lineup, awayCfg.tactics)]
  const [start, end] = half === 1 ? [1, 45] : half === 2 ? [46, 90] : [1, 90]
  // 같은 시드 + 같은 구간이면 같은 결과. 후반은 전술 변경이 반영되도록 별도 시드
  const rng = makeRng(st.seed * 7 + start)
  const events = []
  // 경기장 애니메이션용 분 단위 흐름: t=공격팀, k=상황(build·card·miss·save·goal), p=선수 ID
  const timeline = []
  if (withEvents && start === 1) events.push({ minute: 0, type: 'info', text: `0' 킥오프! ${sides[0].name} vs ${sides[1].name}` })
  if (withEvents && start === 46) events.push({ minute: 45, type: 'info', text: "46' 후반전 시작!" })

  for (let minute = start; minute <= end; minute++) {
    const fat = sides.map((s) => fatigue(s, minute))
    const mid = sides.map((s, i) => s.midfield - fat[i] + (i === 0 ? 3 : 0)) // 홈 어드밴티지
    const pHome = 0.5 + (mid[0] - mid[1]) / 80
    const atk = rng.random() < pHome ? 0 : 1
    const dfn = 1 - atk
    st.possessionTicks[atk]++
    const tick = { m: minute, t: atk, k: 'build' }
    if (withEvents) timeline.push(tick)

    const a = sides[atk].attack - fat[atk]
    const d = sides[dfn].defense - fat[dfn]
    // 공격권을 가진 팀이 슈팅까지 갈 확률
    if (rng.random() > 0.17 + (a - d) / 400) {
      if (withEvents && rng.random() < 0.012) {
        const p = rng.choice(sides[dfn].xi)
        Object.assign(tick, { k: 'card', p: p.id })
        events.push({ minute, type: 'card', team: dfn, text: CARD_LINE(minute, p.name, sides[dfn].name) })
      }
      continue
    }

    const shooter = pickScorer(rng, sides[atk])
    Object.assign(tick, { k: 'miss', p: shooter.id })
    st.shots[atk]++
    const quality = 0.3 + (shooter.att - sides[dfn].keeper) / 400 + (a - d) / 600
    const onTarget = rng.random() < 0.45 + (shooter.att - 60) / 200
    const args = [minute, shooter.name, sides[atk].name]
    if (onTarget) {
      st.onTarget[atk]++
      tick.k = 'save'
      if (rng.random() < Math.max(0.08, Math.min(0.55, quality))) {
        tick.k = 'goal'
        st.score[atk]++
        st.scorers.push({ minute, team: atk, playerId: shooter.id, name: shooter.name })
        if (withEvents) events.push({ minute, type: 'goal', team: atk, text: rng.choice(GOAL_LINES)(...args), score: [...st.score] })
      } else if (withEvents) {
        events.push({ minute, type: 'save', team: atk, text: rng.choice(SAVE_LINES)(...args) })
      }
    } else if (withEvents && rng.random() < 0.5) {
      events.push({ minute, type: 'miss', team: atk, text: rng.choice(MISS_LINES)(...args) })
    }
  }

  st.minute = end
  if (withEvents) {
    const [h, w] = st.score
    if (end === 45) events.push({ minute: 45, type: 'info', text: `45' 전반 종료. ${h} : ${w}` })
    if (end === 90) events.push({ minute: 90, type: 'info', text: `90' 경기 종료! 최종 스코어 ${h} : ${w}` })
  }
  const total = st.possessionTicks[0] + st.possessionTicks[1] || 1
  const possHome = Math.round((st.possessionTicks[0] * 100) / total)
  return {
    half,
    finished: end === 90,
    events,
    timeline,
    lineups: sides.map((s) => s.xi.map(({ id, name, number, pos }) => ({ id, name, number, pos }))),
    stats: { score: st.score, shots: st.shots, onTarget: st.onTarget, possession: [possHome, 100 - possHome] },
    state: st,
  }
}

/** 서클 방식 더블 라운드 로빈. 팀 수가 홀수면 쉬는 팀(bye)을 넣는다. (8팀 → 14라운드, 20팀 → 38라운드) */
export function roundRobin(teamIds) {
  let ids = [...teamIds]
  if (ids.length % 2) ids.push(null)
  const n = ids.length
  const rounds = []
  for (let r = 0; r < n - 1; r++) {
    const pairs = []
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i]
      const b = ids[n - 1 - i]
      if (a === null || b === null) continue
      pairs.push((r + i) % 2 === 0 ? { home: a, away: b } : { home: b, away: a })
    }
    rounds.push(pairs)
    ids = [ids[0], ids[n - 1], ...ids.slice(1, n - 1)]
  }
  return [...rounds, ...rounds.map((rnd) => rnd.map(({ home, away }) => ({ home: away, away: home })))]
}
