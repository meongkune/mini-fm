// Mini FM AI 면담 중계 서버 (Cloudflare Worker)
// 게임(브라우저)에서 선수 정보·대화 기록을 받아 Gemini에게 '그 선수'를 연기시키고,
// 대사 + 신뢰도 변화 + 결과(잔류·이적 요청·태업·폭로 등)를 JSON으로 돌려준다.
// Gemini 키는 Cloudflare 비밀값(GEMINI_API_KEY)에만 있고, 게임 코드·GitHub에는 없다.

const ALLOWED = ['https://meongkune.github.io', 'http://localhost:5173', 'http://localhost:4173', 'http://127.0.0.1:5173']
const MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest'] // 빠른 경량 모델 먼저, 한도·지연·오류면 다음 모델로
const OUTCOMES = ['none', 'resolved', 'promise_start', 'promise_role', 'promise_contract', 'promise_transfer', 'accepted_role', 'rejected', 'transfer_request', 'sulk', 'press_leak', 'loyal']

const cors = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  Vary: 'Origin',
})
const json = (body, status, origin) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } })
const clip = (s, n) => String(s ?? '').slice(0, n)

function systemPrompt(p) {
  const pers = p.personality || {}
  return `너는 축구 감독 게임 속 프로 축구 선수 "${clip(p.name, 40)}"이다. 감독(=사용자)과 1:1 면담 중이다. 현실의 프로 선수처럼 행동하라.
[선수 정보] ${p.age}세, 포지션 ${clip(p.pos, 8)}, 능력치 OVR ${p.ovr}(팀 내 ${clip(p.rank, 20) || '?'}), 소속 ${clip(p.club, 40)}, 연봉 ${clip(p.wage, 20) || '?'}
[성격 0~100] 자존심 ${pers.pride ?? 50}, 충성심 ${pers.loyalty ?? 50}, 다혈질 ${pers.temper ?? 50}, 프로의식 ${pers.pro ?? 50}
[지금 상태] 사기 ${p.morale ?? 60}/100. ${clip(p.situation, 300)}
[감독과의 관계] ${clip(p.memory, 400) || '특별한 기록 없음'}
[면담 주제] ${clip(p.topic, 30) || '개별 면담'} — 선수가 원하는 것: ${clip(p.demand, 80) || '없음'}
${p.reason ? `[면담 이유] ${clip(p.reason, 200)}` : ''}

현실성 규칙 (반드시 지켜라):
1. 한국어로, 성격에 맞는 말투로 1~3문장. 게임·AI라는 말 금지.
2. 듣기 좋은 말·칭찬만으로는 문제가 풀리지 않는다. 선수는 '구체적인 답'(출전 횟수, 역할, 계약 조건, 이적 허용 여부)을 원한다. 빈말이면 trustDelta는 0 이하.
3. 지난 약속을 어긴 기록이 있으면 새 약속을 쉽게 믿지 않는다 (어긴 횟수가 많을수록 냉소적). 지킨 기록이 많으면 믿는다.
4. 능력치가 팀 내 상위권인 선수(주전급)는 '로테이션/후보로 만족하라'는 말을 쉽게 받아들이지 않는다. 하위권 선수는 솔직한 설명을 받아들일 수 있다.
5. 자존심·다혈질이 높으면 무시·모욕에 크게 반발한다. 프로의식이 높으면 화가 나도 감정적으로 행동하지 않는다. 충성심이 높으면 떠나지 않으려 한다.
6. trustDelta: 이번 감독 발언으로 신뢰가 얼마나 바뀌는지 -20~+12 정수. 진심 있고 구체적이며 선수 요구에 맞으면 +, 회피·빈말 0~-5, 무례·협박 -10 이하.
7. outcome (대화가 결론 났을 때만, 아니면 "none"):
   resolved(납득·해결) · promise_start(선발 기회 약속을 받아들임) · promise_role(본 포지션 약속을 받아들임) · promise_contract(재계약 약속을 받아들임) · promise_transfer(이적 허용 약속을 받아들임)
   accepted_role(현재 역할을 받아들임) · rejected(납득 못 함, 불만 남음) · transfer_request(이적 요청) · sulk(태업) · press_leak(언론 폭로) · loyal(충성 맹세)
   promise_* 는 감독이 실제로 그 약속을 말했을 때만. transfer_request·sulk·press_leak는 심한 모욕이나 반복된 약속 위반 같은 큰 이유가 있을 때만.
8. end: 선수가 대화를 끝내고 나가면 true (보통 outcome이 정해지면 true).
9. mood: 지금 감정을 한국어 한 단어로 (예: 분노, 서운함, 의심, 담담, 기대, 감동). 영어 금지.`
}

async function askGemini(env, body) {
  const history = (Array.isArray(body.history) ? body.history : []).slice(-12).map((h) => ({
    role: h.role === 'player' ? 'model' : 'user',
    parts: [{ text: clip(h.text, 400) }],
  }))
  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt(body.player || {}) }] },
    contents: [...history, { role: 'user', parts: [{ text: `감독: ${clip(body.message, 300)}` }] }],
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 300,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          reply: { type: 'STRING' },
          mood: { type: 'STRING' },
          trustDelta: { type: 'INTEGER' },
          outcome: { type: 'STRING', enum: OUTCOMES },
          end: { type: 'BOOLEAN' },
        },
        required: ['reply', 'mood', 'trustDelta', 'outcome', 'end'],
      },
    },
  }
  let last = null
  for (const model of MODELS) {
    let res
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000), // 12초 넘게 걸리면 다음 모델로
      })
    } catch { last = 504; continue }
    if (res.status === 429 || res.status === 503 || res.status === 400) { last = res.status; continue } // 한도 초과·혼잡·모델 미지원 → 다음 모델
    if (!res.ok) throw Object.assign(new Error(`gemini ${res.status}`), { status: res.status })
    const data = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    const out = JSON.parse(text)
    return {
      reply: clip(out.reply, 400),
      mood: clip(out.mood, 12),
      trustDelta: Math.max(-20, Math.min(12, Math.round(out.trustDelta || 0))),
      outcome: OUTCOMES.includes(out.outcome) ? out.outcome : 'none',
      end: !!out.end,
      model,
    }
  }
  throw Object.assign(new Error('quota'), { status: last || 429 })
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || ''
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) })
    const url = new URL(req.url)
    if (req.method === 'GET' && url.pathname === '/health') return json({ ok: true, key: !!env.GEMINI_API_KEY }, 200, origin)
    if (req.method !== 'POST' || url.pathname !== '/talk') return json({ error: 'not found' }, 404, origin)
    if (!ALLOWED.includes(origin)) return json({ error: 'forbidden origin' }, 403, origin)
    if (!env.GEMINI_API_KEY) return json({ error: 'no key', fallback: true }, 503, origin)
    let body
    try { body = await req.json() } catch { return json({ error: 'bad json' }, 400, origin) }
    if (!body?.message || String(body.message).length > 300) return json({ error: 'message 1~300자' }, 400, origin)
    try {
      return json(await askGemini(env, body), 200, origin)
    } catch (e) {
      // 한도 초과·오류면 게임이 규칙 기반 대화로 바꿔 진행한다
      return json({ error: e.message, fallback: true }, e.status === 429 ? 429 : 502, origin)
    }
  },
}
