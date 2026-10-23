// FM식 면담실: 왼쪽(또는 위) 선수 프로필 · 관계 기록, 가운데 대화 기록, 아래 답변 선택지와 직접 입력
import { useEffect, useRef, useState } from 'react'
import { Kit, Flag } from './Badges.jsx'
import { fetchProfile } from '../game/wiki.js'
import { MAX_TURNS, OUTCOME_LABEL, rankOf, sayToPlayer, startTrust } from '../game/aiTalk.js'
import { TOPICS, relOf } from '../game/relations.js'
import { personality, personalityText } from '../game/speech.js'
import { moraleLabel } from '../game/season.js'
import { playerOvr } from '../store.jsx'

const Bar = ({ value, tone }) => <span className={`tr-bar ${tone}`}><i style={{ width: `${Math.max(2, value)}%` }} /></span>
const toneOf = (v) => (v >= 60 ? 'hi' : v >= 35 ? 'mid' : 'lo')

export default function TalkRoom({ player, team, status, reason, situation, topic = 'general', wage = null, totalRounds = 38, onFinish, onClose }) {
  const st = status || {}
  const T = TOPICS[topic] || TOPICS.general
  const rel = relOf(st)
  const trust0 = startTrust(st)
  const [trust, setTrust] = useState(trust0)
  const [lines, setLines] = useState([]) // { role, text, mood?, delta? }
  const [busy, setBusy] = useState(true)
  const [input, setInput] = useState('')
  const [outcome, setOutcome] = useState(null)
  const [ai, setAi] = useState(true)
  const [photo, setPhoto] = useState(null)
  const logRef = useRef(null)
  const turns = lines.filter((l) => l.role === 'manager').length
  const rank = rankOf(player, team)
  const [face, mLabel] = moraleLabel(st.morale)

  useEffect(() => { fetchProfile(player).then((p) => p?.photo && setPhoto(p.photo)).catch(() => {}) }, [player.id])
  useEffect(() => { talk('(면담이 시작됐다. 네가 먼저 하고 싶은 말을 꺼내라)', null, true) }, [])
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }) }, [lines.length, busy])

  async function talk(message, intent, opening = false) {
    if (outcome) return
    setBusy(true)
    const before = lines
    const withMine = opening ? before : [...before, { role: 'manager', text: message }]
    setLines(withMine)
    const r = await sayToPlayer({ player, team, status: st, message, intent, history: before.map(({ role, text }) => ({ role, text })), trust, reason, situation, topic, wage })
    setAi(r.ai)
    const delta = opening ? 0 : r.trustDelta
    const nextTrust = Math.max(0, Math.min(100, trust + delta))
    setTrust(nextTrust)
    const said = String(r.reply).trim().replace(/^["“”']+|["“”']+$/g, '')
    const next = [...withMine, { role: 'player', text: said, mood: r.mood, delta: opening ? null : delta }]
    setLines(next)
    const mTurns = next.filter((l) => l.role === 'manager').length
    if (!opening && (r.outcome !== 'none' || r.end || mTurns >= MAX_TURNS)) {
      setOutcome({ outcome: r.outcome === 'none' ? (nextTrust >= trust0 + 8 ? 'resolved' : nextTrust <= trust0 - 8 ? 'rejected' : 'none') : r.outcome, trustStart: trust0, trustEnd: nextTrust, lines: next, ai: r.ai, topic, totalRounds })
    }
    setBusy(false)
  }

  const send = () => { const t = input.trim(); if (!t || busy) return; setInput(''); talk(t, null) }
  const quit = () => setOutcome({ outcome: turns ? 'none' : 'none', trustStart: trust0, trustEnd: trust, lines, ai, topic, totalRounds })
  const res = outcome && OUTCOME_LABEL[outcome.outcome]

  return (
    <div className="tr-wrap" role="dialog" aria-label={`${player.name} 면담`}>
      <div className="tr-panel">
        <header className="tr-head">
          <span className="tr-topic">{T.icon} {T.label} 면담</span>
          <span className="muted small">{ai ? 'AI 대화' : '규칙 기반 대화'} · 남은 발언 {Math.max(0, MAX_TURNS - turns)}</span>
          {!turns && !outcome && <button className="tr-x" onClick={onClose} aria-label="닫기">✕</button>}
        </header>

        <div className="tr-body">
          <aside className="tr-profile">
            <div className="tr-id">
              {photo ? <img className="tr-photo" src={photo} alt="" /> : <span className="tr-kit"><Kit color={team.color} number={player.number} size={54} /></span>}
              <div>
                <strong>{player.name}</strong>
                <span className="muted small"><Flag nation={player.nation} size={12} /> {player.age}세 · {player.role || player.pos} · OVR {playerOvr(player)}</span>
                <span className="muted small">{rank.text}</span>
              </div>
            </div>
            <dl className="tr-stats">
              <dt>사기</dt><dd><Bar value={st.morale ?? 60} tone={toneOf(st.morale ?? 60)} /> {face} {mLabel}</dd>
              <dt>감독 신뢰</dt><dd><Bar value={trust} tone={toneOf(trust)} /> {trust}{trust !== trust0 && <em className={trust > trust0 ? 'up' : 'down'}> {trust > trust0 ? '+' : ''}{trust - trust0}</em>}</dd>
              <dt>요구</dt><dd>{T.demand}</dd>
              <dt>약속</dt><dd>지킴 {rel.kept} · <span className={rel.broken ? 'bad-text' : ''}>어김 {rel.broken}</span>{rel.promises.length > 0 && <small className="muted"> · 진행 중: {rel.promises.map((p) => p.text).join(', ')}</small>}</dd>
              <dt>성격</dt><dd className="tr-pers">{personalityText(personality(player)).map((x) => <span key={x}>{x}</span>)}</dd>
            </dl>
            {reason && <p className="tr-reason small">{reason}</p>}
          </aside>

          <section className="tr-chat">
            <div className="tr-log" ref={logRef}>
              {lines.map((l, i) => (
                <div key={i} className={`tr-msg ${l.role}`}>
                  <span className="tr-who">{l.role === 'manager' ? '감독' : player.name.split(' ').at(-1)}{l.mood && <em> · {l.mood}</em>}</span>
                  <p>{l.text}</p>
                  {l.delta !== null && l.delta !== undefined && l.delta !== 0 && <span className={`tr-delta ${l.delta > 0 ? 'up' : 'down'}`}>신뢰 {l.delta > 0 ? '+' : ''}{l.delta}</span>}
                </div>
              ))}
              {busy && <div className="tr-msg player typing"><span className="tr-who">{player.name.split(' ').at(-1)}</span><p><i /><i /><i /></p></div>}
            </div>

            {!outcome ? (
              <div className="tr-answers">
                <ul>
                  {T.options.map(([intent, text, tone]) => (
                    <li key={intent}><button disabled={busy} onClick={() => talk(text, intent)}><span className="tr-tone">{tone}</span>{text}</button></li>
                  ))}
                </ul>
                <div className="tr-input">
                  <input value={input} maxLength={150} disabled={busy} placeholder="직접 말하기 (구체적일수록 선수가 진지하게 받아들입니다)" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
                  <button className="btn small" disabled={busy || !input.trim()} onClick={send}>말하기</button>
                </div>
                <button className="tr-end" disabled={busy || !lines.length} onClick={quit}>면담 끝내기</button>
              </div>
            ) : (
              <div className="tr-result">
                <strong>{res[0]} {res[1]}</strong>
                <span>감독 신뢰 {outcome.trustStart} → {outcome.trustEnd}</span>
                {outcome.outcome.startsWith('promise_') && <span className="small warn-text">⚠️ 약속은 자동으로 확인됩니다. 지키지 않으면 신뢰와 사기가 크게 떨어집니다.</span>}
                {outcome.outcome === 'promise_contract' && <span className="small">👉 선수 상세 → 계약에서 5라운드 안에 재계약(연봉 인상)을 제안하세요.</span>}
                <button className="btn wide" onClick={() => onFinish(outcome)}>확인</button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
