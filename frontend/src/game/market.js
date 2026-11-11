// AI 구단끼리의 이적 시장: 이적 시장이 열려 있는 동안 다른 구단들도 서로 선수를 사고판다.
//   - 구단마다 약한 포지션을 찾고, 그 자리를 실제로 강화할 수 있는 선수를 예산 안에서 산다
//   - 파는 쪽은 내가 영입할 때와 같은 기준(evaluateBid)으로 값을 부른다 — 핵심 선수는 비싸고, 후보는 싸다
//   - 선수는 대체로 같은 수준이거나 더 강한 구단으로 간다 (후보 선수는 출전 기회를 찾아 내려가기도 한다)
//   - 다른 리그에서 사 오기도 하고, 다른 리그로 팔려 나가기도 한다 (리그 전체 수준이 한쪽으로 쏠리지 않게 비슷한 빈도)
//   - 가끔 더 큰 구단이 내 주전 선수에게 먼저 제안을 넣는다 (판매 목록에 없어도)
// 모든 선택은 시즌·라운드·구단 ID의 해시로 정해져서, 같은 세이브에서는 항상 같은 결과가 나온다.
import { playerOvrOf } from '../engine/engine.js'
import { clubBill } from './finance.js'
import { news } from './season.js'
import { aiBidFor, evaluateBid, executeTransfer, money, valueCtx, valueOf, windowState } from './trade.js'

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
const rnd = (k) => (hash(k) % 10000) / 10000
const r1 = (v) => Math.round(v * 10) / 10
const SLOTS = { GK: 1, DF: 4, MF: 4, FW: 2 }
const NEED = { GK: 3, DF: 8, MF: 8, FW: 5 }
const POS_KO = { GK: '골키퍼', DF: '수비수', MF: '미드필더', FW: '공격수' }
const ROSTER_SOFT = 30 // AI 구단은 이보다 많아지면 가장 약한 선수를 내보낸다
const calcStrength = (t) => { const o = t.players.map(playerOvrOf).sort((a, b) => b - a).slice(0, 11); return o.length ? o.reduce((a, b) => a + b, 0) / o.length : 60 }
const strCache = new WeakMap() // 같은 구단 객체는 한 번만 계산 (다른 리그 구단 수백 개를 라운드마다 다시 세지 않게)
export const strengthOf = (t) => { let v = strCache.get(t); if (v == null) { v = calcStrength(t); strCache.set(t, v) } return v }

/** 그 구단에서 가장 급한 포지션: 인원이 모자라거나, 주전 수준이 팀 평균보다 가장 낮은 곳 */
function weakSpot(team) {
  const avg = strengthOf(team)
  let best = null
  for (const pos of ['GK', 'DF', 'MF', 'FW']) {
    const ovrs = team.players.filter((p) => p.pos === pos).map(playerOvrOf).sort((a, b) => b - a)
    const starters = ovrs.slice(0, SLOTS[pos])
    const level = starters.length ? starters.reduce((a, b) => a + b, 0) / starters.length : 0
    const worst = starters.at(-1) ?? 0 // 그 포지션 주전 중 가장 약한 선수
    const gap = avg - level + (ovrs.length < NEED[pos] ? 2 : 0) + (starters.length < SLOTS[pos] ? 10 : 0)
    if (!best || gap > best.gap) best = { pos, gap, worst }
  }
  return best
}

/**
 * 이적 시장 한 번 돌리기 (라운드가 끝난 뒤, 시장이 열려 있을 때)
 * @returns save (rosters·aiCash·marketLog·inbox 등이 바뀐 새 세이브)
 */
export function runMarket(save, { teams, myTeamId, leagueId, round, totalRounds, world = [] }) {
  const win = windowState(round + 1, totalRounds)
  if (!win.open) return save
  const season = save.seasonNo || 1
  const wkey = `${season}-${win.label}`
  let s = save
  // 시즌마다 구단 예산을 채운다 (기본 몫 + 구단 규모의 11% + 지난 시즌에 남긴 돈의 절반) — 규모에만 비례하면 부자 구단만 계속 강해진다
  if (s.aiCashSeason !== season) {
    const prev = s.aiCash || {}
    s = { ...s, aiCashSeason: season, aiCash: Object.fromEntries(teams.filter((t) => t.id !== myTeamId).map((t) => [t.id, r1(Math.min(3, clubBill(t, leagueId) * 0.1) + clubBill(t, leagueId) * 0.11 + (prev[t.id] || 0) * 0.5)])) }
  }
  const done = { ...(s.aiDeals?.[wkey] || {}) }
  const cash = { ...s.aiCash }
  const deals = []
  const byId = () => Object.fromEntries(liveTeams.map((t) => [t.id, t]))
  // 거래가 일어날 때마다 명단이 바뀌므로, 이 함수 안에서 쓰는 명단을 직접 갱신한다
  let liveTeams = teams.map((t) => ({ ...t, players: [...t.players] }))
  const move = (p, fromId, toId) => {
    liveTeams = liveTeams.map((t) => (t.id === fromId ? { ...t, players: t.players.filter((x) => x.id !== p.id) } : t.id === toId ? { ...t, players: [...t.players, p] } : t))
  }
  const ai = liveTeams.filter((t) => t.id !== myTeamId)
  const order = [...ai].sort((a, b) => hash(`${wkey}-${round}-${a.id}`) - hash(`${wkey}-${round}-${b.id}`))
  const foreign = world.filter((w) => w.lid !== leagueId)
  let bought = 0

  for (const b0 of order) {
    if (bought >= 3) break // 한 라운드에 리그 전체 3건까지
    if ((done[b0.id] || 0) >= 2) continue // 한 구단은 한 시장에 2건까지
    if (rnd(`act-${wkey}-${round}-${b0.id}`) > 0.4) continue
    const buyer = byId()[b0.id]
    const spot = weakSpot(buyer)
    const budget = cash[buyer.id] || 0
    if (!spot || budget < 0.5) continue
    const bStr = strengthOf(buyer)
    // 후보: 같은 리그 다른 AI 구단 + 다른 리그 구단의 선수 중, 그 자리 주전을 실제로 강화하는 선수
    const pools = [
      ...liveTeams.filter((t) => t.id !== buyer.id && t.id !== myTeamId).map((t) => ({ t, lid: leagueId, league: null })),
      ...(rnd(`abroad-${wkey}-${round}-${buyer.id}`) < 0.45 ? foreign.filter((w) => hash(`${wkey}-${buyer.id}-${w.team.id}`) % 6 === 0).map((w) => ({ t: w.team, lid: w.lid, league: w.league })) : []),
    ]
    let pick = null
    for (const { t, lid, league } of pools) {
      const tStr = strengthOf(t)
      const ranked = [...t.players].sort((a, b) => playerOvrOf(b) - playerOvrOf(a))
      for (const p of t.players) {
        if (p.pos !== spot.pos || p.age > 30 || s.loans?.[p.id] || s.status?.[p.id]?.inj > 3) continue
        const ovr = playerOvrOf(p)
        if (ovr < spot.worst + 1) continue // 지금 주전보다 나아야 산다
        if (ovr > bStr + 4) continue // 구단 수준을 한참 넘는 선수는 오지 않는다 (부자 구단만 끝없이 강해지지 않게)
        const rank = ranked.indexOf(p)
        // 선수 입장: 더 약한 구단으로는 후보일 때만 간다
        if (bStr < tStr - 1 && rank < 14) continue
        const v = valueOf(p, s.status?.[p.id], lid === leagueId ? valueCtx(s, p, leagueId) : {})
        if (v > budget) continue
        const r = evaluateBid({ theirs: t, player: p, fee: v * 3, status: s.status || {}, value: v })
        if (r.verdict !== 'accept' || !r.need) continue
        const fee = r1(r.need * (1 + rnd(`fee-${p.id}-${wkey}`) * 0.08))
        if (fee > budget) continue
        const score = ovr - fee / Math.max(5, budget) * 3 - Math.max(0, p.age - 27) * 0.8 + rnd(`sc-${p.id}-${wkey}-${buyer.id}`) * 2 // 같은 값이면 젊은 선수를 고른다
        if (!pick || score > pick.score) pick = { p, t, lid, league, fee, score }
      }
    }
    if (!pick) continue
    const { p, t, lid, league, fee } = pick
    // 실행
    if (lid === leagueId) {
      s = executeTransfer(s, liveTeams, t.id, buyer.id, p.id)
      cash[t.id] = r1((cash[t.id] || 0) + fee * 0.8)
    } else {
      // 다른 리그에서 사 옴: 선수 정보를 세이브에 복사하고 원래 구단 명단에서는 빼 둔다
      const rosters = { ...(s.rosters || Object.fromEntries(liveTeams.map((x) => [x.id, x.players.map((y) => y.id)]))) }
      rosters[buyer.id] = [...(rosters[buyer.id] || buyer.players.map((y) => y.id)).filter((id) => id !== p.id), p.id]
      const abroad = { ...(s.abroad || {}) }
      delete abroad[p.id]
      s = { ...s, rosters, abroad, signed: [...(s.signed || []).filter((x) => x.id !== p.id), { ...p, from: undefined }], gone: { ...(s.gone || {}), [p.id]: true } }
    }
    move(p, t.id, buyer.id)
    cash[buyer.id] = r1(budget - fee)
    done[buyer.id] = (done[buyer.id] || 0) + 1
    bought++
    deals.push({ season, round, name: p.name, pos: p.pos, ovr: playerOvrOf(p), age: p.age, from: t.name, to: buyer.name, league, fee })
    // 명단이 넘치면 그 포지션에서 가장 약한 선수를 내보낸다 (FA 시장으로)
    const now = byId()[buyer.id]
    if (now.players.length > ROSTER_SOFT) {
      const out = now.players.filter((x) => x.pos === p.pos && x.id !== p.id).sort((a, b) => playerOvrOf(a) - playerOvrOf(b))[0]
      if (out) {
        const rosters = { ...s.rosters, [buyer.id]: s.rosters[buyer.id].filter((id) => id !== out.id) }
        s = { ...s, rosters, released: [...(s.released || []), { ...out, from: buyer.id }] }
        move(out, buyer.id, null)
      }
    }
  }

  // 다른 리그로 팔려 나감: 사 온 만큼 나가서 리그 수준이 한쪽으로 쏠리지 않게 한다 (라운드당 최대 1건)
  if (foreign.length && rnd(`out-${wkey}-${round}`) < 0.3) {
    const seller = order.find((t) => byId()[t.id].players.length > 24 && rnd(`sell-${wkey}-${round}-${t.id}`) < 0.5)
    const st = seller && byId()[seller.id]
    if (st) {
      const ranked = [...st.players].sort((a, b) => playerOvrOf(b) - playerOvrOf(a))
      const cands = ranked.slice(5, 18).filter((p) => p.age >= 24 && p.age <= 31 && !s.loans?.[p.id])
      const p = cands[hash(`who-${wkey}-${round}`) % Math.max(1, cands.length)]
      const dest = foreign[hash(`dest-${wkey}-${round}-${p?.id}`) % foreign.length]
      if (p && dest && evaluateBid({ theirs: st, player: p, fee: 1e6, status: s.status || {}, value: 1 }).verdict === 'accept') {
        const fee = r1(valueOf(p, s.status?.[p.id], valueCtx(s, p, leagueId)) * 1.05)
        const rosters = { ...(s.rosters || Object.fromEntries(liveTeams.map((x) => [x.id, x.players.map((y) => y.id)]))) }
        rosters[st.id] = (rosters[st.id] || st.players.map((y) => y.id)).filter((id) => id !== p.id)
        const gone = { ...(s.gone || {}) }
        delete gone[p.id]
        s = { ...s, rosters, gone, abroad: { ...(s.abroad || {}), [p.id]: { lid: dest.lid, teamId: dest.team.id, player: { ...p } } } }
        move(p, st.id, null)
        cash[st.id] = r1((cash[st.id] || 0) + fee * 0.8)
        deals.push({ season, round, name: p.name, pos: p.pos, ovr: playerOvrOf(p), age: p.age, from: st.name, to: dest.team.name, league: dest.league, fee, out: true })
      }
    }
  }

  // 더 큰 리그의 구단이 이 리그의 스타를 데려감: 자기 구단보다 확실히 강한 해외 구단이 많을수록(=작은 리그일수록) 자주 일어난다
  //   현실의 에레디비시·프리메이라리가처럼, 키운 선수를 팔고 그 돈으로 다시 사는 순환이 생긴다
  let poached = 0
  for (const t0 of order) {
    if (poached >= 2 || !foreign.length) break
    const st = byId()[t0.id]
    if (st.players.length <= 22) continue
    const tStr = strengthOf(st)
    const bigger = foreign.filter((w) => strengthOf(w.team) >= tStr + 2)
    const pPoach = Math.min(0.5, bigger.length / 120) // 더 강한 해외 구단이 60곳이면 라운드마다 50%
    if (rnd(`star-${wkey}-${round}-${st.id}`) >= pPoach) continue
    const ranked = [...st.players].sort((a, b) => playerOvrOf(b) - playerOvrOf(a))
    const cands = ranked.slice(0, 6).filter((p) => p.age <= 28 && !s.loans?.[p.id])
    const p = cands[hash(`starwho-${wkey}-${round}-${st.id}`) % Math.max(1, Math.min(3, cands.length))] // 가장 뛰어난 선수 위주로
    if (!p) continue
    // 그 선수를 실제로 주전으로 쓸 만한 구단 (선수보다 주전 평균이 높은 구단)
    const fits = bigger.filter((w) => strengthOf(w.team) <= playerOvrOf(p) + 4)
    const dest = (fits.length ? fits : bigger)[hash(`stardest-${wkey}-${round}-${p.id}`) % (fits.length || bigger.length)]
    const v = valueOf(p, s.status?.[p.id], valueCtx(s, p, leagueId))
    const r = evaluateBid({ theirs: st, player: p, fee: v * 3, status: s.status || {}, value: v })
    if (r.verdict !== 'accept' || !r.need) continue
    const fee = r1(r.need)
    const rosters = { ...(s.rosters || Object.fromEntries(liveTeams.map((x) => [x.id, x.players.map((y) => y.id)]))) }
    rosters[st.id] = (rosters[st.id] || st.players.map((y) => y.id)).filter((id) => id !== p.id)
    const gone = { ...(s.gone || {}) }
    delete gone[p.id]
    s = { ...s, rosters, gone, abroad: { ...(s.abroad || {}), [p.id]: { lid: dest.lid, teamId: dest.team.id, player: { ...p } } } }
    move(p, st.id, null)
    cash[st.id] = r1((cash[st.id] || 0) + fee * 0.8)
    poached++
    deals.push({ season, round, name: p.name, pos: p.pos, ovr: playerOvrOf(p), age: p.age, from: st.name, to: dest.team.name, league: dest.league, fee, out: true })
  }

  const inbox = []
  if (deals.length) {
    const lines = deals.map((d) => `${d.name}(${POS_KO[d.pos]}, ${d.age}세): ${d.from} → ${d.to}${d.league ? ` (${d.league})` : ''} · ${money(d.fee)}`)
    inbox.push(news(round, 'trade', `📰 이적 시장 소식 ${deals.length}건`, lines.join(' / '), { read: true }))
  }

  // 더 큰 구단이 내 주전에게 먼저 제안 (시장마다 한 번, 판매 목록에 없어도)
  const my = liveTeams.find((t) => t.id === myTeamId)
  if (my && !s.aiDeals?.[wkey]?.poach && rnd(`poach-${wkey}-${round}`) < 0.3) {
    const myStr = strengthOf(my)
    const bigger = ai.filter((t) => strengthOf(t) >= myStr + 1 && (cash[t.id] || 0) > 5)
    const targets = [...my.players].sort((a, b) => playerOvrOf(b) - playerOvrOf(a)).slice(0, 8).filter((p) => !(s.forSale || []).includes(p.id) && !s.status?.[p.id]?.wantsOut && !s.loans?.[p.id] && p.age <= 29)
    const p = targets[hash(`pt-${wkey}`) % Math.max(1, targets.length)]
    if (p && (bigger.length || foreign.length)) {
      inbox.push(...aiBidFor(s, liveTeams, myTeamId, p.id, round, leagueId, world).slice(0, 1).map((m) => ({ ...m, title: m.title.replace('영입 제안', '먼저 온 영입 제안') })))
      done.poach = 1
    }
  }

  return {
    ...s,
    aiCash: cash,
    aiDeals: { ...(s.aiDeals || {}), [wkey]: done },
    marketLog: [...deals.reverse(), ...(s.marketLog || [])].slice(0, 40),
    inbox: [...inbox, ...(s.inbox || [])].slice(0, 80),
  }
}
