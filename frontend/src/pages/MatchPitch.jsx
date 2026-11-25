import { useEffect, useMemo, useRef, useState } from 'react'
import { ink, short } from '../store.jsx'
import { clockText } from '../engine/match.js'
import { H, W, applyRestart, computeFrame, setPieceFrame } from '../engine/positions.js'

const SP_LABEL = { corner: '🚩 코너킥', fk: '🎯 직접 프리킥', fkx: '🎯 프리킥 크로스', pen: '⚠️ 페널티킥' }
const RESTART_LABEL = { goalkick: '골킥', gk: '골키퍼가 잡아냅니다', throw: '스로인', fk: '프리킥', offside: '오프사이드 → 프리킥' }

// 모바일 세로 화면: 경기 좌표(x 0~105, y 0~68)를 화면 좌표로 변환한다.
// 내 팀(myIdx)이 항상 화면 아래 → 위로 공격하도록 돌린다.
//   land(크게 보기 + 가로 화면): 세로 경기장을 시계 방향으로 눕혀, 내 팀이 왼쪽 → 오른쪽으로 공격한다
function toScreen(x, y, myIdx, land = false) {
  const up = myIdx === 0 ? (W - x) / W : x / W // 위쪽이 0
  const side = myIdx === 0 ? y / H : (H - y) / H
  return land ? { left: `${(1 - up) * 100}%`, top: `${side * 100}%` } : { left: `${side * 100}%`, top: `${up * 100}%` }
}

// 찬스가 난 통로 (개인 매치업) — 경기장 위 공격 표시에 쓴다
const LANE_LABEL = { left: '왼쪽 측면 공격', right: '오른쪽 측면 공격', center: '중앙 돌파', air: '공중볼 공격' }

/**
 * tactics: [홈 전술, 원정 전술] — 선수 위치가 철학·라인·압박·폭을 따라 달라진다 (engine/positions.js)
 * score: 크게 보기에서 보여 줄 점수 [홈, 원정] (화면에 이미 드러난 점수)
 */
export default function MatchPitch({ home, away, lineups, tick, duration = 300, scorerName, idleLabel = '킥오프 대기', myIdx = 0, caption = null, tactics = null, score = null }) {
  // 크게 보기: 경기장을 화면 가득 (전체 화면 API가 되면 그것으로, 안 되면 화면 고정). 가로가 더 길면 경기장을 눕힌다
  const stageRef = useRef(null)
  const [big, setBig] = useState(false)
  const [wide, setWide] = useState(false)
  useEffect(() => {
    if (!big) return undefined
    const fit = () => setWide(window.innerWidth > window.innerHeight)
    const left = () => { if (!document.fullscreenElement) setBig(false) }
    const esc = (e) => { if (e.key === 'Escape') setBig(false) }
    fit()
    window.addEventListener('resize', fit)
    document.addEventListener('fullscreenchange', left)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('resize', fit); document.removeEventListener('fullscreenchange', left); window.removeEventListener('keydown', esc) }
  }, [big])
  const toggleBig = () => {
    if (big) { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); setBig(false); return }
    setBig(true)
    try { stageRef.current?.requestFullscreen?.()?.catch(() => {}) } catch { /* 전체 화면을 못 쓰는 환경: 화면 고정으로만 */ }
  }
  const land = big && wide
  // 한 분(tick) 안에서 패스 몇 번(sub)을 차례로 보여주고, 슈팅이면 마지막에 공이 골문으로 날아간다
  const [sub, setSub] = useState(0)
  const steps = tick && lineups ? (tick.sp ? setPieceFrame(lineups, tick, 0, false).steps : computeFrame(lineups, tick, 0, false, tactics).steps) : 1
  const shotTick = !!tick && ['goal', 'save', 'miss'].includes(tick.k)
  const total = steps + (shotTick ? 1 : 0) + (tick?.r ? 1 : 0)
  useEffect(() => {
    setSub(0)
    if (!tick) return undefined
    const each = Math.max(60, (shotTick ? duration * 0.7 : duration) / total)
    let i = 0
    const t = setInterval(() => { i++; if (i >= total) { clearInterval(t); return } setSub(i) }, each)
    return () => clearInterval(t)
  }, [tick, duration])
  // 0 = 플레이 · 1 = 슈팅 결과 · 2 = 재개(골킥·스로인·프리킥)
  const stage = tick?.r && sub >= total - 1 && sub >= steps ? 2 : shotTick && sub >= steps ? 1 : 0

  const frame = useMemo(() => {
    if (!lineups) return null
    const s = Math.min(sub, steps - 1)
    const f = tick?.sp ? setPieceFrame(lineups, tick, s, stage >= 1 && shotTick) : computeFrame(lineups, tick, s, stage >= 1 && shotTick, tactics)
    return stage === 2 ? applyRestart(f, tick, lineups) : f
  }, [lineups, tick, sub, stage, tactics])
  if (!frame) return <div className="pitch-stage empty">선발 명단을 불러오는 중…</div>

  // 이동 속도: 분 간격에 맞춰 부드럽게 (너무 빠르면 순간이동처럼 보이므로 하한)
  const move = Math.max(140, Math.min(650, (duration / Math.max(1, total)) * 1.1))
  const fly = Math.max(160, Math.min(650, duration * 0.4))
  const teams = [home, away]
  const goalFlash = tick?.k === 'goal' && stage === 1
  const attackLabel = tick ? `${clockText(tick.m, tick.plus)}' ${short(teams[tick.t])} ${tick.sp ? SP_LABEL[tick.sp] : tick.ch ? LANE_LABEL[tick.ch] : '공격'}` : idleLabel
  const mine = teams[myIdx]
  const theirs = teams[1 - myIdx]

  return (
    <div ref={stageRef} className={`pitch-stage ${big ? 'big' : ''} ${land ? 'land' : ''}`} style={{ '--move': `${move}ms`, '--fly': `${fly}ms` }}>
      <button type="button" className="pitch-big" onClick={toggleBig} title={big ? '원래 크기로 (Esc)' : '경기장 크게 보기'} aria-label={big ? '원래 크기로' : '경기장 크게 보기'}>{big ? '✕' : '⛶'}</button>
      {big && score && <div className="pitch-score"><b style={{ '--c': home.color }}>{short(home)}</b> {score[0]} : {score[1]} <b style={{ '--c': away.color }}>{short(away)}</b></div>}
      <div className="pitch-hud">
        <span className="hud-dot" style={{ background: tick ? teams[tick.t].color : '#94a3b8' }} />
        {attackLabel}
        {tick?.k === 'save' && stage === 1 && <em> · 🧤 선방!</em>}
        {tick?.k === 'miss' && stage === 1 && <em> · 빗나감</em>}
        {tick?.k === 'clear' && sub >= 2 && stage !== 2 && <em> · 걷어냅니다</em>}
        {stage === 2 && <em> · {RESTART_LABEL[tick.r]}</em>}
      </div>
      <div className="pitch-plane">
        {/* 경기장은 가로(105x68) 좌표로 그리고 -90도 회전해 세로로 세운다 */}
        <svg className="pitch-lines" viewBox={land ? `0 0 ${W} ${H}` : `0 0 ${H} ${W}`} preserveAspectRatio="none" aria-hidden="true">
          <g transform={land ? undefined : `translate(0 ${W}) rotate(-90)`}>
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
                style={{ ...toScreen(q.x, q.y, myIdx, land), '--c': team.color, '--ink': ink(team.color) }}
                title={`${p.number} ${p.name} (${team.name})`}
              >
                <span>{p.number}</span>
              </div>
            )
          }),
        )}

        <div className="ball-shadow" style={toScreen(frame.ball.x, frame.ball.y, myIdx, land)} />
        {/* 공 궤적: 땅볼은 그대로 굴러가고, 뜬 공·크로스는 포물선을 그린다 (단계마다 애니메이션 이름을 번갈아 써서 다시 시작시킨다) */}
        <div className={`ball ${frame.kind === 'loft' || frame.kind === 'cross' ? `arc ${frame.kind} ${sub % 2 ? 'b' : 'a'}` : ''}`} style={{ ...toScreen(frame.ball.x, frame.ball.y, myIdx, land), '--z': `${frame.ball.z * 2.2}px` }} />
      </div>
      <div className="pitch-legend">
        <span style={{ '--c': mine.color }}><i />{land ? '▶' : '▲'} {short(mine)} (내 팀)</span>
        <span style={{ '--c': theirs.color }}><i />{land ? '◀' : '▼'} {short(theirs)}</span>
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
