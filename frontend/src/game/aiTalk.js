// AI 면담: Cloudflare Worker(중계 서버)를 거쳐 Gemini가 선수를 연기한다.
// 서버가 없거나 한도 초과·오류면 규칙 기반(말투 분석)으로 자동 전환한다.
import { playerOvrOf } from '../engine/engine.js'
import { news } from './season.js'
import { personality, reactToSpeech } from './speech.js'

export const TALK_API = 'https://mini-fm-talk.meongkune.workers.dev/talk'
export const MAX_TURNS = 6
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** 면담 시작 신뢰도: 사기와 비슷하게 시작 (이적 요청 중이면 낮게) */
export const startTrust = (st = {}) => clamp(Math.round((st.morale ?? 60) - (st.wantsOut ? 20 : 0)), 5, 95)

/** 선수 상황 설명 (AI에게 주는 배경) */
export function situationOf(player, team, st = {}, { contractYears = null, inLineup = false } = {}) {
  const rank = [...team.players].filter((p) => p.pos === player.pos).sort((a, b) => playerOvrOf(b) - playerOvrOf(a)).findIndex((p) => p.id === player.id) + 1
  const out = []
  out.push(inLineup ? '현재 주전으로 뛰고 있음' : `같은 포지션 ${rank}순위, 최근 선발에서 빠져 있음${st.benched ? ` (${st.benched}경기 연속 벤치)` : ''}`)
  if (st.form) out.push(`최근 평점 ${st.form}`)
  if (st.inj > 0) out.push(`부상 중 (${st.injKind || '부상'}, ${st.inj}경기 결장)`)
  if (st.wantsOut) out.push('이미 이적을 요청한 상태')
  if (st.sulk > 0) out.push('태업 중')
  if (st.promise !== undefined && st.promise !== null) out.push('전에 출전 약속을 받은 적 있음')
  if (contractYears !== null) out.push(`계약 ${contractYears}년 남음`)
  return out.join(', ')
}

/**
 * 한 번 말하기 → { reply, mood, trustDelta, outcome, end, ai(bool) }
 * history: [{ role: 'manager'|'player', text }]
 */
export async function sayToPlayer({ player, team, status, message, history, trust, reason, situation }) {
  const st = status || {}
  try {
    const res = await fetch(TALK_API, {
      method: 'POST',
      signal: AbortSignal.timeout(20000), // 20초 안에 답이 없으면 규칙 기반으로
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history,
        player: {
          name: player.name, age: player.age, pos: player.role || player.pos, ovr: playerOvrOf(player), club: team.name,
          personality: personality(player), morale: st.morale ?? 60, trust, situation, reason,
        },
      }),
    })
    const data = await res.json()
    if (!res.ok || data.fallback || !data.reply) throw new Error(data.error || `HTTP ${res.status}`)
    return { ...data, ai: true }
  } catch (e) {
    // 규칙 기반 대체: 첫 인사는 상황에 맞는 정해진 대사, 이후는 말투 분석 결과를 같은 형식으로 바꾼다
    if (message.startsWith('(면담이 시작')) {
      const reply = st.wantsOut ? '감독님, 저는 이 팀을 떠나고 싶습니다. 이적을 허락해 주세요.'
        : st.benched >= 2 ? '감독님, 왜 저를 계속 안 쓰시는지 듣고 싶습니다.'
          : (st.morale ?? 60) < 40 ? '솔직히 요즘 많이 힘듭니다. 할 말이 있어서 왔어요.'
            : reason ? '감독님, 드릴 말씀이 있습니다.' : '부르셨어요, 감독님?'
      return { reply, mood: st.wantsOut || st.benched >= 2 ? '불만' : '담담', trustDelta: 0, outcome: 'none', end: false, ai: false, why: String(e.message || e) }
    }
    const r = reactToSpeech(player, st, message)
    const outcome = r.wantsOut ? 'transfer_request' : r.leak ? 'press_leak' : r.sulk ? 'sulk' : r.promise ? 'promise_minutes' : 'none'
    return { reply: r.reply, mood: r.dMorale > 3 ? '누그러짐' : r.dMorale < -3 ? '불만' : '담담', trustDelta: clamp(Math.round(r.dMorale * 1.2), -20, 15), outcome, end: outcome !== 'none', ai: false, why: String(e.message || e) }
  }
}

export const OUTCOME_LABEL = {
  none: ['🤝', '면담 종료'],
  calm: ['😌', '불만 해소'],
  promise_minutes: ['✍️', '출전 약속'],
  transfer_request: ['✈️', '이적 요청'],
  sulk: ['😒', '태업'],
  press_leak: ['📰', '언론 폭로'],
  loyal: ['💙', '충성 맹세'],
}

/**
 * 면담 결과를 세이브에 반영: 사기(신뢰도 변화의 60%) + 결론별 효과 + 편지함 기록
 * itemId가 있으면 그 면담 요청 메일을 '답함'으로 표시
 */
export function applyTalkResult(save, player, { trustStart, trustEnd, outcome, lines, ai }, itemId = null) {
  const cur = { morale: 60, cond: 100, ...(save.status?.[player.id] || {}) }
  const dMorale = Math.round((trustEnd - trustStart) * 0.6)
  const s = { ...cur, morale: clamp(cur.morale + dMorale, 0, 100), talkRound: save.round, benched: itemId ? 0 : cur.benched }
  let status = { ...save.status, [player.id]: s }
  const inbox = []
  if (outcome === 'promise_minutes') s.promise = save.round
  if (outcome === 'calm') s.wantsOut = s.wantsOut && trustEnd < 50 ? s.wantsOut : false
  if (outcome === 'loyal') { s.wantsOut = false; s.morale = clamp(s.morale + 6, 0, 100) }
  if (outcome === 'sulk') { s.sulk = 3; inbox.push(news(save.round, 'sulk', `${player.name} 태업 조짐`, `면담 뒤 ${player.name} 선수가 훈련에 성의를 보이지 않습니다. 앞으로 3경기 동안 경기력이 떨어집니다.`, { playerId: player.id })) }
  if (outcome === 'transfer_request' && !cur.wantsOut) {
    s.wantsOut = true
    inbox.push(news(save.round, 'request', `${player.name} 이적 요청`, `면담 뒤 ${player.name} 선수가 공식적으로 이적을 요청했습니다.`, { playerId: player.id }))
  }
  if (outcome === 'press_leak') {
    for (const [id, st] of Object.entries(status)) if (st && id !== player.id && save.lineup?.includes(id)) status[id] = { ...st, morale: clamp((st.morale ?? 60) - 4, 0, 100) }
    inbox.push(news(save.round, 'press', `📰 언론 폭로: "${player.name}, 감독과 면담에서 충돌"`, `${player.name} 선수가 면담 내용을 언론에 흘렸습니다. 라커룸 분위기가 나빠졌습니다. (주전 선수 사기 하락)`, { playerId: player.id }))
  }
  const [icon, label] = OUTCOME_LABEL[outcome] || OUTCOME_LABEL.none
  const transcript = lines.map((l) => `${l.role === 'manager' ? '감독' : player.name}: ${l.text}`).join('\n')
  const summary = `${icon} ${label} · 신뢰도 ${trustStart}→${trustEnd} · 사기 ${dMorale >= 0 ? '+' : ''}${dMorale}${ai ? '' : ' (규칙 기반 대화)'}`
  let next = { ...save, status, inbox: [...inbox, ...(save.inbox || [])].slice(0, 80) }
  if (itemId) next = { ...next, inbox: next.inbox.map((x) => (x.id === itemId ? { ...x, resolved: 'custom', said: lines.find((l) => l.role === 'manager')?.text || '', reply: summary, transcript, read: true } : x)) }
  else next = { ...next, inbox: [news(save.round, 'talk-log', `🗣️ ${player.name} 면담: ${label}`, `${summary}\n\n${transcript}`, { playerId: player.id, read: true }), ...next.inbox].slice(0, 80) }
  return { save: next, dMorale }
}
