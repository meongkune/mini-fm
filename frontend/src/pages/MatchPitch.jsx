import { useEffect, useMemo, useState } from 'react'
import { ink, short } from '../store.jsx'

// 경기장 좌표계: 가로 105 x 세로 68 (실제 경기장 m 비율). 홈(0)은 오른쪽(x=105), 원정(1)은 왼쪽(x=0)으로 공격
const W = 105
const H = 68
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
  return chain
}

/**
 * 한 장면(분 tick의 sub 번째 패스) → 선수 22명 위치 + 공
 *  - 공격팀: 공이 앞으로 갈수록 라인을 올리고, 풀백은 공 쪽 측면으로 오버래핑, 윙어는 안쪽으로 파고들고, 스트라이커는 뒷공간으로 뛴다
 *  - 수비팀: 자기 골문 쪽으로 물러서며 공 쪽으로 좁혀 서고, 가장 가까운 선수가 압박, 다음 선수가 커버
 *  - 모든 선수가 조금씩 제멋대로 움직인다 (자리만 지키는 딱딱한 대형이 되지 않게)
 */
function computeFrame(lineups, tick, sub, shotStage) {
  const base = { ...basePositions(lineups[0], 0), ...basePositions(lineups[1], 1) }
  const all = [...lineups[0], ...lineups[1]]
  const time = (tick?.m ?? 0) + sub * 0.33
  const wobble = (id, k, amp) => {
    const h = hashId(id)
    return Math.sin(time * (0.9 + (h % 7) * 0.13) + (h % 628) / 100 + k * 1.7) * amp
  }
  if (!tick) {
    const pos = {}
    for (const p of all) { const b = base[p.id]; pos[p.id] = { ...b, x: b.x + wobble(p.id, 0, 0.6), y: b.y + wobble(p.id, 1, 0.6) } }
    return { pos, ball: { x: W / 2, y: H / 2, z: 0 }, steps: 1 }
  }

  const atk = tick.t
  const dir = atk === 0 ? 1 : -1 // 공격 방향 (x 증가 = 홈의 공격 방향)
  const shot = tick.k === 'goal' || tick.k === 'save' || tick.k === 'miss'
  const chain = passChain(lineups[atk], tick, base)
  const holder = chain[Math.min(sub, chain.length - 1)]
  const prog = chain.length > 1 ? Math.min(1, sub / (chain.length - 1)) : 1 // 공격 진행도 0(빌드업)~1(마무리)
  // 이번 공격이 어느 측면으로 가는지 — 풀백 오버래핑에 쓴다
  const flank = rand(tick.m * 53 + atk) < 0.5 ? -1 : 1

  const pos = {}
  for (const p of all) {
    const b = base[p.id]
    let x = b.x
    let y = b.y
    if (b.pos !== 'GK') {
      if (b.side === atk) {
        x += dir * { DF: 6 + 8 * prog, MF: 10 + 10 * prog, FW: 12 + 10 * prog }[b.pos]
        const side = Math.sign(b.y - H / 2) * dir // 그 선수가 서 있는 쪽 (-1/1)
        if (FULLBACK.has(b.slot) && side === flank) { x += dir * 12 * prog; y += b.y < H / 2 ? -3 : 3 }
        if (WIDE.has(b.slot) && prog > 0.4) y += (H / 2 - y) * 0.3 * prog // 안쪽으로 파고든다
        if (b.slot === 'ST' && prog > 0.5) x += dir * 6 * prog // 수비 뒷공간 침투
      } else {
        x -= dir * { DF: 3 + 4 * prog, MF: 5 + 5 * prog, FW: 2 + 3 * prog }[b.pos]
      }
    }
    x += wobble(p.id, 0, b.pos === 'GK' ? 0.4 : 1.6)
    y += wobble(p.id, 1, b.pos === 'GK' ? 0.8 : 2.2)
    pos[p.id] = { ...b, x, y }
  }

  // 공: 지금 공을 가진 선수 발 앞
  const c = pos[holder]
  let ball = { x: c.x + dir * 1.2, y: c.y, z: 0 }
  const goalX = atk === 0 ? W : 0
  if (shot && shotStage) {
    const jitter = rand(tick.m * 13) - 0.5
    if (tick.k === 'goal') ball = { x: goalX + dir * 1.6, y: H / 2 + jitter * 5, z: 3 }
    if (tick.k === 'save') ball = { x: goalX - dir * 2.5, y: H / 2 + jitter * 6, z: 2 }
    if (tick.k === 'miss') ball = { x: goalX + dir * 2.5, y: H / 2 + (jitter > 0 ? 1 : -1) * (6 + Math.abs(jitter) * 8), z: 9 }
  }

  // 공 쪽으로 쏠림: 수비팀은 많이(공간을 좁힘), 공격팀은 조금(패스 길을 만든다). GK는 골문 앞에서 좌우만
  for (const p of all) {
    if (p.id === holder) continue
    const q = pos[p.id]
    if (q.pos === 'GK') { q.y += (ball.y - q.y) * 0.3; continue }
    const k = q.side === atk ? [0.08, 0.12] : [0.18, 0.32]
    q.x += (ball.x - q.x) * k[0]
    q.y += (ball.y - q.y) * k[1]
  }
  // 수비: 가장 가까운 선수는 압박, 두 번째는 뒤에서 커버
  const defenders = lineups[1 - atk].filter((p) => pos[p.id].pos !== 'GK')
    .map((p) => ({ p, d: (pos[p.id].x - c.x) ** 2 + (pos[p.id].y - c.y) ** 2 })).sort((a, b) => a.d - b.d)
  if (defenders[0] && !(shot && shotStage)) pos[defenders[0].p.id] = { ...pos[defenders[0].p.id], x: c.x + dir * 2.4, y: c.y + 1.2 }
  if (defenders[1]) pos[defenders[1].p.id] = { ...pos[defenders[1].p.id], x: c.x + dir * 7, y: c.y + (H / 2 - c.y) * 0.3 }
  // 슈팅 장면: 다른 공격수들이 박스 안으로 들어온다
  if (shot && prog > 0.5) {
    for (const p of lineups[atk]) {
      const q = pos[p.id]
      if (p.id !== holder && q.pos === 'FW') { q.x = goalX - dir * (8 + (hashId(p.id) % 6)); q.y += (H / 2 - q.y) * 0.5 }
    }
  }
  // 선방이면 상대 GK가 공 쪽으로 몸을 날린다
  if (tick.k === 'save' && shotStage) {
    const gk = lineups[1 - atk].find((p) => pos[p.id].pos === 'GK')
    if (gk) pos[gk.id] = { ...pos[gk.id], x: ball.x - dir * 0.6, y: ball.y }
  }

  for (const id in pos) {
    pos[id].x = clamp(pos[id].x, 1.5, W - 1.5)
    pos[id].y = clamp(pos[id].y, 1.5, H - 1.5)
  }
  ball.x = clamp(ball.x, -2.5, W + 2.5)
  ball.y = clamp(ball.y, -1, H + 1)
  return { pos, ball, carrier: shot && shotStage ? null : holder, steps: chain.length }
}

// 모바일 세로 화면: 경기 좌표(x 0~105, y 0~68)를 화면 좌표로 변환한다.
// 내 팀(myIdx)이 항상 화면 아래 → 위로 공격하도록 돌린다.
function toScreen(x, y, myIdx) {
  const up = myIdx === 0 ? (W - x) / W : x / W // 위쪽이 0
  const side = myIdx === 0 ? y / H : (H - y) / H
  return { left: `${side * 100}%`, top: `${up * 100}%` }
}

export default function MatchPitch({ home, away, lineups, tick, duration = 300, scorerName, idleLabel = '킥오프 대기', myIdx = 0, caption = null }) {
  // 한 분(tick) 안에서 패스 몇 번(sub)을 차례로 보여주고, 슈팅이면 마지막에 공이 골문으로 날아간다
  const [sub, setSub] = useState(0)
  const steps = tick && lineups ? computeFrame(lineups, tick, 0, false).steps : 1
  const shotTick = !!tick && ['goal', 'save', 'miss'].includes(tick.k)
  const total = steps + (shotTick ? 1 : 0)
  useEffect(() => {
    setSub(0)
    if (!tick) return undefined
    const each = Math.max(60, (shotTick ? duration * 0.7 : duration) / total)
    let i = 0
    const t = setInterval(() => { i++; if (i >= total) { clearInterval(t); return } setSub(i) }, each)
    return () => clearInterval(t)
  }, [tick, duration])
  const stage = shotTick && sub >= steps ? 1 : 0

  const frame = useMemo(() => (lineups ? computeFrame(lineups, tick, Math.min(sub, steps - 1), stage === 1) : null), [lineups, tick, sub, stage])
  if (!frame) return <div className="pitch-stage empty">선발 명단을 불러오는 중…</div>

  // 이동 속도: 분 간격에 맞춰 부드럽게 (너무 빠르면 순간이동처럼 보이므로 하한)
  const move = Math.max(140, Math.min(650, (duration / Math.max(1, total)) * 1.1))
  const fly = Math.max(160, Math.min(650, duration * 0.4))
  const teams = [home, away]
  const goalFlash = tick?.k === 'goal' && stage === 1
  const attackLabel = tick ? `${tick.m}' ${short(teams[tick.t])} 공격` : idleLabel
  const mine = teams[myIdx]
  const theirs = teams[1 - myIdx]

  return (
    <div className="pitch-stage" style={{ '--move': `${move}ms`, '--fly': `${fly}ms` }}>
      <div className="pitch-hud">
        <span className="hud-dot" style={{ background: tick ? teams[tick.t].color : '#94a3b8' }} />
        {attackLabel}
        {tick?.k === 'save' && stage === 1 && <em> · 🧤 선방!</em>}
        {tick?.k === 'miss' && stage === 1 && <em> · 빗나감</em>}
      </div>
      <div className="pitch-plane">
        {/* 경기장은 가로(105x68) 좌표로 그리고 -90도 회전해 세로로 세운다 */}
        <svg className="pitch-lines" viewBox={`0 0 ${H} ${W}`} preserveAspectRatio="none" aria-hidden="true">
          <g transform={`translate(0 ${W}) rotate(-90)`}>
          {Array.from({ length: 10 }, (_, i) => (
            <rect key={i} x={i * 10.5} y="0" width="10.5" height={H} className={i % 2 ? 'stripe a' : 'stripe b'} />
          ))}
          <g className="line">
            <rect x="0.4" y="0.4" width={W - 0.8} height={H - 0.8} />
            <line x1={W / 2} y1="0.4" x2={W / 2} y2={H - 0.4} />
            <circle cx={W / 2} cy={H / 2} r="9.15" />
            <rect x="0.4" y={H / 2 - 20.16} width="16.5" height="40.32" />
            <rect x={W - 16.9} y={H / 2 - 20.16} width="16.5" height="40.32" />
            <rect x="0.4" y={H / 2 - 9.16} width="5.5" height="18.32" />
            <rect x={W - 5.9} y={H / 2 - 9.16} width="5.5" height="18.32" />
          </g>
          <circle cx={W / 2} cy={H / 2} r="0.5" fill="#fff" />
          <rect className="goal" x="-2" y={H / 2 - 3.66} width="2" height="7.32" />
          <rect className="goal" x={W} y={H / 2 - 3.66} width="2" height="7.32" />
          </g>
        </svg>

        {teams.map((team, side) =>
          lineups[side].map((p) => {
            const q = frame.pos[p.id]
            return (
              <div
                key={p.id}
                className={`pl ${p.pos === 'GK' ? 'gk' : ''} ${frame.carrier === p.id ? 'has-ball' : ''}`}
                style={{ ...toScreen(q.x, q.y, myIdx), '--c': team.color, '--ink': ink(team.color) }}
                title={`${p.number} ${p.name} (${team.name})`}
              >
                <span>{p.number}</span>
              </div>
            )
          }),
        )}

        <div className="ball-shadow" style={toScreen(frame.ball.x, frame.ball.y, myIdx)} />
        <div className="ball" style={{ ...toScreen(frame.ball.x, frame.ball.y, myIdx), '--z': `${frame.ball.z * 2.2}px` }} />
      </div>
      <div className="pitch-legend">
        <span style={{ '--c': mine.color }}><i />▲ {short(mine)} (내 팀)</span>
        <span style={{ '--c': theirs.color }}><i />▼ {short(theirs)}</span>
      </div>

      {caption && !goalFlash && (
        <div key={`${caption.minute}-${caption.type}`} className={`pitch-caption ${caption.type}`} style={{ '--c': caption.color }}>
          <span>{caption.minute}'</span>{caption.text}
        </div>
      )}

      {goalFlash && (
        <div className="goal-flash" style={{ '--c': teams[tick.t].color }}>
          <strong>GOAL!</strong>
          <span>{scorerName} · {short(teams[tick.t])}</span>
        </div>
      )}
    </div>
  )
}
