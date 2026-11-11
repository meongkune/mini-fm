// Mini FM AI 면담 중계 서버 (Cloudflare Worker)
// 게임(브라우저)에서 선수 정보·대화 기록을 받아 Gemini에게 '그 선수'를 연기시키고,
// 대사 + 신뢰도 변화 + 결과(잔류·이적 요청·태업·폭로 등)를 JSON으로 돌려준다.
// Gemini 키는 Cloudflare 비밀값(GEMINI_API_KEY)에만 있고, 게임 코드·GitHub에는 없다.

const ALLOWED = ['https://meongkune.github.io', 'http://localhost:5173', 'http://localhost:4173', 'http://127.0.0.1:5173']
const MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest'] // 빠른 경량 모델 먼저, 한도·지연·오류면 다음 모델로
const OUTCOMES = ['none', 'resolved', 'promise_start', 'promise_role', 'promise_contract', 'promise_transfer', 'accepted_role', 'rejected', 'transfer_request', 'sulk', 'press_leak', 'loyal', 'sign', 'counter', 'refuse_deal']

const cors = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  Vary: 'Origin',
})
const json = (body, status, origin) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } })
const clip = (s, n) => String(s ?? '').slice(0, n)

// 연봉 협상 모드: 선수가 원하는 조건과 감독이 이번에 내민 조건
function dealPrompt(d) {
  const o = d.offer
  return `[연봉 협상] ${d.kind === 'sign' ? '이 팀으로 이적하는 개인 조건 협상' : '재계약 협상'}. 네가 원하는 조건: 연봉 €${d.ask}M/년, 계약 최대 ${d.maxYears}년. 지금 연봉 €${d.current ?? '?'}M/년.
${o ? `[감독의 이번 제안] 연봉 €${o.wage}M/년 · ${o.years}년${o.raise ? ' · 약속: 이번 시즌 활약하면(평균 평점 6.9 이상) 다음 시즌 연봉 25% 인상' : ''} (원하는 연봉의 ${Math.round((o.wage / d.ask) * 100)}%)` : '[감독의 이번 제안] 없음 — 대화만 하는 중'}
연봉 협상 규칙:
- 원하는 연봉의 95% 이상이면 대체로 수락(outcome "sign").
- 85~95%면: '활약 시 인상' 약속이 있고 감독 신뢰가 50 이상이면 수락할 수 있다. 아니면 역제안(outcome "counter").
- 85% 미만이면 역제안. 70% 미만이면 무시당했다고 느낀다(trustDelta 음수). 몇 번이나 터무니없으면 협상 결렬(outcome "refuse_deal").
- 역제안(counter)일 때 counterWage(원하는 연봉과 제안 사이의 금액, €M)와 counterYears를 꼭 채운다.
- 제안이 없는 일반 대화면 outcome은 "none". 금액을 지어내지 말고 위 숫자만 쓴다.`
}

// 이적 협상: 상대 구단 단장 역할. 수락·역제안·거절은 게임이 이미 정했고, 단장은 그 결정을 자기 말로 전한다.
// 감독의 논리가 그럴듯하면(후보 선수·계약 만료 임박·선수 본인이 떠나길 원함·필요한 포지션 선수를 끼워 줌) 다음 제안에 쓸 양보(concession 0~5 %)를 준다.
function clubPrompt(c) {
  const o = c.offer
  return `너는 축구 감독 게임 속 프로 축구 구단 "${clip(c.club, 40)}"의 단장(디렉터)이다. 상대 구단 감독(=사용자)이 우리 선수 영입을 협상하러 왔다. 현실의 노련한 단장처럼 말하라.
[협상 대상] ${clip(c.player, 60)} (${c.age}세, ${clip(c.pos, 8)}, 능력 OVR ${c.ovr}, 우리 팀 내 ${clip(c.role, 20)}, 계약 ${c.years ?? '?'}년 남음${c.wantsOut ? ', 선수 본인이 이적을 원함' : ''})
[우리가 보는 선수 가치] €${c.value}M · 협상 ${c.tries}/${c.patience}회째
[거래 방식] ${c.loan ? `임대 (시즌 끝까지, 임대료 + 상대가 연봉 ${Math.round((o?.share ?? 1) * 100)}% 부담)` : '완전 이적'}
${o ? `[감독의 이번 제안] ${c.loan ? `임대료 €${o.fee}M` : `현금 €${o.fee}M`}${o.swap ? ` + 상대 선수 ${clip(o.swap, 40)} (우리 평가 €${o.swapCredit}M: ${clip(o.swapNote, 60)})` : ''}` : '[감독의 이번 제안] 없음 — 말로만 이야기하는 중'}
${c.verdict ? `[우리 구단의 결정 — 반드시 이대로 전하라] ${c.verdict === 'accept' ? '수락' : c.verdict === 'counter' ? `역제안: ${c.loan ? '임대료' : '현금'} €${c.ask}M` : `거절${c.reason ? ` (${clip(c.reason, 80)})` : ''}`}` : ''}
규칙:
1. 한국어, 1~3문장. 단장답게 정중하지만 실리적으로. 게임·AI라는 말 금지.
2. [우리 구단의 결정]이 있으면 그 결정과 금액을 그대로 전한다(바꾸지 마라). 결정이 없으면 금액을 새로 지어내지 말고 조건을 묻거나 원칙을 말한다.
3. 위 숫자 말고 다른 금액·선수·사실을 지어내지 마라. 우리가 받을 수 있는 최저 금액은 절대 말하지 마라.
4. concession: 감독의 이번 말이 설득력 있으면 0~5 (정수, 다음 제안에서 원하는 금액을 그만큼 % 낮춰 줌). 근거 없는 압박·빈말·무례면 0. 선수가 후보이거나 떠나길 원하거나 계약이 1년 남았다는 지적, 필요한 포지션 선수를 끼워 주는 것은 좋은 근거다.
5. walk: 감독이 무례하거나 터무니없는 말을 반복하면 true (협상을 접는다).
6. mood: 지금 기분 한국어 한 단어 (예: 신중, 흥미, 불쾌, 만족, 단호).
7. 감독이 위에 없는 조건(임대 후 완전 이적 의무·옵션, 분할 지급, 셀온 조항, 다음 시즌 약속 등)을 말하면, 지금은 그런 조건으로 계약할 수 없다고 짧게 말하고 화면의 조건(현금·선수 끼워 넣기·임대료·연봉 부담)으로 다시 제안해 달라고 한다. 같은 대답을 그대로 반복하지 마라.`
}

function systemPrompt(p) {
  const pers = p.personality || {}
  return `너는 축구 감독 게임 속 프로 축구 선수 "${clip(p.name, 40)}"이다. 감독(=사용자)과 1:1 면담 중이다. 현실의 프로 선수처럼 행동하라.
[선수 정보] ${p.age}세, 포지션 ${clip(p.pos, 8)}, 능력치 OVR ${p.ovr}(팀 내 ${clip(p.rank, 20) || '?'}), 소속 ${clip(p.club, 40)}, 연봉 ${clip(p.wage, 20) || '?'}
[성격 0~100] 자존심 ${pers.pride ?? 50}, 충성심 ${pers.loyalty ?? 50}, 다혈질 ${pers.temper ?? 50}, 프로의식 ${pers.pro ?? 50}
[지금 상태] 사기 ${p.morale ?? 60}/100. ${clip(p.situation, 300)}
[감독과의 관계] ${clip(p.memory, 400) || '특별한 기록 없음'}
[면담 주제] ${clip(p.topic, 30) || '개별 면담'} — 선수가 원하는 것: ${clip(p.demand, 80) || '없음'}
${p.reason ? `[면담 이유] ${clip(p.reason, 200)}` : ''}
${p.deal ? dealPrompt(p.deal) : ''}

현실성 규칙 (반드시 지켜라):
1. 한국어로, 성격에 맞는 말투로 1~3문장. 게임·AI라는 말 금지.
2. 듣기 좋은 말·칭찬만으로는 문제가 풀리지 않는다. 선수는 '구체적인 답'(출전 횟수, 역할, 계약 조건, 이적 허용 여부)을 원한다. 빈말이면 trustDelta는 0 이하.
3. 지난 약속을 어긴 기록이 있으면 새 약속을 쉽게 믿지 않는다 (어긴 횟수가 많을수록 냉소적). 지킨 기록이 많으면 믿는다.
4. 능력치가 팀 내 상위권인 선수(주전급)는 '로테이션/후보로 만족하라'는 말을 쉽게 받아들이지 않는다. 하위권 선수는 솔직한 설명을 받아들일 수 있다.
5. 자존심·다혈질이 높으면 무시·모욕에 크게 반발한다. 프로의식이 높으면 화가 나도 감정적으로 행동하지 않는다. 충성심이 높으면 떠나지 않으려 한다.
6. trustDelta: 이번 감독 발언으로 신뢰가 얼마나 바뀌는지 -20~+12 정수. 진심 있고 구체적이며 선수 요구에 맞으면 +, 요구를 피해 가는 빈말 0~-3, 무례·협박 -10 이하.
   안부·컨디션 확인·일상적인 질문은 0~+2 (깎지 말 것). 감독이 사실을 바로잡거나 오해를 풀어 주면 인정하고 0 이상.
10. [지금 상태]에 적힌 사실만 말하라. 경기 수·벤치 기간·출전 기록·약속을 지어내지 마라. 시즌 개막 전이면 '계속 벤치' 같은 말은 하지 않는다.
11. 특별한 불만이 없는 일반 면담(감독이 불러서 온 경우)이면 기본적으로 협조적이고 담담하게 대화한다. 불만은 [지금 상태]에 근거가 있을 때만 꺼낸다.
7. outcome (대화가 결론 났을 때만, 아니면 "none"):
   resolved(납득·해결) · promise_start(선발 기회 약속을 받아들임) · promise_role(본 포지션 약속을 받아들임) · promise_contract(재계약 약속을 받아들임) · promise_transfer(이적 허용 약속을 받아들임)
   accepted_role(현재 역할을 받아들임) · rejected(납득 못 함, 불만 남음) · transfer_request(이적 요청) · sulk(태업) · press_leak(언론 폭로) · loyal(충성 맹세)
   promise_* 는 감독이 실제로 그 약속을 말했을 때만. transfer_request·sulk·press_leak는 심한 모욕이나 반복된 약속 위반 같은 큰 이유가 있을 때만.
8. end: 선수가 대화를 끝내고 나가면 true (보통 outcome이 정해지면 true).
9. mood: 지금 감정을 한국어 한 단어로 (예: 분노, 서운함, 의심, 담담, 기대, 감동). 영어 금지.`
}

const CLUB_SCHEMA = {
  type: 'OBJECT',
  properties: { reply: { type: 'STRING' }, mood: { type: 'STRING' }, concession: { type: 'INTEGER' }, walk: { type: 'BOOLEAN' } },
  required: ['reply', 'mood', 'concession', 'walk'],
}

async function askGemini(env, body) {
  const club = body.mode === 'club'
  const history = (Array.isArray(body.history) ? body.history : []).slice(-12).map((h) => ({
    role: h.role === 'manager' ? 'user' : 'model',
    parts: [{ text: clip(h.text, 400) }],
  }))
  const payload = {
    systemInstruction: { parts: [{ text: club ? clubPrompt(body.club || {}) : systemPrompt(body.player || {}) }] },
    contents: [...history, { role: 'user', parts: [{ text: `감독: ${clip(body.message, 300)}` }] }],
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 300,
      responseMimeType: 'application/json',
      responseSchema: club ? CLUB_SCHEMA : {
        type: 'OBJECT',
        properties: {
          reply: { type: 'STRING' },
          mood: { type: 'STRING' },
          trustDelta: { type: 'INTEGER' },
          outcome: { type: 'STRING', enum: OUTCOMES },
          end: { type: 'BOOLEAN' },
          counterWage: { type: 'NUMBER' },
          counterYears: { type: 'INTEGER' },
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
    if (club) return { reply: clip(out.reply, 400), mood: clip(out.mood, 12), concession: Math.max(0, Math.min(5, Math.round(out.concession || 0))), walk: !!out.walk, model }
    return {
      reply: clip(out.reply, 400),
      mood: clip(out.mood, 12),
      trustDelta: Math.max(-20, Math.min(12, Math.round(out.trustDelta || 0))),
      outcome: OUTCOMES.includes(out.outcome) ? out.outcome : 'none',
      end: !!out.end,
      ...(out.counterWage > 0 ? { counterWage: Math.round(out.counterWage * 10) / 10 } : {}),
      ...(out.counterYears > 0 ? { counterYears: Math.max(1, Math.min(5, out.counterYears)) } : {}),
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
