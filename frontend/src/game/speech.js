// 면담 자유 입력: 감독이 직접 친 말을 말투 규칙으로 분석하고, 선수 성격에 따라 반응을 정한다 (AI 대화가 아니라 규칙 기반)
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** 선수 성격 (선수 ID로 고정): 자존심·충성심·다혈질·프로의식 0~100 */
export function personality(p) {
  const r = (k) => hash(`${k}-${p.id}`) % 101
  return { pride: r('pride'), loyalty: r('loyal'), temper: r('temper'), pro: r('pro') }
}
export function personalityText(t) {
  const out = []
  if (t.pride >= 70) out.push('자존심 강함')
  if (t.loyalty >= 70) out.push('충성심 높음')
  if (t.loyalty <= 25) out.push('언제든 떠날 수 있음')
  if (t.temper >= 70) out.push('다혈질')
  if (t.pro >= 70) out.push('프로의식 투철')
  if (t.pro <= 25) out.push('태도 불성실')
  return out.length ? out : ['무난한 성격']
}

// 말투 사전 (부분 일치). 가중치가 클수록 강한 표현
const LEX = {
  hostile: [['꺼져', 3], ['꺼지', 3], ['닥쳐', 3], ['쓰레기', 3], ['한심', 2], ['실망', 1.5], ['짜증', 1.5], ['필요없', 2.5], ['필요 없', 2.5], ['주제', 2], ['니가 뭔데', 3], ['네가 뭔데', 3], ['입 다물', 2.5], ['건방', 2], ['싫으면', 2], ['꼬우면', 3], ['찌질', 2.5], ['형편없', 2], ['못하', 1], ['병신', 3], ['시발', 3], ['씨발', 3], ['존나', 1], ['개', 0.5]],
  leave: [['이적해', 3], ['이적 해', 3], ['나가', 2.5], ['떠나', 2.5], ['팔아', 2.5], ['팔겠', 2.5], ['방출', 3], ['내보내', 2.5], ['다른 팀', 2], ['딴 팀', 2], ['짐 싸', 3]],
  threat: [['벌금', 2.5], ['2군', 2.5], ['리저브', 2], ['벤치에만', 2], ['출전 못', 2], ['각오', 1.5], ['두고 봐', 2], ['가만 안', 2.5], ['징계', 2]],
  promise: [['선발', 2], ['기회', 2], ['뛰게', 2.5], ['출전시', 2], ['약속', 2.5], ['다음 경기', 1.5], ['주전', 2], ['믿고 쓸', 2]],
  praise: [['잘하', 2], ['최고', 2.5], ['믿', 1.5], ['핵심', 2.5], ['중요', 1.5], ['대단', 2], ['고마', 2], ['훌륭', 2], ['에이스', 2.5], ['필요해', 2], ['자랑', 2], ['멋지', 2], ['좋아', 1]],
  reason: [['경쟁', 2], ['증명', 2], ['훈련', 1.5], ['기다려', 2], ['시간', 1], ['노력', 2], ['상황', 1], ['이해', 1.5], ['계획', 1.5], ['로테이션', 2], ['컨디션', 1.5], ['때가 되면', 2]],
  sorry: [['미안', 2.5], ['사과', 2.5], ['내 잘못', 3], ['내가 잘못', 3], ['죄송', 2.5]],
  mock: [['ㅋㅋ', 2], ['ㅎㅎ', 1], ['웃기', 2], ['꼴', 1.5], ['애송이', 2.5], ['찐따', 2.5]],
}
export const TONE_LABEL = { hostile: '모욕·비난', leave: '나가라', threat: '위협', promise: '약속', praise: '칭찬', reason: '설득', sorry: '사과', mock: '조롱' }

/** 문장 → 말투 점수 */
export function analyzeSpeech(text) {
  const t = String(text || '').toLowerCase()
  const score = {}
  for (const [tone, words] of Object.entries(LEX)) {
    let s = 0
    for (const [w, k] of words) if (t.includes(w)) s += k
    if (s) score[tone] = s
  }
  const shout = Math.min(3, (t.match(/!/g) || []).length * 0.5) // 느낌표는 강도를 키운다
  const tones = Object.entries(score).sort((a, b) => b[1] - a[1])
  return { score, shout, tones: tones.map(([k]) => k), empty: !tones.length }
}

/**
 * 선수 반응 계산
 * @returns { dMorale, wantsOut, promise, leak, sulk, reply, toneText }
 */
export function reactToSpeech(player, status, text) {
  const a = analyzeSpeech(text)
  const p = personality(player)
  const s = a.score
  const morale = status.morale ?? 60
  const harsh = (s.hostile || 0) + (s.leave || 0) * 1.2 + (s.threat || 0) * 0.8 + (s.mock || 0)
  const kind = (s.praise || 0) + (s.promise || 0) + (s.reason || 0) + (s.sorry || 0) * 1.2
  let d = 0
  d += (s.praise || 0) * (status.form >= 6.9 ? 2.2 : 1.2) // 폼이 좋을 때 칭찬이 잘 먹힌다
  d += (s.promise || 0) * 2.5
  d += (s.reason || 0) * (p.pro >= 50 ? 2 : 0.8) // 프로의식이 높으면 설득이 통한다
  d += (s.sorry || 0) * 1.8
  d -= harsh * (1 + p.pride / 100) * (1 + a.shout / 4) * 2.2
  // 위협이 다혈질이 아닌 성실한 선수에겐 잠깐 자극이 될 때도 있다
  if ((s.threat || 0) > 0 && p.pro >= 70 && p.temper < 40 && !(s.hostile || s.leave)) d += 4
  d = Math.round(clamp(d, -35, 22))

  const after = morale + d
  const pushOut = (s.leave || 0) * 12 + (s.hostile || 0) * 5 + (s.mock || 0) * 4 + p.pride * 0.3 - p.loyalty * 0.4 + (60 - after) * 0.6
  const wantsOut = harsh > 0 && (pushOut > 30 || after < 22)
  const leak = harsh >= 4 && p.temper >= 65 // 다혈질이면 언론에 폭로
  const sulk = !wantsOut && harsh > 0 && after < 35 && p.pro < 45 // 태업: 컨디션·폼 하락
  const promise = (s.promise || 0) >= 2

  let reply
  if (a.empty) reply = '"…무슨 말씀인지 잘 모르겠네요." (별 반응 없음)'
  else if (wantsOut && (s.leave || 0) > 0) reply = p.loyalty >= 70 ? '"…여기서 끝까지 하고 싶었는데, 그렇게 말씀하시면 어쩔 수 없죠. 이적을 요청하겠습니다."' : '"좋습니다. 저도 더 있고 싶지 않네요. 에이전트에게 연락하겠습니다."'
  else if (wantsOut) reply = '"이런 대우는 참을 수 없습니다. 공식적으로 이적을 요청합니다."'
  else if (harsh > 0 && d < -10) reply = p.temper >= 65 ? '"지금 저한테 그렇게 말씀하신 겁니까?!" (격하게 반발)' : '"…알겠습니다." (눈에 띄게 실망)'
  else if (harsh > 0 && d >= 0) reply = '"…보여드리죠." (오히려 자극을 받은 듯)'
  else if (promise) reply = '"약속 지켜 주실 거죠? 기대하겠습니다."'
  else if ((s.sorry || 0) > 0) reply = '"사과해 주셔서 감사합니다. 다시 잘해 보죠."'
  else if (d >= 8) reply = '"감독님 말씀 들으니 힘이 납니다!"'
  else if (d > 0) reply = '"네, 알겠습니다."'
  else reply = '"…네." (별 감흥 없음)'
  const extra = [wantsOut && '✈️ 이적 요청', leak && '📰 언론 폭로', sulk && '😒 태업 조짐', promise && '🤝 선발 약속'].filter(Boolean)
  return { dMorale: d, wantsOut, leak, sulk, promise, reply, toneText: a.tones.map((t) => TONE_LABEL[t]).join(' · ') || '알 수 없음', extra }
}
