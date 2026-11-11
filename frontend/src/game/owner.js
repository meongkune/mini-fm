// 구단주 결정과 팬 민심: 무엇이든 할 수 있지만 대가가 따르고, 결과는 운과 상황에 따라 갈린다
//   모든 돈은 장부(book)에 항목별로 기록된다 → 구단 화면 그래프·FFP 손익에 그대로 나온다
import { playerOvrOf } from '../engine/engine.js'
import { book, cashOnly, eur } from './finance.js'
import { news } from './season.js'

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const r1 = (v) => Math.round(v * 10) / 10
const r2 = (v) => Math.round(v * 100) / 100
const revOf = (f) => (f?.base || 40) * 1.15 // 한 시즌 예상 매출

/** 결정 목록: [키, 이름, 설명, 쿨다운(라운드, 999 = 시즌당 한 번), 위험도] */
export const DECISIONS = [
  ['loan', '🏦 구단주 대출', '매출의 20%를 빌려 바로 이적 자금으로 쓴다. 2시즌 동안 경기마다 원금+이자(25%)를 갚는다', 999, '중간'],
  ['fanday', '🎟️ 무료 입장의 날', '다음 홈경기 입장료를 받지 않는다. 그 경기 관중 수입을 포기하는 대신 관중석이 꽉 차고 민심이 크게 오른다', 6, '낮음'],
  ['bonus', '🎁 승리 수당', '앞으로 5경기 동안 이길 때마다 수당을 준다 (지면 돈이 안 나감). 이길 때마다 사기가 오른다', 8, '낮음'],
  ['wagecut', '💰 주급 15% 삭감', '이번 시즌 끝까지 연봉 지출이 15% 줄지만, 선수들이 반발하고 스타가 이적을 요청할 수 있다', 999, '높음'],
  ['naming', '🏟️ 구장 명명권 판매', '5시즌 동안 해마다 매출의 6%가 들어오고 구장 이름이 바뀐다. 팬들은 전통을 팔았다며 분노한다 (구단 역사상 한 번)', 999, '중간'],
  ['betting', '🎰 도박 업체 스폰서', '이번 시즌 스폰서 수입 +60%. 팬 일부가 등을 돌리고, 스캔들이 터질 수도 있다', 999, '높음'],
  ['youth', '🌱 유스 아카데미 투자', '지금 돈이 들지만 다음 시즌 유스 입단 선수가 더 많고 강해진다', 999, '낮음'],
  ['camp', '🏋️ 휴가 취소·지옥 훈련', '다음 3경기 경기력이 오르거나, 부상·반발이 터지거나', 5, '중간'],
  ['taunt', '📢 다음 상대 도발 인터뷰', '다음 경기를 이기면 민심이 오르고 지면 조롱거리. 강한 상대일수록 이겼을 때 크고, 약한 상대에게 지면 망신이 크다', 3, '높음'],
]

const lineupOf = (save) => (save.lineup || []).filter(Boolean)
const BRANDS = ['넥스트뱅크', '스카이텔', '오로라 에너지', '블루웨이브', '메리디안 항공', '노바 모터스', '피닉스 보험']

/**
 * 결정 실행 → { save, title, text, good }
 * ctx: { team, leagueId, totalRounds }
 */
export function decide(save, key, { team, totalRounds = 38 }) {
  const o = { ...(save.owner || {}) }
  let f = { ...(save.finance || {}) }
  const rev = revOf(f)
  let fans = save.fans ?? 60
  const st = { ...(save.status || {}) }
  const roll = (k) => (hash(`${key}-${k}-${save.seasonNo}-${save.round}`) % 1000) / 1000
  const touch = (id, fn) => { st[id] = fn({ morale: 60, cond: 100, ...(st[id] || {}) }) }
  const all = team.players.map((p) => p.id)
  const season = save.seasonNo || 1
  let title = ''
  let text = ''
  let good = true

  if (key === 'loan') {
    // 구단주 대출: 빌린 돈은 현금이자 이적 자금 (빌린 돈은 매출이 아니라 FFP 손익에 넣지 않는다). 이자는 비용으로 잡힌다
    const amt = r1(rev * 0.2)
    const total = r1(amt * 1.25)
    const n = totalRounds * 2
    f = cashOnly(f, amt)
    if (f.fm >= 5) f.tb = r1((f.tb || 0) + amt)
    o.loans = [...(o.loans || []), { amt, left: total, principal: r2(amt / n), interest: r2((total - amt) / n), n, from: season }]
    title = '구단주 대출'
    text = `${eur(amt)}을 빌려 이적 자금에 넣었습니다. 앞으로 2시즌 동안 경기마다 ${eur(r2(total / n))}씩(이자 포함 총 ${eur(total)}) 갚습니다. 이자는 FFP 손익에 비용으로 잡힙니다.`
  } else if (key === 'fanday') {
    o.freeGate = true
    const cost = r2(0.2 + rev * 0.002)
    f = book(f, -cost, '팬 이벤트')
    title = '무료 입장의 날 예고'
    text = `다음 홈경기는 무료 입장입니다. 그 경기 관중 수입은 없지만 관중석이 꽉 차고 민심이 크게 오릅니다. (행사 준비 ${eur(cost)})`
  } else if (key === 'bonus') {
    const per = r2(0.15 + rev * 0.003)
    o.winBonus = { left: 5, per }
    all.forEach((id) => touch(id, (s) => ({ ...s, morale: clamp(s.morale + 4, 0, 100) })))
    title = '승리 수당 약속'
    text = `앞으로 5경기 동안 이길 때마다 ${eur(per)}을 수당으로 줍니다. 선수들이 의욕에 찼습니다. (전원 사기 +4, 이길 때마다 출전 선수 사기 +3)`
  } else if (key === 'wagecut') {
    o.wageCut = 0.15
    o.wageCutSeason = season
    all.forEach((id) => touch(id, (s) => ({ ...s, morale: clamp(s.morale - 12, 0, 100), trust: clamp((s.trust ?? 52) - 6, 0, 100) })))
    if (roll(1) < 0.4) {
      const stars = [...team.players].sort((a, b) => playerOvrOf(b) - playerOvrOf(a)).slice(0, 2)
      stars.forEach((p) => touch(p.id, (s) => ({ ...s, wantsOut: true })))
      title = '선수단 집단 반발'
      text = `이번 시즌 끝까지 주급이 15% 깎였습니다. 분노한 ${stars.map((p) => p.name).join('·')} 선수가 이적을 요청했습니다. (전원 사기 -12)`
      good = false
    } else {
      title = '주급 삭감 강행'
      text = '이번 시즌 끝까지 주급이 15% 깎였습니다. 불만은 있지만 선수들이 일단 받아들였습니다. (전원 사기 -12, 다음 시즌에 원래대로)'
    }
    fans -= 3
  } else if (key === 'naming') {
    const per = r1(rev * 0.06)
    const name = `${BRANDS[hash(`${team.id}-${season}`) % BRANDS.length]} 아레나`
    o.naming = { name, per, from: season, until: season + 4 }
    fans -= 12
    title = `구장 이름이 '${name}'로 바뀝니다`
    text = `명명권을 5시즌 계약으로 팔았습니다. 해마다 ${eur(per)}이 스폰서 수입으로 들어옵니다(경기마다 나눠서). 팬들은 "전통을 팔았다"며 분노합니다. (민심 -12)`
  } else if (key === 'betting') {
    o.sponsorBoost = 0.6
    fans -= 8
    if (roll(4) < 0.3) {
      fans -= 12
      title = '도박 스폰서 스캔들'
      text = '스폰서 계약 직후 언론이 구단과 도박 업체의 유착 의혹을 보도했습니다. (민심 -20, 이번 시즌 스폰서 수입은 +60%)'
      good = false
    } else {
      title = '도박 업체와 스폰서 계약'
      text = '이번 시즌 스폰서 수입이 60% 늘어납니다. 일부 팬은 등을 돌렸습니다. (민심 -8)'
    }
  } else if (key === 'youth') {
    const cost = r1(rev * 0.05)
    f = book(f, -cost, '유스 투자')
    o.youthBoost = true
    title = '유스 아카데미 투자'
    text = `${eur(cost)}을 유스에 투자했습니다. 다음 시즌 유스 입단 선수가 더 많고 강해집니다.`
  } else if (key === 'camp') {
    const r = roll(2)
    lineupOf(save).forEach((id) => touch(id, (s) => ({ ...s, cond: clamp((s.cond ?? 100) - 15, 30, 100) })))
    if (r < 0.55) {
      o.campUntil = save.round + 3
      title = '지옥 훈련 성공'
      text = '혹독한 훈련이 통했습니다. 다음 3경기 동안 경기력이 오릅니다. (컨디션은 -15)'
    } else if (r < 0.8) {
      const victims = lineupOf(save).filter((_, i) => hash(`inj-${i}-${save.round}`) % 4 === 0).slice(0, 2)
      victims.forEach((id) => touch(id, (s) => ({ ...s, inj: 2 + (hash(id) % 3), injKind: '훈련 중 근육 부상' })))
      title = '훈련 중 부상자 속출'
      text = `무리한 훈련으로 ${victims.length || 1}명이 다쳤습니다.`
      good = false
    } else {
      all.forEach((id) => touch(id, (s) => ({ ...s, morale: clamp(s.morale - 8, 0, 100) })))
      title = '선수단 반발'
      text = '"휴가를 돌려달라!" 선수들이 집단으로 불만을 터뜨렸습니다. (전원 사기 -8)'
      good = false
    }
  } else if (key === 'taunt') {
    o.taunt = save.round // 다음 경기 결과로 판정
    title = '도발 인터뷰'
    text = '"우리가 훨씬 강하다." 인터뷰가 화제가 됐습니다. 다음 경기를 이기면 민심이 오르고, 지면 조롱거리가 됩니다.'
  }
  o.used = { ...(o.used || {}), [key]: save.round }
  const item = news(save.round, 'owner', `🏛️ ${title}`, text)
  return { save: { ...save, owner: o, finance: f, fans: clamp(r1(fans), 0, 100), status: st, inbox: [item, ...(save.inbox || [])].slice(0, 80) }, title, text, good }
}

/** 결정을 지금 쓸 수 있는지 (쿨다운·시즌당 한 번·구단 역사상 한 번) */
export function decisionReady(save, key) {
  const o = save.owner || {}
  if (key === 'naming' && o.naming) return { ok: false, why: `계약 중 (${o.naming.until - (save.seasonNo || 1) + 1}시즌 남음)` }
  if (key === 'fanday' && o.freeGate) return { ok: false, why: '다음 홈경기에 진행 예정' }
  if (key === 'bonus' && o.winBonus?.left > 0) return { ok: false, why: `${o.winBonus.left}경기 남음` }
  if (key === 'loan' && (o.loans || []).length >= 2) return { ok: false, why: '대출은 동시에 2건까지' }
  const d = DECISIONS.find((x) => x[0] === key)
  const used = o.used?.[key]
  if (used === undefined) return { ok: true }
  if (d[3] >= 999) return { ok: false, why: '이미 실행함 (시즌당 한 번)' }
  const wait = used + d[3] - save.round
  return wait > 0 ? { ok: false, why: `${wait}라운드 뒤 다시 가능` } : { ok: true }
}

/** 지금 걸려 있는 구단주 효과 (구단 화면 표시용) */
export function activeEffects(save) {
  const o = save.owner || {}
  const season = save.seasonNo || 1
  const out = []
  for (const l of o.loans || []) out.push(['🏦', `대출 상환 중: 남은 금액 ${eur(l.left)} · 경기마다 ${eur(r2(l.principal + l.interest))}`])
  if (o.debt > 0) out.push(['🏦', `예전 사채 ${eur(o.debt)} (시즌 말에 절반씩 상환)`])
  if (o.naming && o.naming.until >= season) out.push(['🏟️', `명명권 '${o.naming.name}': 해마다 ${eur(o.naming.per)} · ${o.naming.until - season + 1}시즌 남음`])
  if (o.freeGate) out.push(['🎟️', '다음 홈경기 무료 입장'])
  if (o.winBonus?.left > 0) out.push(['🎁', `승리 수당: 이길 때마다 ${eur(o.winBonus.per)} · ${o.winBonus.left}경기 남음`])
  if (o.wageCut) out.push(['💰', '주급 15% 삭감 중 (이번 시즌 끝까지)'])
  if (o.sponsorBoost) out.push(['🎰', `도박 스폰서: 스폰서 수입 +${Math.round(o.sponsorBoost * 100)}% (이번 시즌)`])
  if ((o.campUntil ?? -1) >= save.round) out.push(['🏋️', `지옥 훈련 효과: ${o.campUntil - save.round + 1}경기 남음`])
  if (o.taunt != null) out.push(['📢', '도발 인터뷰: 다음 경기 결과로 판정'])
  if (o.youthBoost) out.push(['🌱', '유스 투자: 다음 시즌 유스 강화'])
  return out
}

export { fanDelta, fanMoneyK, crowdBoost } from './finance.js'

/**
 * 경기가 끝난 뒤 구단주 효과 정리: 도발 판정, 승리 수당, 무료 입장, 대출 상환, 팬 시위·열광이 이사회에 주는 영향
 * opts: { home, cup, oppGap }
 */
export function afterMatchOwner(save, result, { home = false, cup = false, oppGap = 0 } = {}) {
  const o = { ...(save.owner || {}) }
  let f = save.finance
  let fans = save.fans ?? 60
  let st = save.status
  let board = save.board
  const inbox = []
  const e = clamp(oppGap / 4, -1, 1)
  // 도발: 강한 상대를 이기면 +8~+16, 약한 상대에게 지면 -8~-16
  if (o.taunt !== undefined && o.taunt !== null) {
    const d = result > 0 ? Math.round(12 + 4 * e) : result < 0 ? Math.round(-12 + 4 * e) : -4
    fans += d
    inbox.push(result > 0
      ? news(save.round, 'owner', '📢 도발이 통했다!', `큰소리친 대로 이겼습니다.${e > 0.3 ? ' 강팀을 상대로 해낸 일이라 팬들이 열광합니다.' : ''} (민심 +${d})`)
      : news(save.round, 'owner', '📢 도발 역풍', result < 0 ? `큰소리치고 졌습니다.${e < -0.3 ? ' 그것도 약팀에게. 온 동네의 조롱거리가 됐습니다.' : ''} (민심 ${d})` : '비겼습니다. 큰소리친 것치고는 초라한 결과입니다. (민심 -4)'))
    o.taunt = null
  }
  // 승리 수당: 이긴 경기만 돈이 나간다
  if (o.winBonus?.left > 0) {
    if (result > 0) {
      f = book(f, -o.winBonus.per, '승리 수당')
      st = { ...st }
      for (const id of lineupOf(save)) st[id] = { ...(st[id] || {}), morale: clamp((st[id]?.morale ?? 60) + 3, 0, 100) }
    }
    o.winBonus = o.winBonus.left > 1 ? { ...o.winBonus, left: o.winBonus.left - 1 } : null
  }
  // 무료 입장: 홈 리그 경기 한 번 (정산은 settleMatch가 했다)
  if (o.freeGate && home && !cup) {
    o.freeGate = false
    inbox.push(news(save.round, 'owner', '🎟️ 무료 입장의 날', '관중석이 가득 찼습니다. 입장 수입은 없었지만 팬들이 구단에 고마워합니다. (민심 +8)'))
  }
  // 대출 상환: 리그 경기마다 원금(현금만) + 이자(비용)
  if (!cup && (o.loans || []).length) {
    const loans = []
    for (const l of o.loans) {
      const pay = Math.min(l.left, r2(l.principal + l.interest))
      const interest = r2(pay * (1 - l.amt / (l.amt * 1.25))) // 갚는 돈 중 이자 몫 (총액의 20%)
      f = cashOnly(book(f, -interest, '대출 이자'), -(pay - interest))
      const left = r2(l.left - pay)
      if (left > 0.01) loans.push({ ...l, left })
      else inbox.push(news(save.round, 'finance', '🏦 대출 상환 완료', `${eur(l.amt)} 대출을 모두 갚았습니다.`))
    }
    o.loans = loans
  }
  // 팬 시위·열광 → 이사회 신뢰
  if (board && !cup) {
    if (fans < 20) {
      board = { ...board, confidence: clamp(board.confidence - 2, 0, 100) }
      if (!o.protestAt || save.round - o.protestAt >= 5) {
        o.protestAt = save.round
        inbox.push(news(save.round, 'owner', '🪧 팬 시위', `팬들이 경기장 앞에서 구단주 퇴진 시위를 벌였습니다 (민심 ${Math.round(fans)}). 관중·스폰서 수입이 줄고 이사회도 불안해합니다 (신뢰 하락).`))
      }
    } else if (fans >= 85) board = { ...board, confidence: clamp(board.confidence + 1, 0, 100) }
  }
  return { ...save, owner: o, finance: f, status: st, board, fans: clamp(r1(fans), 0, 100), inbox: [...inbox, ...(save.inbox || [])].slice(0, 80) }
}

/** 민심 단계 */
export function fanLabel(v = 60) {
  if (v >= 80) return ['🔥', '열광', 'great']
  if (v >= 60) return ['🙂', '지지', 'good']
  if (v >= 40) return ['😐', '반신반의', 'ok']
  if (v >= 20) return ['😠', '분노', 'bad']
  return ['🪧', '시위', 'worst']
}
