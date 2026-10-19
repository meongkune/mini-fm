import { useEffect, useMemo, useState } from 'react'
import { ink, short } from '../store.jsx'

// 경기장 좌표계: 가로 105 x 세로 68 (실제 경기장 m 비율). 홈(0)은 오른쪽(x=105), 원정(1)은 왼쪽(x=0)으로 공격
const W = 105
const H = 68
const ROW_X = { GK: 5, DF: 21, MF: 38, FW: 49 }
const BUILD_ROLES = [['DF', 0.3], ['MF', 0.75], ['FW', 1]]

// 분·팀으로 고정되는 난수 (같은 경기는 다시 봐도 같은 움직임)
function rand(seed) {
  let t = (seed + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

function basePositions(xi, side) {
  const out = {}
  for (const pos of ['GK', 'DF', 'MF', 'FW']) {
    const row = xi.filter((p) => p.pos === pos)
    row.forEach((p, i) => {
      const x = ROW_X[pos]
      const y = (H * (i + 1)) / (row.length + 1)
      out[p.id] = { x: side === 0 ? x : W - x, y: side === 0 ? y : H - y, side, pos }
    })
  }
  return out
}

// 한 분(tick)의 상황 → 선수 22명 위치 + 공 위치/높이
function computeFrame(lineups, tick, stage) {
  const base = { ...basePositions(lineups[0], 0), ...basePositions(lineups[1], 1) }
  const all = [...lineups[0], ...lineups[1]]
  if (!tick) return { pos: base, ball: { x: W / 2, y: H / 2, z: 0 } }

  const atk = tick.t
  const dir = atk === 0 ? 1 : -1 // 공격 방향 (x 증가 = 홈의 공격 방향)
  const pos = {}
  // 공격팀은 전진, 수비팀은 자기 골문 쪽으로 물러선다
  for (const p of all) {
    const b = base[p.id]
    // 포지션별로 전진 폭을 다르게 (수비수는 덜, 공격수는 더) — 공격권이 바뀌면 진영 전체가 밀고 당겨진다
    const push = b.pos === 'GK' ? 0 : b.side === atk ? { DF: 12, MF: 16, FW: 18 }[b.pos] : 7
    pos[p.id] = { ...b, x: b.x + dir * push }
  }

  // 공을 가진 선수: 슈팅이면 슈터, 아니면 공격팀 DF/MF/FW 중 하나
  const mine = lineups[atk]
  let carrier = tick.k !== 'build' && tick.k !== 'card' ? mine.find((p) => p.id === tick.p) : null
  if (!carrier) {
    const r = rand(tick.m * 31 + atk)
    const role = BUILD_ROLES.find(([, cut]) => r < cut)[0]
    const pool = mine.filter((p) => p.pos === role)
    const cands = pool.length ? pool : mine.filter((p) => p.pos !== 'GK')
    carrier = cands[Math.floor(rand(tick.m * 97 + atk) * cands.length)]
  }
  const c = pos[carrier.id]
  let ball = { x: c.x + dir * 1.2, y: c.y, z: 0 }

  // 슈팅 2단계: 공이 골문으로 날아간다
  const shot = tick.k === 'goal' || tick.k === 'save' || tick.k === 'miss'
  const goalX = atk === 0 ? W : 0
  if (shot && stage === 1) {
    const jitter = (rand(tick.m * 13) - 0.5)
    if (tick.k === 'goal') ball = { x: goalX + dir * 1.6, y: H / 2 + jitter * 5, z: 3 }
    if (tick.k === 'save') ball = { x: goalX - dir * 2.5, y: H / 2 + jitter * 6, z: 2 }
    if (tick.k === 'miss') ball = { x: goalX + dir * 2.5, y: H / 2 + (jitter > 0 ? 1 : -1) * (6 + Math.abs(jitter) * 8), z: 9 }
  } else if (shot) {
    ball.z = 1
  }

  // 모든 선수가 공 쪽으로 조금씩 쏠림 (GK는 골문 앞에서 좌우만)
  for (const p of all) {
    const q = pos[p.id]
    if (q.pos === 'GK') {
      q.y = q.y + (ball.y - q.y) * 0.25
    } else {
      q.x += (ball.x - q.x) * 0.16
      q.y += (ball.y - q.y) * 0.2
    }
  }
  // 수비팀에서 공과 가장 가까운 선수는 압박하러 붙는다
  const defenders = lineups[1 - atk].filter((p) => p.pos !== 'GK')
  let near = null
  let best = Infinity
  for (const p of defenders) {
    const d = (pos[p.id].x - c.x) ** 2 + (pos[p.id].y - c.y) ** 2
    if (d < best) { best = d; near = p }
  }
  if (near && !(shot && stage === 1)) pos[near.id] = { ...pos[near.id], x: c.x + dir * 2.6, y: c.y + 1.4 }
  // 선방이면 상대 GK가 공 쪽으로 몸을 날린다
  if (tick.k === 'save' && stage === 1) {
    const gk = lineups[1 - atk].find((p) => p.pos === 'GK')
    if (gk) pos[gk.id] = { ...pos[gk.id], x: ball.x - dir * 0.6, y: ball.y }
  }

  for (const id in pos) {
    pos[id].x = clamp(pos[id].x, 1.5, W - 1.5)
    pos[id].y = clamp(pos[id].y, 1.5, H - 1.5)
  }
  ball.x = clamp(ball.x, -2.5, W + 2.5)
  ball.y = clamp(ball.y, -1, H + 1)
  return { pos, ball, carrier: carrier.id }
}

// 모바일 세로 화면: 경기 좌표(x 0~105, y 0~68)를 화면 좌표로 변환한다.
// 내 팀(myIdx)이 항상 화면 아래 → 위로 공격하도록 돌린다.
function toScreen(x, y, myIdx) {
  const up = myIdx === 0 ? (W - x) / W : x / W // 위쪽이 0
  const side = myIdx === 0 ? y / H : (H - y) / H
  return { left: `${side * 100}%`, top: `${up * 100}%` }
}

export default function MatchPitch({ home, away, lineups, tick, duration = 300, scorerName, idleLabel = '킥오프 대기', myIdx = 0, caption = null }) {
  const [stage, setStage] = useState(0)

  // 슈팅 장면은 2단계: 슈터가 공을 잡고 → 잠시 뒤 골문으로
  useEffect(() => {
    setStage(0)
    if (!tick || !['goal', 'save', 'miss'].includes(tick.k)) return undefined
    const t = setTimeout(() => setStage(1), Math.max(120, duration * 0.35))
    return () => clearTimeout(t)
  }, [tick, duration])

  const frame = useMemo(() => (lineups ? computeFrame(lineups, tick, stage) : null), [lineups, tick, stage])
  if (!frame) return <div className="pitch-stage empty">선발 명단을 불러오는 중…</div>

  // 이동 속도: 분 간격에 맞춰 부드럽게 (너무 빠르면 순간이동처럼 보이므로 하한)
  const move = Math.max(140, Math.min(700, duration * 0.8))
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
