// 포켓몬 배틀식 면담 화면: 위쪽 선수(신뢰도 게이지) vs 아래쪽 감독, 대사창에 한 글자씩 출력
// 명령: 달래기 · 약속 · 압박 · 직접 말하기 · 끝내기 → AI(또는 규칙 기반)가 선수 대사로 답한다
import { useEffect, useRef, useState } from 'react'
import { Kit, Flag } from './Badges.jsx'
import MgrBadge from './MgrBadge.jsx'
import { MAX_TURNS, OUTCOME_LABEL, sayToPlayer, startTrust } from '../game/aiTalk.js'
import { personality, personalityText } from '../game/speech.js'
import { playerOvr } from '../store.jsx'

const QUICK = [
  ['soothe', '🤝 달래기', '네 마음 이해한다. 너는 우리 팀에 꼭 필요한 선수야.'],
  ['promise', '✍️ 약속', '다음 경기에 선발로 기회 줄게. 약속한다.'],
  ['press', '📢 압박', '불만 있으면 훈련장에서 실력으로 보여줘.'],
]

/** 대사를 한 글자씩 */
function useTyping(text, speed = 28) {
  const [shown, setShown] = useState('')
  useEffect(() => {
    setShown('')
    if (!text) return undefined
    let i = 0
    const t = setInterval(() => { i += 1; setShown(text.slice(0, i)); if (i >= text.length) clearInterval(t) }, speed)
    return () => clearInterval(t)
  }, [text])
  return [shown, shown.length >= (text || '').length]
}

export default function TalkBattle({ player, team, status, manager, reason, situation, onFinish, onClose }) {
  const st = status || {}
  const trust0 = startTrust(st)
  const [trust, setTrust] = useState(trust0)
  const [lines, setLines] = useState([]) // { role: 'manager'|'player', text }
  const [say, setSay] = useState(reason ? `${player.name}이(가) 면담을 요청했다!` : `감독이 ${player.name}을(를) 불렀다!`)
  const [mood, setMood] = useState('')
  const [busy, setBusy] = useState(false)
  const [typing, setTyping] = useState(false)
  const [input, setInput] = useState('')
  const [outcome, setOutcome] = useState(null)
  const [fx, setFx] = useState('') // 'hit' | 'heal'
  const [ai, setAi] = useState(true)
  const inputRef = useRef(null)
  const [shown, done] = useTyping(say)
  const turns = lines.filter((l) => l.role === 'manager').length
  const pers = personalityText(personality(player))

  // 선수가 먼저 용건을 말한다
  useEffect(() => {
    const t = setTimeout(() => talk('(면담이 시작됐다. 네가 먼저 지금 하고 싶은 말을 해라)', true), 1400)
    return () => clearTimeout(t)
  }, [])

  async function talk(message, opening = false) {
    if (busy || outcome) return
    setBusy(true)
    setTyping(false)
    if (!opening) setSay(`감독: "${message}"`)
    const history = lines
    const r = await sayToPlayer({ player, team, status: st, message, history, trust, reason, situation })
    setAi(r.ai)
    const nextTrust = Math.max(0, Math.min(100, trust + (opening ? 0 : r.trustDelta)))
    if (!opening && r.trustDelta) { setFx(r.trustDelta < 0 ? 'hit' : 'heal'); setTimeout(() => setFx(''), 600) }
    setTrust(nextTrust)
    setMood(r.mood)
    const nextLines = [...lines, ...(opening ? [] : [{ role: 'manager', text: message }]), { role: 'player', text: r.reply }]
    setLines(nextLines)
    const said = String(r.reply).trim().replace(/^["“”']+|["“”']+$/g, '') // 대사에 이미 붙은 따옴표는 뗀다
    setTimeout(() => setSay(`${player.name.split(' ').at(-1)}: "${said}"`), opening ? 0 : 500)
    const mTurns = nextLines.filter((l) => l.role === 'manager').length
    const fin = !opening && (r.outcome !== 'none' || r.end || mTurns >= MAX_TURNS)
    if (fin) setOutcome({ outcome: r.outcome === 'none' ? (nextTrust >= trust0 + 8 ? 'calm' : 'none') : r.outcome, trustStart: trust0, trustEnd: nextTrust, lines: nextLines, ai: r.ai })
    setBusy(false)
  }

  const send = () => { const t = input.trim(); if (!t) return; setInput(''); setTyping(false); talk(t) }
  const quit = () => setOutcome({ outcome: 'none', trustStart: trust0, trustEnd: trust, lines, ai })
  const tone = trust >= 60 ? 'hi' : trust >= 30 ? 'mid' : 'lo'
  const res = outcome && OUTCOME_LABEL[outcome.outcome]

  return (
    <div className="tb-wrap">
      <div className="tb-arena">
        <div className="tb-foe-box">
          <div className="tb-name"><Flag nation={player.nation} size={13} /> {player.name} <small>Lv.{playerOvr(player)}</small></div>
          <div className="tb-hp"><span>신뢰</span><i className={tone} style={{ width: `${trust}%` }} /></div>
          <div className="tb-sub">{trust}/100{mood ? ` · ${mood}` : ''}</div>
        </div>
        <div className={`tb-foe ${fx}`}>
          <span className="tb-plat" />
          <Kit color={team.color} number={player.number} size={78} />
        </div>
        <div className="tb-me">
          <span className="tb-plat" />
          <MgrBadge name={manager?.name || '감독'} color={team.color} size={64} />
        </div>
        <div className="tb-me-box">
          <div className="tb-name">{manager?.name || '감독'} <small>감독</small></div>
          <div className="tb-sub">남은 대화 {Math.max(0, MAX_TURNS - turns)}번 · {pers.join(' · ')}</div>
        </div>
      </div>

      <div className="tb-dialog">
        <p>{shown}{!done && <span className="tb-caret">▌</span>}</p>
        {busy && done && <span className="tb-wait">···</span>}
        {!ai && <span className="tb-mode">규칙 기반 대화 중 (AI 연결 안 됨)</span>}
      </div>

      {!outcome && (
        typing ? (
          <div className="tb-input">
            <input ref={inputRef} autoFocus value={input} maxLength={120} placeholder="선수에게 할 말 (예: 꼬우면 이적해라)" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
            <button className="btn small" disabled={!input.trim() || busy} onClick={send}>말하기</button>
            <button className="btn ghost small" onClick={() => setTyping(false)}>취소</button>
          </div>
        ) : (
          <div className="tb-menu">
            {QUICK.map(([k, label, text]) => <button key={k} disabled={busy || !lines.length} onClick={() => talk(text)}>{label}</button>)}
            <button className="tb-say" disabled={busy || !lines.length} onClick={() => setTyping(true)}>💬 직접 말하기</button>
            <button className="tb-quit" disabled={busy} onClick={quit}>🚪 끝내기</button>
          </div>
        )
      )}

      {outcome && (
        <div className="tb-result">
          <strong>{res[0]} {res[1]}</strong>
          <span>신뢰도 {outcome.trustStart} → {outcome.trustEnd} · 사기 {Math.round((outcome.trustEnd - outcome.trustStart) * 0.6) >= 0 ? '+' : ''}{Math.round((outcome.trustEnd - outcome.trustStart) * 0.6)}</span>
          <button className="btn wide" onClick={() => onFinish(outcome)}>확인</button>
        </div>
      )}
      {!outcome && turns === 0 && <button className="tb-close" onClick={onClose} aria-label="닫기">✕</button>}
    </div>
  )
}
