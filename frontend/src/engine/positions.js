// 경기장 위 선수 22명과 공의 위치 계산 (순수 함수, 결정적 — 같은 입력이면 같은 위치). 화면(pages/MatchPitch.jsx)이 그리고, 다음 단계의 경기 엔진이 판단에 쓴다
import { shapeOf, tacOf } from './tactics.js'

// 경기장 좌표계: 가로 105 x 세로 68 (실제 경기장 m 비율). 홈(0)은 오른쪽(x=105), 원정(1)은 왼쪽(x=0)으로 공격
export const W = 105
export const H = 68
const ROW_X = { GK: 5, DF: 21, MF: 38, FW: 49 }
const SLOT_POS = { GK: 'GK', CB: 'DF', LB: 'DF', RB: 'DF', LWB: 'DF', RWB: 'DF', DM: 'MF', CM: 'MF', LM: 'MF', RM: 'MF', AM: 'MF', LW: 'FW', RW: 'FW', ST: 'FW' }
const FULLBACK = new Set(['LB', 'RB', 'LWB', 'RWB'])
const WIDE = new Set(['LW', 'RW', 'LM', 'RM'])

// 분·팀으로 고정되는 난수 (같은 경기는 다시 봐도 같은 움직임)
function rand(seed) {
  let t = (seed + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const hashId = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** 기본 자리: 포메이션 자리 좌표(sx 0 왼쪽~100 오른쪽, sy 0 우리 골문~100 상대 골문) → 자기 진영 안 */
function basePositions(xi, side) {
  const out = {}
  const posOf = (p) => SLOT_POS[p.slot] || p.pos
  if (xi.length && xi.every((p) => p.sx !== undefined)) {
    for (const p of xi) {
      const x = 2 + p.sy * 0.57
      const y = 4 + p.sx * 0.6
      out[p.id] = { x: side === 0 ? x : W - x, y: side === 0 ? y : H - y, side, pos: posOf(p), slot: p.slot }
    }
    return out
  }
  for (const pos of ['GK', 'DF', 'MF', 'FW']) {
    const row = xi.filter((p) => posOf(p) === pos)
    row.forEach((p, i) => {
      const x = ROW_X[pos]
      const y = (H * (i + 1)) / (row.length + 1)
      out[p.id] = { x: side === 0 ? x : W - x, y: side === 0 ? y : H - y, side, pos, slot: p.slot }
    })
  }
  return out
}

/**
 * 한 분(tick)을 몇 번의 패스로 쪼갠다: 뒤에서부터 공을 돌려 마지막 선수(슈터)에게 간다
 * 반환: 공을 가진 선수 ID 목록 (단계마다 하나씩)
 */
function passChain(mine, tick, base) {
  const field = mine.filter((p) => base[p.id].pos !== 'GK')
  const end = tick.k !== 'build' && tick.k !== 'card' ? field.find((p) => p.id === tick.p) : null
  const len = end ? 3 : 2 + Math.floor(rand(tick.m * 7 + tick.t) * 2)
  const order = { DF: 0, MF: 1, FW: 2 }
  const chain = []
  for (let i = 0; i < len; i++) {
    // 앞 단계일수록 뒤쪽 선수, 뒤 단계일수록 앞쪽 선수
    const want = Math.min(2, Math.round((i / Math.max(1, len - 1)) * (end ? 1.6 : 1.4) + (end ? 0 : 0.3)))
    const pool = field.filter((p) => order[base[p.id].pos] === want && p.id !== chain.at(-1) && p.id !== end?.id)
    const cands = pool.length ? pool : field.filter((p) => p.id !== chain.at(-1))
    chain.push(cands[Math.floor(rand(tick.m * 131 + i * 17 + tick.t) * cands.length)].id)
  }
  if (end) chain[chain.length - 1] = end.id
  // 개인 매치업: 그 통로를 연 선수(측면이면 윙어·풀백, 중앙·공중볼이면 공격수)가 마무리 직전에 공을 잡는다
  if (end && tick.w && tick.w !== end.id && chain.length >= 2 && field.some((p) => p.id === tick.w)) chain[chain.length - 2] = tick.w
  // 사슬 엔진(tick.ev): 실제로 그 장면을 만든 선수들이 공을 잡는다
  const has = (id) => id && field.some((p) => p.id === id)
  if (tick.ev === 'press' && has(tick.a)) return [chain[0] === tick.a ? chain[1] ?? tick.a : chain[0], tick.a] // 뒤에서 돌리다가 뺏긴다
  if (tick.ev === 'long' && has(tick.a) && has(tick.w) && tick.a !== tick.w) return end && end.id !== tick.w ? [tick.a, tick.w, end.id] : [tick.a, tick.w]
  if (!end && has(tick.w)) chain[chain.length - 1] = tick.w
  return chain
}

// ── 오픈 플레이 위치 모델: 위치 = 기본 자리 + 팀 블록 이동 + 역할별 움직임 ──
// 팀 기준 좌표: u = 자기 골문에서의 거리(0~105), v = 좌우(0~68). 22명 모두 '공의 기준점'과 팀 전술에서 계산된다.
//   수비 블록: 수비 라인 높이(전술) + 공을 따라 물러서고 올라옴 + 공 쪽으로 좁힘 + 두 줄 사이 간격(콤팩트함) 유지, 전방 압박이면 상대 진영에서 블록
//   공격 블록: 철학마다 길이·폭·전진 방식이 다르다 — 점유는 넓게 벌려 짧은 패스 각도, 역습은 깊은 곳에서 출발해 앞선이 길게 달리고,
//             직선은 최전방 타깃을 높이 세우고 2선이 따라붙는다
//   역할: 풀백 오버래핑 · 윙어 안쪽 침투(측면 집중이면 터치라인) · 스트라이커 뒷공간 침투 · 수비형 미드가 내려와 빌드업 · 가까운 선수 압박·다음 선수 커버 · 골키퍼 위치
const lerp = (a, b, t) => a + (b - a) * t
// 철학별 공격 모양: [공 출발 깊이, 공 도착 깊이(슈팅 없는 공격), 블록 길이(출발→마무리), 앞선 지수(작을수록 앞선이 멀리), 폭 보정]
const ATTACK_SHAPE = {
  possession: { from: 38, to: 70, len: [36, 42], pow: 1.1, wide: 3 },
  balanced: { from: 30, to: 64, len: [36, 46], pow: 1, wide: 0 },
  counter: { from: 22, to: 66, len: [30, 54], pow: 0.8, wide: -2 },
  direct: { from: 20, to: 62, len: [44, 52], pow: 0.75, wide: 0 },
}
const DEEP = new Set(['DM', 'CM'])

/** 그 팀 필드 선수들의 기본 자리(자리 좌표)를 깊이 d(0 수비 줄~1 최전방)·좌우 l(-1 왼쪽~1 오른쪽)로 */
function normalised(xi) {
  const posOf = (p) => SLOT_POS[p.slot] || p.pos
  const field = xi.filter((p) => posOf(p) !== 'GK')
  const out = {}
  if (field.length && field.every((p) => p.sx !== undefined)) {
    const ys = field.map((p) => p.sy)
    const lo = Math.min(...ys)
    const span = Math.max(1, Math.max(...ys) - lo)
    for (const p of field) out[p.id] = { d: (p.sy - lo) / span, l: clamp((p.sx - 50) / 40, -1.2, 1.2), pos: posOf(p), slot: p.slot }
  } else {
    for (const pos of ['DF', 'MF', 'FW']) {
      const row = field.filter((p) => posOf(p) === pos)
      row.forEach((p, i) => { out[p.id] = { d: { DF: 0, MF: 0.5, FW: 1 }[pos], l: ((i + 1) / (row.length + 1)) * 2 - 1, pos, slot: p.slot } })
    }
  }
  for (const p of xi) if (posOf(p) === 'GK') out[p.id] = { d: 0, l: 0, pos: 'GK', slot: 'GK' }
  return out
}

/**
 * 한 장면(분 tick의 sub 번째 패스) → 선수 22명 위치 + 공
 *  tactics: [홈 전술, 원정 전술] (tacOf·shapeOf로 읽는다). 없으면 균형 기본값
 *  반환: { pos, ball, carrier, steps, kind } — kind = 이 단계로 공이 온 방식('ground' 땅볼 · 'loft' 뜬 공 · 'cross' 크로스)
 */
// live(연속 재생용): { x, y, prog, holder } — 공의 기준점을 '지금 공 위치'로, 진행도·공 가진 선수를 재생 쪽에서 정해 준다
export function computeFrame(lineups, tick, sub, shotStage, tactics = [null, null], live = null) {
  const base = { ...basePositions(lineups[0], 0), ...basePositions(lineups[1], 1) }
  const all = [...lineups[0], ...lineups[1]]
  const time = (tick?.m ?? 0) + sub * 0.33
  const wobble = (id, k, amp) => (rand(hashId(id) * 7 + Math.floor(time * 3) * 13 + k) - 0.5) * 2 * amp * (live ? 1.6 : 1) // 연속 재생: 장면마다 자리가 조금씩 달라 줄이 자로 잰 듯 서지 않는다
  const T = [0, 1].map((i) => { const t = tactics?.[i] || {}; const x = tacOf(t); const s = shapeOf(t, t.formation); return { ...x, line: s.line, width: s.width } })
  const N = [normalised(lineups[0]), normalised(lineups[1])]
  // 팀 기준 좌표 → 경기장 좌표 (홈은 x 증가 방향으로 공격, 원정은 반대)
  const world = (side, u, v) => ({ x: side === 0 ? u : W - u, y: side === 0 ? v : H - v })
  const rel = (side, x, y) => ({ u: side === 0 ? x : W - x, v: side === 0 ? y : H - y })

  // 수비 블록 (공이 그 팀 골문에서 bu만큼 떨어져 있고 좌우로 bv에 있을 때)
  const defend = (side, bu, bv, halfW = null) => {
    const t = T[side]
    const counter = t.approach === 'counter'
    let back = 14 + 22 * (t.line / 100) + (bu - 52.5) * 0.45 // 라인 높이 + 공을 따라 물러서고 올라옴
    if (t.press >= 60 && bu > 62) back += ((t.press - 50) / 50) * 9 // 전방 압박: 상대 진영에서 블록
    const len = 34 - ((t.press - 50) / 50) * 3 - (counter ? 4 : 0)
    back = clamp(Math.min(back, bu - 3, bu - len + (t.press >= 60 ? 5 : 2)), 6, 62) // 블록은 공과 자기 골문 사이에 선다 (앞선만 공 높이까지 나간다) // 두 줄 사이 간격: 내려앉는 팀일수록 촘촘
    const half = halfW ?? 19 - (counter ? 2 : 0) // 수비 블록 폭 약 38m (전술 탭에서 좌우로 벌려 놓은 만큼)
    const out = {}
    for (const p of lineups[side]) {
      const n = N[side][p.id]
      if (n.pos === 'GK') { out[p.id] = { u: clamp(3 + (back - 14) * 0.18, 2.5, 11), v: H / 2 + (bv - H / 2) * 0.22 }; continue }
      const v = clamp(H / 2 + n.l * half + (bv - H / 2) * 0.5, 2.5, H - 2.5)
      out[p.id] = { u: back + n.d * len - Math.min(5, Math.abs(v - bv) * 0.12), v } // 공 쪽 선수가 나가고 먼 쪽은 비스듬히 받쳐 선다 (일자로 서지 않는다)
    }
    return { out, back }
  }
  // 공격 블록 (공이 그 팀 골문에서 au만큼 나아갔고, 공격 진행도 prog 0~1, 공 쪽 측면 flank -1/1)
  const attack = (side, au, av, prog, flank, offside) => {
    const t = T[side]
    const A = ATTACK_SHAPE[t.phil] || ATTACK_SHAPE.balanced
    const back = clamp(Math.min(16 + 18 * (t.line / 100) + (au - 30) * 0.45, au - 7), 12, 60) // 뒤에 남는 수비도 공을 따라 올라온다 (공보다는 뒤에서 받쳐 준다)
    const len = lerp(A.len[0], A.len[1], prog)
    const half = 23 + 8 * (t.width / 100) + A.wide // 공격 폭 약 46~62m
    const hugs = t.focus === 'wings' || t.width >= 65 // 윙어가 터치라인에 붙어 있나
    const out = {}
    for (const p of lineups[side]) {
      const n = N[side][p.id]
      if (n.pos === 'GK') { out[p.id] = { u: clamp(5 + (back - 16) * 0.3, 4, 20), v: H / 2 }; continue }
      let u = back + n.d ** A.pow * len
      let v = H / 2 + n.l * half + (av - H / 2) * 0.12
      const mySide = Math.sign(n.l) || 0
      if (FULLBACK.has(n.slot) && mySide === flank) { u += (6 + (t.mentality / 100) * 9) * prog; v += mySide * 3 } // 오버래핑
      if (WIDE.has(n.slot)) {
        if (hugs) v += mySide * 2.5
        else if (prog > 0.4) v += (H / 2 - v) * 0.35 * prog // 안쪽으로 파고든다
      }
      if (n.slot === 'ST' && prog > 0.5) u += (4 + (t.phil === 'counter' || t.phil === 'direct' ? 5 : 1)) * prog // 뒷공간 침투
      if (n.slot === 'AM') u += 3 * prog
      if (t.phil === 'possession' && prog < 0.45) {
        if (n.slot === 'DM') u -= 6 * (1 - prog) // 수비형 미드가 내려와 빌드업을 돕는다
        if (n.slot === 'CB') v += Math.sign(n.l || (hashId(p.id) % 2 ? 1 : -1)) * 4 // 센터백이 벌려 선다
      }
      if (t.phil === 'counter' && DEEP.has(n.slot)) u -= 4 * prog // 중원은 따라가지 못하고 앞선만 달린다
      out[p.id] = { u: Math.min(u, offside), v: clamp(v, 2.5, H - 2.5) }
    }
    return out
  }

  if (!tick) {
    // 대기 화면·킥오프: 두 팀 모두 자기 진영에서 전술 탭의 배치 모양대로 선다
    const pos = {}
    for (const side of [0, 1]) {
      const { out, back } = defend(side, 40, H / 2, 20 + 8 * (T[side].width / 100)) // 대기·킥오프: 전술 탭의 배치 그대로 넓게 선다
      // 자기 진영 안에 들어오게 블록 길이만 줄인다 (라인이 높은 팀은 앞뒤가 촘촘해 보인다 — 한 줄로 뭉개지지 않게 비율로)
      const front = Math.max(...lineups[side].map((p) => out[p.id].u))
      const k = front > 47 ? (47 - back) / (front - back) : 1
      for (const p of lineups[side]) { const q = out[p.id]; const w = world(side, base[p.id].pos === 'GK' ? q.u : back + (q.u - back) * k, q.v); pos[p.id] = { ...base[p.id], x: w.x + wobble(p.id, 0, 0.5), y: w.y + wobble(p.id, 1, 0.5) } }
    }
    return { pos, ball: { x: W / 2, y: H / 2, z: 0 }, steps: 1, kind: 'ground' }
  }

  const atk = tick.t
  const dfn = 1 - atk
  const dir = atk === 0 ? 1 : -1 // 공격 방향 (x 증가 = 홈의 공격 방향)
  const shot = tick.k === 'goal' || tick.k === 'save' || tick.k === 'miss'
  const chain = passChain(lineups[atk], tick, base)
  const holder = live?.holder ?? chain[Math.min(sub, chain.length - 1)]
  const prog = live ? live.prog : chain.length > 1 ? Math.min(1, sub / (chain.length - 1)) : 1 // 공격 진행도 0(빌드업)~1(마무리)
  // 역습 장면은 철학과 상관없이 역습 모양(깊은 곳에서 출발해 앞선이 달린다)
  const A = tick.ev === 'counter' ? ATTACK_SHAPE.counter : ATTACK_SHAPE[T[atk].phil] || ATTACK_SHAPE.balanced
  // 이번 공격이 어느 측면으로 가는지 (공격 팀 기준 -1 왼쪽 / 1 오른쪽): 매치업 통로가 측면이면 그 쪽
  const laneSide = (tick.ch === 'left' || tick.ch === 'right') && N[atk][tick.w] ? Math.sign(N[atk][tick.w].l) : 0
  const flank = laneSide || (rand(tick.m * 53 + atk) < 0.5 ? -1 : 1)
  const central = tick.ch === 'center' || tick.ch === 'air'
  // 공의 기준점 (공격 팀 기준): 철학에 따라 출발 깊이가 다르고, 슈팅이면 박스 근처까지 간다
  // 압박에 뺏기는 장면은 자기 진영에서 끝나고, 막힌 전진은 박스 앞에서 끝난다
  const au0 = lerp(A.from, shot ? 88 : tick.ev === 'press' ? A.from + 8 : tick.ev && tick.ev !== 'build' ? 78 : A.to, prog)
  const spread = central ? 6 : 20 + (T[atk].width / 100) * 8
  const av0 = H / 2 + flank * spread * Math.sin(Math.min(1, prog * 1.15) * Math.PI) * (shot ? 0.85 : 1) // 측면으로 나갔다가 마무리 때 안으로
  const liveRef = live ? rel(atk, live.x, live.y) : null
  const au = liveRef ? clamp(liveRef.u, 4, 101) : au0
  const av = liveRef ? liveRef.v : av0
  const refW = world(atk, au, av)
  const refD = rel(dfn, refW.x, refW.y)

  const D = defend(dfn, refD.u, refD.v)
  // 오프사이드 선: 수비의 맨 뒷줄 바로 앞까지만 (공보다 앞이면 그보다 조금 뒤)
  const offside = Math.max(au + 2, W - D.back - 1)
  const Aout = attack(atk, au, av, prog, flank, offside)
  const pos = {}
  for (const side of [0, 1]) {
    const src = side === atk ? Aout : D.out
    for (const p of lineups[side]) {
      const q = src[p.id]
      const w = world(side, q.u, q.v)
      const gk = base[p.id].pos === 'GK'
      pos[p.id] = { ...base[p.id], x: w.x + wobble(p.id, 0, gk ? 0.3 : 1.2), y: w.y + wobble(p.id, 1, gk ? 0.6 : 1.6) }
    }
  }
  // 공 가진 선수는 기준점 근처에 있다 (자기 자리와 기준점 사이)
  const c = pos[holder]
  if (!live) {
    c.x += (refW.x - c.x) * 0.65
    c.y += (refW.y - c.y) * 0.65
  }

  let ball = { x: c.x + dir * 1.2, y: c.y, z: 0 }
  const goalX = atk === 0 ? W : 0
  if (shot && shotStage) {
    const jitter = rand(tick.m * 13) - 0.5
    if (tick.k === 'goal') ball = { x: goalX + dir * 1.6, y: H / 2 + jitter * 5, z: 3 }
    if (tick.k === 'save') ball = { x: goalX - dir * 2.5, y: H / 2 + jitter * 6, z: 2 }
    if (tick.k === 'miss') ball = { x: goalX + dir * 2.5, y: H / 2 + (jitter > 0 ? 1 : -1) * (6 + Math.abs(jitter) * 8), z: 9 }
  }

  // 압박·커버: 가장 가까운 수비가 붙고(압박이 강할수록 바짝, 두 명까지), 다음 선수가 뒤에서 커버
  const press = T[dfn].press
  const defenders = lineups[dfn].filter((p) => pos[p.id].pos !== 'GK')
    .map((p) => ({ p, d: (pos[p.id].x - c.x) ** 2 + (pos[p.id].y - c.y) ** 2 })).sort((a, b) => a.d - b.d)
  const gap = lerp(4.2, 1.8, press / 100)
  if (defenders[0] && !(shot && shotStage)) pos[defenders[0].p.id] = { ...pos[defenders[0].p.id], x: c.x + dir * gap, y: c.y + 1.1 }
  if (defenders[1]) {
    const q = pos[defenders[1].p.id]
    pos[defenders[1].p.id] = press >= 70 && !(shot && shotStage) ? { ...q, x: c.x + dir * (gap + 1.5), y: c.y - 2.6 } : { ...q, x: c.x + dir * 7, y: c.y + (H / 2 - c.y) * 0.3 }
  }
  // 슈팅 장면: 다른 공격수들이 박스 안으로 들어온다
  if (shot && prog > 0.5) {
    for (const p of lineups[atk]) {
      const q = pos[p.id]
      if (p.id !== holder && q.pos === 'FW') { q.x = goalX - dir * (8 + (hashId(p.id) % 6)); q.y += (H / 2 - q.y) * 0.5 }
    }
  }
  // 선방이면 상대 GK가 공 쪽으로 몸을 날린다
  if (tick.k === 'save' && shotStage) {
    const gk = lineups[dfn].find((p) => pos[p.id].pos === 'GK')
    if (gk) pos[gk.id] = { ...pos[gk.id], x: ball.x - dir * 0.6, y: ball.y }
  }

  for (const id in pos) {
    pos[id].x = clamp(pos[id].x, 1.5, W - 1.5)
    pos[id].y = clamp(pos[id].y, 1.5, H - 1.5)
  }
  ball.x = clamp(ball.x, -2.5, W + 2.5)
  ball.y = clamp(ball.y, -1, H + 1)
  // 공을 뺏긴 장면(사슬 엔진): 마지막 단계에서 뺏은 수비수가 공을 갖는다
  const lostStep = !!tick.lost && !shot && sub >= chain.length && pos[tick.lost]
  if (lostStep) {
    pos[tick.lost] = { ...pos[tick.lost], x: c.x + dir * 0.9, y: c.y + 0.4 }
    ball = { x: pos[tick.lost].x - dir * 1.1, y: pos[tick.lost].y, z: 0 }
  }
  // 공이 이 단계로 온 방식: 직선 철학의 첫 전진·먼 거리는 뜬 공, 측면에서 마무리로 들어가는 패스는 크로스
  const last = sub >= chain.length - 1
  const kind = tick.ev ? (sub === 0 || lostStep ? 'ground' : tick.ev === 'long' && sub === 1 ? 'loft' : shot && last && tick.fin === 'cross' ? 'cross' : 'ground') : sub === 0 ? 'ground' : shot && last && !central && tick.ch ? 'cross' : (T[atk].phil === 'direct' && sub === 1) || (T[atk].passing >= 75 && sub === 1) || tick.ch === 'air' ? 'loft' : 'ground'
  return { pos, ball, carrier: shot && shotStage ? null : lostStep ? tick.lost : holder, steps: chain.length + (tick.lost && !shot ? 1 : 0), kind: shot && shotStage ? 'shot' : kind, chain }
}

/** 진단용: 그 장면에서 한 팀의 블록 모양 (맨 뒷줄 높이·길이·폭) — 철학별 차이를 숫자로 확인한다 */
export function blockOf(frame, lineups, side) {
  const f = lineups[side].map((p) => frame.pos[p.id]).filter((q) => q && q.pos !== 'GK')
  const us = f.map((q) => (side === 0 ? q.x : W - q.x))
  const vs = f.map((q) => q.y)
  return { back: Math.min(...us), front: Math.max(...us), length: Math.max(...us) - Math.min(...us), width: Math.max(...vs) - Math.min(...vs) }
}

/**
 * 세트피스 장면: 코너킥·직접 프리킥·크로스 프리킥·페널티킥
 *  sub 0 = 준비(공이 킥 지점, 선수들이 박스로 모인다) · sub 1 = 킥(크로스가 머리로) · shotStage = 슈팅 결과
 */
export function setPieceFrame(lineups, tick, sub, shotStage) {
  const base = { ...basePositions(lineups[0], 0), ...basePositions(lineups[1], 1) }
  const atk = tick.t
  const dir = atk === 0 ? 1 : -1
  const goalX = atk === 0 ? W : 0
  const side = tick.side || 1
  const seed = tick.m * 97 + (tick.i || 0) * 13
  const h = (id, k) => (hashId(`${id}-${k}`) % 1000) / 1000
  let spot
  if (tick.sp === 'corner') spot = { x: goalX - dir * 0.6, y: side > 0 ? H - 0.6 : 0.6 }
  else if (tick.sp === 'pen') spot = { x: goalX - dir * 11, y: H / 2 }
  else if (tick.sp === 'fk') spot = { x: goalX - dir * (21 + rand(seed) * 7), y: H / 2 + side * (3 + rand(seed + 1) * 10) }
  else spot = { x: goalX - dir * (27 + rand(seed) * 8), y: side > 0 ? H - 7 - rand(seed + 2) * 6 : 7 + rand(seed + 2) * 6 }
  const pos = {}
  const kt = tick.kt ?? tick.p
  const atkField = lineups[atk].filter((p) => base[p.id].pos !== 'GK')
  // 공격팀: 가장 뒤에 선 2명은 역습 대비로 남고, 나머지는 박스 안으로
  const stay = new Set([...atkField].sort((a, b) => (base[a.id].x - base[b.id].x) * dir).slice(0, 2).map((p) => p.id))
  for (const p of lineups[atk]) {
    const b = base[p.id]
    if (b.pos === 'GK') { pos[p.id] = { ...b }; continue }
    if (p.id === kt) { pos[p.id] = { ...b, x: spot.x - dir * 0.8, y: spot.y }; continue }
    if (tick.sp === 'pen') { pos[p.id] = { ...b, x: goalX - dir * (18 + h(p.id, 1) * 5), y: H / 2 + (h(p.id, 2) - 0.5) * 34 }; continue }
    if (stay.has(p.id)) { pos[p.id] = { ...b, x: W / 2 + dir * (4 + h(p.id, 1) * 8), y: H / 2 + (h(p.id, 2) - 0.5) * 30 }; continue }
    pos[p.id] = { ...b, x: goalX - dir * (5 + h(p.id, 1) * 10), y: H / 2 + (h(p.id, 2) - 0.5) * 26 }
  }
  // 수비팀: 골키퍼는 골라인, 직접 프리킥이면 벽 4명, 역습 대비 1명은 하프라인 근처
  const defField = lineups[1 - atk].filter((p) => base[p.id].pos !== 'GK')
  const outlet = [...defField].sort((a, b) => (base[a.id].x - base[b.id].x) * dir)[0]?.id
  const toGoal = { x: goalX - spot.x, y: H / 2 - spot.y }
  const len = Math.hypot(toGoal.x, toGoal.y) || 1
  const wallC = { x: spot.x + (toGoal.x / len) * 9.15, y: spot.y + (toGoal.y / len) * 9.15 }
  let wi = 0
  for (const p of lineups[1 - atk]) {
    const b = base[p.id]
    if (b.pos === 'GK') { pos[p.id] = { ...b, x: goalX - dir * 0.8, y: H / 2 + (tick.sp === 'corner' ? side * 1.5 : 0) }; continue }
    if (tick.sp === 'pen') { pos[p.id] = { ...b, x: goalX - dir * (18 + h(p.id, 3) * 5), y: H / 2 + (h(p.id, 4) - 0.5) * 34 }; continue }
    if (p.id === outlet && tick.sp !== 'fk') { pos[p.id] = { ...b, x: W / 2 - dir * 2, y: H / 2 + (h(p.id, 4) - 0.5) * 16 }; continue }
    if (tick.sp === 'fk' && wi < 4) { const o = (wi++ - 1.5) * 0.9; pos[p.id] = { ...b, x: wallC.x - (toGoal.y / len) * o, y: wallC.y + (toGoal.x / len) * o }; continue }
    pos[p.id] = { ...b, x: goalX - dir * (3 + h(p.id, 3) * 11), y: H / 2 + (h(p.id, 4) - 0.5) * 24 }
  }
  let ball = { x: spot.x, y: spot.y, z: 0 }
  let carrier = kt
  const aerial = tick.sp === 'corner' || tick.sp === 'fkx'
  if (aerial && sub >= 1) {
    // 크로스: 슈팅한 선수(헤더) 머리로, 걷어냈으면 수비 머리로 갔다가 박스 밖으로
    const target = tick.k === 'clear' ? defField.map((p) => p.id).find((id) => id !== outlet) : tick.p
    const q = pos[target]
    if (q) { q.x = goalX - dir * (6 + h(target, 5) * 5); q.y = H / 2 + (h(target, 6) - 0.5) * 12; ball = { x: q.x, y: q.y, z: 6 } }
    carrier = null
    // 걷어낸 경우: 1단계 = 크로스가 수비 머리에 닿음 → 2단계 = 박스 밖으로 걷어냄 (예전엔 1단계를 건너뛰어 크로스가 빈 곳으로 가는 것처럼 보였다)
    if (tick.k === 'clear' && sub >= 2) ball = { x: goalX - dir * 26, y: H / 2 + (rand(seed + 3) - 0.5) * 30, z: 8 }
  }
  if (shotStage) {
    const jitter = rand(seed + 4) - 0.5
    if (tick.k === 'goal') ball = { x: goalX + dir * 1.6, y: H / 2 + jitter * 5, z: 3 }
    if (tick.k === 'save') {
      ball = { x: goalX - dir * 1.2, y: H / 2 + jitter * 6, z: 2 }
      const gk = lineups[1 - atk].find((p) => base[p.id].pos === 'GK')
      if (gk) pos[gk.id] = { ...pos[gk.id], y: ball.y }
    }
    if (tick.k === 'miss') ball = { x: goalX + dir * 2.5, y: H / 2 + (jitter > 0 ? 1 : -1) * (5 + Math.abs(jitter) * 8), z: 9 }
    carrier = null
  }
  for (const id in pos) { pos[id].x = clamp(pos[id].x, 0.8, W - 0.8); pos[id].y = clamp(pos[id].y, 0.8, H - 0.8) }
  return { pos, ball, carrier, steps: aerial ? (tick.k === 'clear' ? 3 : 2) : 1 }
}

/** 재개 장면: 골킥·골키퍼 캐치·스로인·프리킥 — 마지막 장면의 선수 위치에서 공만 재개 지점으로 */
export function applyRestart(f, tick, lineups) {
  const atk = tick.t
  const dir = atk === 0 ? 1 : -1
  const goalX = atk === 0 ? W : 0
  const dgk = lineups[1 - atk].find((p) => f.pos[p.id]?.pos === 'GK')
  const near = (team, pt) => lineups[team].filter((p) => f.pos[p.id] && f.pos[p.id].pos !== 'GK')
    .map((p) => ({ id: p.id, d: (f.pos[p.id].x - pt.x) ** 2 + (f.pos[p.id].y - pt.y) ** 2 })).sort((a, b) => a.d - b.d)[0]?.id
  const pos = { ...f.pos }
  let ball = f.ball
  let carrier = f.carrier
  if (tick.r === 'goalkick') {
    ball = { x: goalX - dir * 5.5, y: H / 2 + 7, z: 0 }
    if (dgk) { pos[dgk.id] = { ...pos[dgk.id], x: ball.x + dir * 0.9, y: ball.y }; carrier = dgk.id }
  } else if (tick.r === 'gk') {
    if (dgk) { const q = pos[dgk.id]; ball = { x: q.x, y: q.y, z: 1 }; carrier = dgk.id }
  } else if (tick.r === 'throw') {
    const c = pos[f.carrier] || f.ball
    ball = { x: c.x, y: c.y < H / 2 ? 0.2 : H - 0.2, z: 2 }
    const t = near(rand(tick.m * 7 + 3) < 0.5 ? atk : 1 - atk, ball)
    if (t) { pos[t] = { ...pos[t], x: ball.x, y: ball.y < H / 2 ? 0.8 : H - 0.8 }; carrier = t }
  } else if (tick.r === 'fk' || tick.r === 'offside') {
    ball = { ...f.ball, z: 0 }
    const t = near(tick.r === 'fk' ? atk : 1 - atk, ball)
    if (t) { pos[t] = { ...pos[t], x: ball.x - dir * (tick.r === 'fk' ? 0.8 : -0.8), y: ball.y }; carrier = t }
  }
  return { ...f, pos, ball, carrier }
}
