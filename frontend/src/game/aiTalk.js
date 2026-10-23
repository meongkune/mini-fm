// AI 면담: Cloudflare Worker(중계 서버)를 거쳐 Gemini가 선수를 연기한다.
// 선수는 주제(출전 시간·재계약·이적·역할)에 맞는 구체적인 답을 원하고, 감독과의 관계(신뢰·지킨/어긴 약속)를 기억한다.
// 서버가 없거나 한도 초과·오류면 규칙 기반으로 자동 전환한다.
import { playerOvrOf } from '../engine/engine.js'
import { news } from './season.js'
import { personality, reactToSpeech } from './speech.js'
import { TOPICS, makePromise, memoryText, relOf } from './relations.js'

export const TALK_API = 'https://mini-fm-talk.meongkune.workers.dev/talk'
export const MAX_TURNS = 6
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }

/** 면담 시작 신뢰: 저장된 감독 신뢰 (없으면 52, 이적 요청 중이면 낮게) */
export const startTrust = (st = {}) => clamp(Math.round(relOf(st).trust - (st.wantsOut ? 10 : 0)), 0, 100)

/** 팀 내 위치 (같은 포지션 순위·전체 순위) */
export function rankOf(player, team) {
  const pos = [...team.players].filter((p) => p.pos === player.pos).sort((a, b) => playerOvrOf(b) - playerOvrOf(a)).findIndex((p) => p.id === player.id) + 1
  const all = [...team.players].sort((a, b) => playerOvrOf(b) - playerOvrOf(a)).findIndex((p) => p.id === player.id) + 1
  return { pos, all, star: all <= 6, text: `포지션 ${pos}순위 · 전체 ${all}위/${team.players.length}명` }
}

/** 선수 상황 설명 (AI에게 주는 배경) */
export function situationOf(player, team, st = {}, { contractYears = null, inLineup = false } = {}) {
  const out = []
  out.push(inLineup ? '현재 주전으로 뛰고 있음' : `최근 선발에서 빠져 있음${st.benched ? ` (${st.benched}경기 연속 벤치)` : ''}`)
  if (st.fr?.length) out.push(`최근 평점 ${st.form}`)
  if (st.inj > 0) out.push(`부상 중 (${st.injKind || '부상'}, ${st.inj}경기 결장)`)
  if (st.offpos >= 2) out.push('본 포지션이 아닌 자리에 계속 기용됨')
  if (st.wantsOut) out.push('이미 이적을 요청한 상태')
  if (st.sulk > 0) out.push('태업 중')
  if (contractYears !== null) out.push(`계약 ${contractYears}년 남음`)
  return out.join(', ')
}

/** 규칙 기반 반응: 선택지(intent)나 직접 입력한 말 → 결과. AI가 없을 때 쓴다 */
function ruleReply(player, st, { intent, message, topic, rank }) {
  const p = personality(player)
  const rel = relOf(st)
  const roll = (hash(`${player.id}-${message}-${rel.talks.length}`) % 100) / 100
  const distrust = rel.broken >= 1 && rel.trust < 45
  const pick = (outcome, trustDelta, reply, mood) => ({ outcome, trustDelta, reply, mood, end: outcome !== 'none' })
  if (intent?.startsWith('promise_')) {
    if (distrust) return pick('rejected', -4, '전에도 그렇게 말씀하셨죠. 이번엔 말이 아니라 행동으로 보여주세요.', '냉소')
    const accepted = { promise_start: '그 말 믿겠습니다. 기회가 오면 반드시 보여드릴게요.', promise_role: '알겠습니다. 제 자리에서 증명하겠습니다.', promise_contract: '감사합니다. 그럼 조건 이야기는 곧 하는 걸로 알겠습니다.', promise_transfer: '이해해 주셔서 감사합니다. 남은 기간 성실히 뛰겠습니다.' }
    return pick(intent, 8, accepted[intent], '기대')
  }
  if (intent === 'honest' || intent === 'rotation' || intent === 'team_first' || intent === 'perform') {
    if (rank.star && p.pride >= 50) return pick('rejected', -6, '저는 이 팀 주전급입니다. 그런 설명으로는 납득이 안 됩니다.', '불만')
    if (p.pro >= 55 || roll < 0.5) return pick(intent === 'rotation' || intent === 'team_first' ? 'accepted_role' : 'resolved', 4, '솔직하게 말씀해 주셔서 고맙습니다. 훈련에서 보여드리겠습니다.', '담담')
    return pick('rejected', -3, '말씀은 알겠는데… 솔직히 받아들이기 어렵네요.', '서운함')
  }
  if (intent === 'let_go') return p.loyalty >= 65 ? pick('loyal', 2, '떠날 생각은 없습니다. 여기서 이겨내겠습니다.', '결연') : pick('transfer_request', -6, '그럼 그렇게 하죠. 에이전트에게 연락하겠습니다.', '실망')
  if (intent === 'harsh' || intent === 'adapt' || intent === 'contract' || intent === 'fair' || intent === 'demand') {
    if (p.temper >= 70 && p.pride >= 60) return pick(roll < 0.5 ? 'transfer_request' : 'sulk', -14, '이런 대우를 받으려고 여기 있는 게 아닙니다.', '분노')
    return pick('rejected', -7, '…알겠습니다.', '불만')
  }
  if (intent === 'refuse') return p.loyalty >= 55 ? pick('accepted_role', 2, '…알겠습니다. 일단 남아서 뛰겠습니다.', '체념') : pick('rejected', -8, '제 커리어는 제가 정하고 싶습니다.', '불만')
  if (intent === 'convince') return p.loyalty >= 45 || roll < 0.4 ? pick('loyal', 6, '그 말씀, 믿어보겠습니다. 함께 우승해 봅시다.', '감동') : pick('rejected', -2, '좋은 말씀이지만 제 마음은 이미 정해졌습니다.', '단호')
  if (intent === 'praise') return pick('resolved', st.form >= 6.9 ? 4 : 1, '감사합니다. 계속 이렇게 하겠습니다.', '기쁨')
  if (intent === 'criticize') return st.form < 6.5 ? pick('resolved', 1, '맞는 말씀입니다. 더 노력하겠습니다.', '반성') : pick('rejected', -6, '제 경기력이 그렇게 나쁘진 않았다고 생각합니다.', '억울')
  if (intent === 'ask') return pick('resolved', 3, (st.morale ?? 60) < 45 ? '사실 요즘 많이 힘듭니다. 들어주셔서 고맙습니다.' : '괜찮습니다. 신경 써 주셔서 감사합니다.', '담담')
  // 직접 입력: 말투 분석
  const r = reactToSpeech(player, st, message)
  const outcome = r.wantsOut ? 'transfer_request' : r.leak ? 'press_leak' : r.sulk ? 'sulk' : 'none'
  return { reply: r.reply.replace(/^["“]|["”]$/g, ''), mood: r.dMorale > 3 ? '누그러짐' : r.dMorale < -3 ? '불만' : '담담', trustDelta: clamp(Math.round(r.dMorale * 0.8), -20, 8), outcome, end: outcome !== 'none' }
}

/**
 * 한 번 말하기 → { reply, mood, trustDelta, outcome, end, ai(bool) }
 * history: [{ role: 'manager'|'player', text }], intent: 고른 답변 종류(직접 입력이면 없음)
 */
export async function sayToPlayer({ player, team, status, message, intent = null, history, trust, reason, situation, topic = 'general', wage = null }) {
  const st = status || {}
  const T = TOPICS[topic] || TOPICS.general
  const rank = rankOf(player, team)
  const opening = message.startsWith('(면담이 시작')
  try {
    const res = await fetch(TALK_API, {
      method: 'POST',
      signal: AbortSignal.timeout(20000), // 20초 안에 답이 없으면 규칙 기반으로
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history,
        player: {
          name: player.name, age: player.age, pos: player.role || player.pos, ovr: playerOvrOf(player), club: team.name, rank: rank.text,
          wage: wage ? `€${wage}M/년` : null, personality: personality(player), morale: st.morale ?? 60, trust,
          situation, reason, topic: T.label, demand: T.demand, memory: memoryText({ ...st, trust }),
        },
      }),
    })
    const data = await res.json()
    if (!res.ok || data.fallback || !data.reply) throw new Error(data.error || `HTTP ${res.status}`)
    return { ...data, ai: true }
  } catch (e) {
    if (opening) {
      const reply = topic === 'transfer' ? '감독님, 저는 이 팀을 떠나고 싶습니다. 이적을 허락해 주세요.'
        : topic === 'minutes' ? '감독님, 왜 저를 계속 안 쓰시는지 듣고 싶습니다.'
          : topic === 'contract' ? '제 계약이 곧 끝나는데, 구단의 생각을 듣고 싶습니다.'
            : topic === 'role' ? '감독님, 저는 제 포지션에서 뛰고 싶습니다.'
              : (st.morale ?? 60) < 40 ? '솔직히 요즘 많이 힘듭니다.' : '부르셨어요, 감독님?'
      return { reply, mood: topic === 'general' ? '담담' : '불만', trustDelta: 0, outcome: 'none', end: false, ai: false }
    }
    return { ...ruleReply(player, st, { intent, message, topic, rank }), ai: false }
  }
}

export const OUTCOME_LABEL = {
  none: ['🤝', '면담 종료'],
  resolved: ['😌', '납득함'],
  promise_start: ['✍️', '출전 약속'],
  promise_role: ['✍️', '포지션 약속'],
  promise_contract: ['✍️', '재계약 약속'],
  promise_transfer: ['✍️', '이적 허용 약속'],
  accepted_role: ['🙂', '역할 수용'],
  rejected: ['😤', '납득 못 함'],
  transfer_request: ['✈️', '이적 요청'],
  sulk: ['😒', '태업'],
  press_leak: ['📰', '언론 폭로'],
  loyal: ['💙', '충성 맹세'],
}
// 결과별 사기 변화 (신뢰 변화와 별개로)
const MORALE_BY = { none: 0, resolved: 5, promise_start: 8, promise_role: 6, promise_contract: 8, promise_transfer: 4, accepted_role: 3, rejected: -6, transfer_request: -10, sulk: -8, press_leak: -10, loyal: 10 }

/**
 * 면담 결과를 세이브에 반영: 신뢰(저장) · 사기 · 약속 등록 · 결론별 효과 · 면담 기록
 * itemId가 있으면 그 면담 요청 메일을 '답함'으로 표시
 */
export function applyTalkResult(save, player, { trustStart, trustEnd, outcome, lines, ai, topic = 'general', totalRounds = 38 }, itemId = null) {
  const cur = { morale: 60, cond: 100, ...(save.status?.[player.id] || {}) }
  const dMorale = clamp(MORALE_BY[outcome] ?? 0, -12, 12) + Math.round((trustEnd - trustStart) * 0.2)
  const s = { ...cur, trust: trustEnd, morale: clamp(cur.morale + dMorale, 0, 100), talkRound: save.round }
  if (topic === 'minutes' && outcome !== 'rejected') s.benched = 0
  const status = { ...save.status, [player.id]: s }
  const inbox = []
  const pr = makePromise(outcome, save.round, totalRounds)
  if (pr) s.promises = [...(s.promises || []).filter((x) => x.kind !== pr.kind), pr]
  if (outcome === 'resolved' || outcome === 'accepted_role') s.complained = true // 같은 불만으로 바로 다시 찾아오지 않음
  if (outcome === 'loyal') s.wantsOut = false
  if (outcome === 'promise_transfer') s.wantsOut = true
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
  const quote = lines.filter((l) => l.role === 'player').at(-1)?.text?.slice(0, 40) || ''
  s.talks = [...(s.talks || []), { round: save.round, topic: (TOPICS[topic] || TOPICS.general).label, outcome: label, quote }].slice(-6)
  const transcript = lines.map((l) => `${l.role === 'manager' ? '감독' : player.name}: ${l.text}`).join('\n')
  const summary = `${icon} ${label} · 신뢰 ${trustStart}→${trustEnd} · 사기 ${dMorale >= 0 ? '+' : ''}${dMorale}${pr ? ` · 약속: ${pr.text}` : ''}${ai ? '' : ' (규칙 기반 대화)'}`
  let next = { ...save, status, inbox: [...inbox, ...(save.inbox || [])].slice(0, 80) }
  if (itemId) next = { ...next, inbox: next.inbox.map((x) => (x.id === itemId ? { ...x, resolved: 'custom', said: lines.find((l) => l.role === 'manager')?.text || '', reply: summary, transcript, read: true } : x)) }
  else next = { ...next, inbox: [news(save.round, 'talk-log', `🗣️ ${player.name} 면담: ${label}`, `${summary}\n\n${transcript}`, { playerId: player.id, read: true }), ...next.inbox].slice(0, 80) }
  return { save: next, dMorale }
}
