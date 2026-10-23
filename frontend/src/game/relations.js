// 선수-감독 관계: 신뢰(면담·약속으로만 변함, 사기와 별개), 약속 기록, 면담 기록
// 약속은 라운드마다 자동 판정된다 → 지키면 신뢰↑, 어기면 신뢰·사기 크게↓ 그리고 다음 약속을 믿지 않는다
import { news } from './season.js'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** 면담 주제: 요청 사유 · 선수가 원하는 것 · 감독이 고를 수 있는 답변 */
export const TOPICS = {
  minutes: {
    label: '출전 시간', icon: '⏱️',
    demand: '선발 출전 기회를 원함',
    options: [
      ['promise_start', '다음 3경기 안에 2번은 선발로 쓰겠다. 약속한다.', '약속'],
      ['honest', '지금은 경쟁에서 밀렸다. 훈련에서 증명하면 기회를 주겠다.', '솔직하게'],
      ['rotation', '너는 로테이션 자원이다. 그 역할을 받아들여 줬으면 한다.', '역할 설명'],
      ['let_go', '불만이 크면 이적 요청해도 막지 않겠다.', '이적 허용'],
      ['harsh', '너보다 잘하는 선수가 있다. 그게 현실이다.', '단호하게'],
    ],
  },
  contract: {
    label: '재계약', icon: '📝',
    demand: '계약 연장과 연봉 인상을 원함',
    options: [
      ['promise_contract', '시즌 안에 재계약 제안을 하겠다. 조건도 맞춰 주겠다.', '약속'],
      ['perform', '지금 활약이면 충분히 대우해 줄 수 있다. 조금만 기다려라.', '조건부'],
      ['fair', '지금 연봉이 네 활약에 맞는 수준이라고 본다.', '현실 직시'],
      ['let_go', '조건이 안 맞으면 다른 팀을 알아봐도 된다.', '이적 허용'],
    ],
  },
  transfer: {
    label: '이적', icon: '✈️',
    demand: '다른 팀으로 이적을 원함',
    options: [
      ['refuse', '너는 팔지 않는다. 이 팀의 핵심이다.', '거절'],
      ['promise_transfer', '적당한 제안이 오면 보내주겠다.', '약속'],
      ['convince', '여기서 우승하면 네 가치는 더 올라간다. 함께하자.', '설득'],
      ['contract', '계약은 계약이다. 남은 기간 성실히 뛰어라.', '단호하게'],
    ],
  },
  role: {
    label: '포지션·역할', icon: '🧩',
    demand: '본 포지션에서 뛰고 싶어 함',
    options: [
      ['promise_role', '다음 경기부터 본 포지션으로 돌려보내겠다.', '약속'],
      ['team_first', '팀 사정상 지금 자리가 필요하다. 네 희생이 고맙다.', '이해 구하기'],
      ['adapt', '새 자리에 적응하는 것도 실력이다.', '단호하게'],
    ],
  },
  general: {
    label: '개별 면담', icon: '🗣️',
    demand: '감독이 불러서 왔음',
    options: [
      ['praise', '요즘 잘하고 있다. 팀에 꼭 필요한 선수다.', '칭찬'],
      ['criticize', '최근 경기력이 실망스럽다. 더 해줘야 한다.', '질책'],
      ['ask', '요즘 팀 생활은 어떤가? 힘든 점 있으면 말해라.', '안부'],
      ['demand', '훈련 태도부터 바꿔라. 이대로면 기회 없다.', '경고'],
    ],
  },
}

/** 관계 기본값: 신뢰는 충성심에 따라 45~60에서 시작 */
export function relOf(st = {}) {
  return { trust: st.trust ?? 52, kept: st.kept ?? 0, broken: st.broken ?? 0, promises: st.promises || [], talks: st.talks || [] }
}

/** 약속 만들기 */
export function makePromise(kind, round, totalRounds) {
  if (kind === 'promise_start') return { kind: 'start', need: 2, got: 0, made: round, until: round + 3, text: '3경기 안에 선발 2번' }
  if (kind === 'promise_role') return { kind: 'role', need: 1, got: 0, made: round, until: round + 1, text: '다음 경기 본 포지션 기용' }
  if (kind === 'promise_contract') return { kind: 'contract', made: round, until: Math.min(totalRounds, round + 5), text: '5라운드 안에 재계약 제안' }
  if (kind === 'promise_transfer') return { kind: 'transfer', made: round, until: totalRounds, text: '좋은 제안이 오면 이적 허용' }
  return null
}

/**
 * 라운드가 끝날 때 약속 판정. sum = 이 선수의 경기 기록(없으면 결장), fitOk = 본 포지션(적합도 0.9 이상)으로 뛰었는지
 * 반환: 바뀐 상태와 편지함 소식
 */
export function checkPromises(p, s, { round, sum, fitOk, renewed, sold }) {
  const items = []
  const keep = []
  for (const pr of s.promises || []) {
    // 재계약·이적 순간에 부르면 그 약속만 판정한다
    if ((renewed || sold) && !((renewed && pr.kind === 'contract') || (sold && pr.kind === 'transfer'))) { keep.push(pr); continue }
    let state = null
    if (pr.kind === 'start' && sum?.start) pr.got = (pr.got || 0) + 1
    if (pr.kind === 'role' && sum?.start && fitOk) pr.got = 1
    if ((pr.kind === 'start' || pr.kind === 'role') && pr.got >= pr.need) state = 'kept'
    else if (pr.kind === 'contract' && renewed) state = 'kept'
    else if (pr.kind === 'transfer' && sold) state = 'kept'
    else if (round >= pr.until) state = 'broken'
    if (!state) { keep.push(pr); continue }
    if (state === 'kept') {
      s.trust = clamp((s.trust ?? 52) + 10, 0, 100)
      s.morale = clamp((s.morale ?? 60) + 5, 0, 100)
      s.kept = (s.kept || 0) + 1
      items.push(news(round, 'promise', `${p.name}: 약속을 지켰습니다`, `"${pr.text}" 약속을 지키자 ${p.name} 선수가 감독을 더 믿게 됐습니다. (신뢰 +10)`, { playerId: p.id }))
    } else {
      const again = (s.broken || 0) >= 1
      s.trust = clamp((s.trust ?? 52) - (again ? 35 : 25), 0, 100)
      s.morale = clamp((s.morale ?? 60) - 18, 0, 100)
      s.broken = (s.broken || 0) + 1
      items.push(news(round, 'promise', `${p.name}: 약속을 어겼습니다`, `"${pr.text}" 약속이 지켜지지 않았습니다. ${p.name} 선수가 크게 실망했고${again ? ', 이제 감독의 말을 믿지 않습니다' : ''}. (신뢰 -${again ? 35 : 25}, 사기 -18)`, { playerId: p.id }))
      if (s.trust < 20 && !s.wantsOut) {
        s.wantsOut = true
        items.push(news(round, 'request', `${p.name} 이적 요청`, `약속을 어긴 감독 밑에서는 뛸 수 없다며 ${p.name} 선수가 이적을 요청했습니다.`, { playerId: p.id }))
      }
    }
  }
  s.promises = keep
  return items
}

/** AI에게 줄 관계 요약 */
export function memoryText(st = {}) {
  const r = relOf(st)
  const out = [`감독 신뢰 ${r.trust}/100`, `지킨 약속 ${r.kept}번`, `어긴 약속 ${r.broken}번`]
  if (r.promises.length) out.push(`지금 걸려 있는 약속: ${r.promises.map((p) => p.text).join(', ')}`)
  if (r.talks.length) out.push(`지난 면담: ${r.talks.slice(-3).map((t) => `${t.round + 1}R ${t.topic} → ${t.outcome}${t.quote ? ` ("${t.quote}")` : ''}`).join(' / ')}`)
  return out.join(', ')
}
