// Mini FM AI 면담 중계 서버 (Cloudflare Worker)
// 게임(브라우저)에서 선수 정보·대화 기록을 받아 Gemini에게 '그 선수'를 연기시키고,
// 대사 + 신뢰도 변화 + 결과(잔류·이적 요청·태업·폭로 등)를 JSON으로 돌려준다.
// Gemini 키는 Cloudflare 비밀값(GEMINI_API_KEY)에만 있고, 게임 코드·GitHub에는 없다.

const ALLOWED = ['https://meongkune.github.io', 'http://localhost:5173', 'http://localhost:4173', 'http://127.0.0.1:5173']
const MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest'] // 앞 모델 한도가 차면 다음 모델로
const OUTCOMES = ['none', 'calm', 'promise_minutes', 'transfer_request', 'sulk', 'press_leak', 'loyal']

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
  return `너는 축구 감독 게임 속 프로 축구 선수 "${clip(p.name, 40)}"이다. 감독(=사용자)과 1:1 면담 중이다.
- 나이 ${p.age}세, 포지션 ${clip(p.pos, 8)}, 능력치 OVR ${p.ovr}, 소속 ${clip(p.club, 40)}
- 성격(0~100): 자존심 ${pers.pride ?? 50}, 충성심 ${pers.loyalty ?? 50}, 다혈질 ${pers.temper ?? 50}, 프로의식 ${pers.pro ?? 50}
- 지금 사기 ${p.morale ?? 60}/100, 감독 신뢰도 ${p.trust ?? 50}/100
- 상황: ${clip(p.situation, 300) || '특별한 문제 없음'}
- 면담 이유: ${clip(p.reason, 200) || '감독이 불러서'}

규칙:
1. 반드시 한국어로, 이 선수 성격에 맞는 말투로 1~3문장만 말한다. 국적이 외국이면 통역을 거친 듯 자연스럽게.
2. 감독 말이 무례·협박이면 자존심·다혈질이 높을수록 크게 반발한다. 진심 어린 설득·약속이면 누그러진다.
3. 현실 축구 선수처럼 행동한다: 출전 시간, 역할, 연봉, 존중을 신경 쓴다. 게임·AI라는 말은 절대 하지 않는다.
4. trustDelta: 이번 감독 발언으로 신뢰도가 얼마나 바뀌는지 -20~+15 정수.
5. outcome: 대화가 결론 났으면 다음 중 하나, 아니면 "none".
   calm(불만 해소) · promise_minutes(출전 약속을 받아냄) · transfer_request(이적 요청) · sulk(태업) · press_leak(언론에 폭로) · loyal(충성 맹세)
   transfer_request·sulk·press_leak는 감독이 심하게 모욕하거나 여러 번 무시했을 때만.
6. end: 선수가 대화를 끝내고 나가면 true.
7. mood: 지금 감정 한 단어 (예: 분노, 서운함, 담담, 기대, 감동).`
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
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify(payload),
    })
    if (res.status === 429 || res.status === 503) { last = res.status; continue } // 한도 초과·혼잡 → 다음 모델
    if (!res.ok) throw Object.assign(new Error(`gemini ${res.status}`), { status: res.status })
    const data = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    const out = JSON.parse(text)
    return {
      reply: clip(out.reply, 400),
      mood: clip(out.mood, 12),
      trustDelta: Math.max(-20, Math.min(15, Math.round(out.trustDelta || 0))),
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
