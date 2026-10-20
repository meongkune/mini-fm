// 구단주 결정: 무엇이든 할 수 있지만 결과는 운과 상황에 따라 갈린다
import { playerOvrOf } from '../engine/engine.js'
import { eur } from './finance.js'
import { news } from './season.js'

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const r1 = (v) => Math.round(v * 10) / 10

/** 결정 목록: [키, 이름, 설명, 쿨다운(라운드), 위험도] */
export const DECISIONS = [
  ['wagecut', '💰 주급 15% 일괄 삭감', '지출이 확 줄지만 선수들이 들고일어날 수 있다', 99, '높음'],
  ['bonus', '🎁 승리 보너스 약속', '€M을 풀어 사기를 끌어올린다 (5경기)', 6, '낮음'],
  ['camp', '🏋️ 휴가 취소·지옥 훈련', '경기력이 오르거나, 부상·반발이 터지거나', 5, '중간'],
  ['naming', '🏟️ 구장 명명권 판매', '큰돈이 들어오지만 전통을 판 구단주로 찍힌다', 999, '중간'],
  ['betting', '🎰 도박 업체 스폰서', '라운드마다 추가 수입, 스캔들이 터질 수도', 999, '높음'],
  ['fanday', '🎉 무료 입장·팬 이벤트', '돈은 들지만 민심이 오른다', 4, '낮음'],
  ['taunt', '📢 라이벌 도발 인터뷰', '다음 경기 이기면 민심 폭등, 지면 조롱거리', 3, '높음'],
  ['youth', '🌱 유스에 몰빵 투자', '지금은 손해, 다음 시즌 유스가 강해진다', 999, '낮음'],
  ['loan', '🏦 사채 끌어오기', '당장 현금이 생기지만 시즌마다 이자를 갚는다', 999, '높음'],
]

const lineupOf = (save) => (save.lineup || []).filter(Boolean)

/**
 * 결정 실행 → { save, title, text, good }
 * ctx: { team, leagueId }
 */
export function decide(save, key, { team, leagueId }) {
  const base = save.finance?.base || 40
  const m = { wage: base / 60, gate: base / 50, cash: base / 60 }
  const o = { ...(save.owner || {}) }
  const f = { ...(save.finance || {}) }
  let fans = save.fans ?? 60
  const st = { ...(save.status || {}) }
  const roll = (k) => (hash(`${key}-${k}-${save.seasonNo}-${save.round}`) % 1000) / 1000
  const touch = (id, fn) => { st[id] = fn({ morale: 60, cond: 100, ...(st[id] || {}) }) }
  const all = team.players.map((p) => p.id)
  let title = ''
  let text = ''
  let good = true

  if (key === 'wagecut') {
    o.wageCut = 0.15
    all.forEach((id) => touch(id, (s) => ({ ...s, morale: clamp(s.morale - 12, 0, 100) })))
    if (roll(1) < 0.4) {
      const stars = [...team.players].sort((a, b) => playerOvrOf(b) - playerOvrOf(a)).slice(0, 2)
      stars.forEach((p) => touch(p.id, (s) => ({ ...s, wantsOut: true })))
      title = '선수단 집단 반발'
      text = `주급이 15% 깎였습니다. 분노한 ${stars.map((p) => p.name).join('·')} 선수가 이적을 요청했습니다.`
      good = false
    } else {
      title = '주급 삭감 강행'
      text = '주급이 15% 깎였습니다. 불만은 있지만 선수들이 일단 받아들였습니다. (전원 사기 -12)'
    }
    fans -= 3
  } else if (key === 'bonus') {
    const cost = r1(1 + m.wage * 2)
    f.cash = r1((f.cash || 0) - cost)
    o.bonusUntil = save.round + 5
    all.forEach((id) => touch(id, (s) => ({ ...s, morale: clamp(s.morale + 10, 0, 100) })))
    title = '승리 보너스 약속'
    text = `${eur(cost)}을 보너스 재원으로 풀었습니다. 선수들 사기가 크게 올랐습니다. (5경기)`
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
  } else if (key === 'naming') {
    const gain = r1(25 * m.cash + roll(3) * 20 * m.cash)
    f.cash = r1((f.cash || 0) + gain)
    fans -= 15
    title = '구장 이름이 바뀌었습니다'
    text = `명명권을 ${eur(gain)}에 팔았습니다. 팬들은 "전통을 팔았다"며 분노하고 있습니다. (민심 -15)`
    good = gain > 30
  } else if (key === 'betting') {
    o.sponsorBoost = 0.6
    fans -= 8
    if (roll(4) < 0.3) {
      fans -= 12
      title = '도박 스폰서 스캔들'
      text = '스폰서 계약 직후 언론이 구단과 도박 업체의 유착 의혹을 보도했습니다. (민심 -20, 스폰서 수입은 +60%)'
      good = false
    } else {
      title = '도박 업체와 스폰서 계약'
      text = '라운드마다 스폰서 수입이 60% 늘어납니다. 일부 팬은 등을 돌렸습니다. (민심 -8)'
    }
  } else if (key === 'fanday') {
    const cost = r1(0.5 + m.gate)
    f.cash = r1((f.cash || 0) - cost)
    fans += 9
    title = '팬 이벤트 대성공'
    text = `${eur(cost)}을 들여 무료 입장·사인회를 열었습니다. (민심 +9)`
  } else if (key === 'taunt') {
    o.taunt = save.round // 다음 경기 결과로 판정
    title = '라이벌 도발'
    text = '"우리가 훨씬 강하다." 인터뷰가 화제가 됐습니다. 다음 경기를 이기면 민심이 폭등하고, 지면 조롱거리가 됩니다.'
  } else if (key === 'youth') {
    const cost = r1(8 * m.cash)
    f.cash = r1((f.cash || 0) - cost)
    o.youthBoost = true
    title = '유스 아카데미 투자'
    text = `${eur(cost)}을 유스에 쏟았습니다. 다음 시즌 유스 입단 선수가 더 많고 강해집니다.`
  } else if (key === 'loan') {
    const amt = r1(30 * m.cash)
    f.cash = r1((f.cash || 0) + amt)
    o.debt = r1((o.debt || 0) + amt * 1.3) // 30% 이자를 붙여 갚아야 한다
    title = '사채 대출'
    text = `${eur(amt)}을 빌렸습니다. 시즌이 끝날 때마다 ${eur(r1(amt * 1.3 / 2))}씩 갚아야 합니다.`
    good = true
  }
  o.used = { ...(o.used || {}), [key]: save.round }
  const item = news(save.round, 'owner', `🏛️ ${title}`, text)
  return { save: { ...save, owner: o, finance: f, fans: clamp(Math.round(fans), 0, 100), status: st, inbox: [item, ...(save.inbox || [])].slice(0, 80) }, title, text, good }
}

/** 결정을 지금 쓸 수 있는지 (쿨다운·한 번뿐인 결정) */
export function decisionReady(save, key) {
  const d = DECISIONS.find((x) => x[0] === key)
  const used = save.owner?.used?.[key]
  if (used === undefined) return { ok: true }
  if (d[3] >= 999) return { ok: false, why: '이미 실행함 (시즌당 한 번)' }
  const wait = used + d[3] - save.round
  return wait > 0 ? { ok: false, why: `${wait}라운드 뒤 다시 가능` } : { ok: true }
}

/** 경기 결과에 따른 구단주 효과 (도발 판정 등) */
export function afterMatchOwner(save, result) {
  const o = save.owner || {}
  if (o.taunt === undefined || o.taunt === null) return save
  let fans = save.fans ?? 60
  const item = result > 0
    ? news(save.round, 'owner', '📢 도발이 통했다!', '큰소리친 대로 이겼습니다. 팬들이 열광합니다. (민심 +12)')
    : news(save.round, 'owner', '📢 도발 역풍', result < 0 ? '큰소리치고 졌습니다. 온 동네의 조롱거리가 됐습니다. (민심 -12)' : '비겼습니다. 큰소리친 것치고는 초라한 결과입니다. (민심 -4)')
  fans += result > 0 ? 12 : result < 0 ? -12 : -4
  return { ...save, fans: clamp(fans, 0, 100), owner: { ...o, taunt: null }, inbox: [item, ...(save.inbox || [])].slice(0, 80) }
}

/** 민심 단계 */
export function fanLabel(v = 60) {
  if (v >= 80) return ['🔥', '열광', 'great']
  if (v >= 60) return ['🙂', '지지', 'good']
  if (v >= 40) return ['😐', '반신반의', 'ok']
  if (v >= 20) return ['😠', '분노', 'bad']
  return ['🪧', '시위', 'worst']
}
