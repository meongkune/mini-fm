// 장기 플레이: 보드 목표·신뢰도, 시즌 마감, 성장·노화·은퇴, 유스 입단, 다음 시즌
import { playerOvrOf } from '../engine/engine.js'
import { news } from './season.js'
import { potentialOf } from './trade.js'

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
const rnd = (key) => (hash(key) % 10000) / 10000
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const teamStrength = (t) => {
  const top = t.players.map(playerOvrOf).sort((a, b) => b - a).slice(0, 11)
  return top.reduce((s, v) => s + v, 0) / top.length
}

/** 시즌 라벨: 데이터 시즌(2025-26) + 몇 번째 시즌인지 → 2026-27 … */
export function seasonLabel(base, seasonNo = 1) {
  const y = parseInt(base, 10)
  if (!y) return base
  const s = y + seasonNo - 1
  if (!String(base).includes('-')) return String(s) // 브라질처럼 한 해에 끝나는 리그
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`
}

/** 전력 순위로 보드 목표를 정한다 */
export function boardTarget(teams, myTeamId) {
  const n = teams.length
  const rank = [...teams].sort((a, b) => teamStrength(b) - teamStrength(a)).findIndex((t) => t.id === myTeamId) + 1
  if (rank <= 2) return { pos: 2, label: '우승 경쟁 (2위 이내)' }
  if (rank <= 4) return { pos: 4, label: '챔피언스리그 진출 (4위 이내)' }
  if (rank <= 7) return { pos: 7, label: '대항전 진출 (7위 이내)' }
  if (rank <= Math.ceil(n / 2) + 1) return { pos: Math.ceil(n / 2) + 2, label: `중위권 안착 (${Math.ceil(n / 2) + 2}위 이내)` }
  return { pos: n - 3, label: `1부 잔류 (${n - 3}위 이내)` }
}

export function newBoard(teams, myTeamId, prev) {
  return { ...boardTarget(teams, myTeamId), confidence: prev?.confidence ?? 60, fails: prev?.fails ?? 0, warned: false }
}

/** 시즌 중반 점검: 목표보다 많이 뒤처지면 경고 (라운드 결과 반영 직후 호출) */
export function boardMidCheck(save, standings, totalRounds) {
  const b = save.board
  if (!b || b.warned || save.round !== Math.floor(totalRounds / 2)) return save
  const pos = standings.findIndex((s) => s.id === save.teamId) + 1
  if (pos <= b.pos + 3) {
    return { ...save, board: { ...b, warned: true, confidence: clamp(b.confidence + 5, 0, 100) }, inbox: [news(save.round, 'board', '보드: 중간 평가', `현재 ${pos}위로 목표(${b.label})를 향해 순조롭게 가고 있습니다. 계속 이렇게 해 주십시오.`), ...save.inbox] }
  }
  return { ...save, board: { ...b, warned: true, confidence: clamp(b.confidence - 15, 0, 100) }, inbox: [news(save.round, 'board', '보드: 경고', `현재 ${pos}위입니다. 목표(${b.label})와 거리가 멉니다. 후반기에 반등하지 못하면 거취를 논의하겠습니다.`), ...save.inbox] }
}

/** 시즌 평가 */
export function seasonReview(save, standings) {
  const b = save.board || { pos: standings.length, label: '-' }
  const pos = standings.findIndex((s) => s.id === save.teamId) + 1
  const success = pos <= b.pos
  const fails = success ? 0 : (b.fails || 0) + 1
  const sacked = false // 구단주 겸 감독: 보드 경질 대신 파산이 게임 오버
  return { pos, success, fails, sacked, target: b }
}

// 유스 선수 이름 (리그 나라별)
const NAMES = {
  잉글랜드: [['Jack', 'Harry', 'Oliver', 'George', 'Alfie', 'Charlie', 'Leo', 'Freddie', 'Archie', 'Theo'], ['Walker', 'Bennett', 'Hughes', 'Carter', 'Mitchell', 'Brooks', 'Turner', 'Price', 'Fletcher', 'Lawson']],
  스페인: [['Pablo', 'Hugo', 'Álvaro', 'Mario', 'Diego', 'Adrián', 'Marc', 'Iker', 'Javi', 'Nico'], ['García', 'Romero', 'Navarro', 'Torres', 'Ruiz', 'Gil', 'Molina', 'Serrano', 'Ortega', 'Castro']],
  독일: [['Lukas', 'Jonas', 'Leon', 'Finn', 'Paul', 'Elias', 'Noah', 'Felix', 'Moritz', 'Jannik'], ['Müller', 'Schmidt', 'Wagner', 'Becker', 'Hoffmann', 'Koch', 'Richter', 'Wolf', 'Neumann', 'Krause']],
  이탈리아: [['Lorenzo', 'Matteo', 'Leonardo', 'Tommaso', 'Riccardo', 'Gabriele', 'Pietro', 'Davide', 'Samuele', 'Nicolò'], ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Greco', 'Bruno']],
  프랑스: [['Lucas', 'Hugo', 'Louis', 'Nathan', 'Enzo', 'Mathis', 'Rayan', 'Kylian', 'Théo', 'Yanis'], ['Martin', 'Bernard', 'Dubois', 'Laurent', 'Moreau', 'Simon', 'Michel', 'Lefebvre', 'Garnier', 'Faure']],
}

/** 다음 시즌 준비: 성장·노화·은퇴·유스, 기록 초기화, 보드 목표 갱신 */
export function nextSeason(save, { teams, baseTeams, standings, country, baseSeason }) {
  const review = seasonReview(save, standings)
  const no = save.seasonNo || 1
  const label = seasonLabel(baseSeason, no)
  const my = teams.find((t) => t.id === save.teamId)
  const ps = save.pstats || {}
  const myStats = my.players.map((p) => ({ p, s: ps[p.id] })).filter((x) => x.s)
  const top = myStats.sort((a, b) => b.s.g - a.s.g)[0]

  const history = [...(save.history || []), {
    seasonNo: no, label, pos: review.pos, pts: standings[review.pos - 1]?.pts, target: review.target.label, success: review.success,
    champion: standings[0]?.id, topScorer: top ? { name: top.p.name, g: top.s.g } : null,
  }]

  // 성장·노화 (모든 구단). PA는 처음 계산한 값을 mods에 고정
  const mods = { ...(save.mods || {}) }
  const base = {}
  for (const t of baseTeams) for (const p of t.players) base[p.id] = p
  for (const p of save.youth || []) base[p.id] = p
  const retired = []
  const growth = []
  const roundsPlayed = Math.max(1, save.round)
  for (const t of teams) {
    for (const p of t.players) {
      const m = { ...(mods[p.id] || {}) }
      const pa = m.pa ?? p.pa ?? potentialOf(base[p.id] || p)
      const age = p.age + 1
      if ((age >= 37 || (age >= 35 && rnd(`ret-${p.id}-${no}`) < 0.6)) && !p.youth) { retired.push({ p, team: t.id }); continue }
      const ovr = playerOvrOf(p)
      const k = `g-${p.id}-${no}`
      const played = t.id === save.teamId ? clamp((ps[p.id]?.min || 0) / (roundsPlayed * 90) * 1.2 + 0.3, 0.3, 1.2) : 0.7
      let d
      if (p.age <= 23) d = Math.min(pa - ovr, Math.round((1.5 + rnd(k) * 4) * played))
      else if (p.age <= 27) d = Math.min(pa - ovr, Math.round(-1.2 + rnd(k) * 2.6))
      else if (p.age <= 30) d = Math.round(-2.2 + rnd(k) * 2)
      else if (p.age <= 32) d = Math.round(-4.5 + rnd(k) * 3)
      else d = Math.round(-6.5 + rnd(k) * 4)
      const ds = p.age <= 24 ? 1 : p.age >= 30 ? -2 : 0
      mods[p.id] = { ...m, pa, age, att: clamp(p.att + d, 35, 97), def: clamp(p.def + d, 35, 97), sta: clamp(p.sta + ds, 35, 97) }
      if (t.id === save.teamId && d !== 0) growth.push({ p, d })
    }
  }

  // 은퇴 반영 + 유스 입단 (내 팀 2명)
  const rosters = { ...(save.rosters || Object.fromEntries(teams.map((t) => [t.id, t.players.map((p) => p.id)]))) }
  for (const t of teams) if (!rosters[t.id]) rosters[t.id] = t.players.map((p) => p.id)
  for (const r of retired) rosters[r.team] = rosters[r.team].filter((id) => id !== r.p.id)
  const [firsts, lasts] = NAMES[country] || NAMES['잉글랜드']
  const makeYouth = (teamId, i, lvl, age) => {
    const k = `y-${teamId}-${no}-${i}`
    const pos = ['DF', 'MF', 'FW', 'MF', 'DF', 'GK'][hash(k) % (i % 4 === 3 ? 6 : 4)]
    const bias = { GK: [-30, 2], DF: [-10, 6], MF: [0, 0], FW: [8, -18] }[pos]
    return {
      id: `${teamId}-Y${no}${i}`,
      name: `${firsts[hash(k + 'f') % firsts.length]} ${lasts[hash(k + 'n') % lasts.length]}`,
      pos, age, att: clamp(lvl + bias[0], 35, 90), def: clamp(lvl + bias[1], 35, 90), sta: clamp(lvl + 4, 35, 90),
      pa: clamp(lvl + 12 + Math.round(rnd(k + 'p') * 18), 60, 94), youth: true,
    }
  }
  const youthPool = [...(save.youth || [])]
  // AI 구단: 은퇴로 25명 아래가 되면 자체 유스·영입 선수로 채운다 (팀 평균보다 조금 낮은 수준)
  for (const t of teams) {
    if (t.id === save.teamId) continue
    const lvl = Math.round(teamStrength(t)) - 7
    let i = 0
    while (rosters[t.id].length < 25) {
      const p = { ...makeYouth(t.id, i, lvl + Math.round(rnd(`${t.id}${no}${i}`) * 4), 18 + (i % 3)), number: 40 + i }
      youthPool.push(p); rosters[t.id] = [...rosters[t.id], p.id]; i++
    }
  }
  // 내 팀: 28명이 넘으면 30세 이상 중 능력치 낮은 선수부터 계약 만료
  const expired = []
  const myIds = rosters[save.teamId]
  const byIdAll = Object.fromEntries(teams.flatMap((t) => t.players).map((p) => [p.id, p]))
  const surplus = myIds.length + 2 - 28
  if (surplus > 0) {
    const leave = myIds.map((id) => byIdAll[id]).filter((p) => p && p.age >= 29 && !save.lineup.includes(p.id)).sort((a, b) => playerOvrOf(a) - playerOvrOf(b)).slice(0, surplus)
    for (const p of leave) expired.push(p)
    rosters[save.teamId] = myIds.filter((id) => !leave.some((p) => p.id === id))
  }
  const usedNums = new Set(my.players.map((p) => p.number))
  const youth = youthPool
  const newcomers = []
  for (let i = 0; i < (save.owner?.youthBoost ? 3 : 2); i++) {
    const number = [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43].find((n) => !usedNums.has(n)) ?? 50 + i
    usedNums.add(number)
    const p = { ...makeYouth(save.teamId, i, (save.owner?.youthBoost ? 60 : 54) + Math.round(rnd(`${save.teamId}${no}l${i}`) * 10), 16 + (i % 2)), number }
    youth.push(p)
    newcomers.push(p)
    rosters[save.teamId] = [...rosters[save.teamId], p.id]
  }

  // 상태: 컨디션·부상·징계 초기화, 사기는 평균 쪽으로
  const status = {}
  for (const [id, s] of Object.entries(save.status || {})) status[id] = { morale: Math.round((s.morale ?? 60) * 0.5 + 30), form: 6.6, fr: [], cond: 100, inj: 0, susp: 0, benched: 0 }

  const conf = clamp((save.board?.confidence ?? 60) + (review.success ? 15 : -20), 0, 100)
  const next = no + 1
  const inbox = [
    news(0, 'season', `${seasonLabel(baseSeason, next)} 시즌 시작`, `지난 시즌 ${review.pos}위 (${review.target.label} ${review.success ? '달성 ✓' : '실패 ✗'}). ${retired.filter((r) => r.team === save.teamId).length ? `은퇴: ${retired.filter((r) => r.team === save.teamId).map((r) => r.p.name).join(', ')}. ` : ''}${expired.length ? `계약 만료: ${expired.map((p) => p.name).join(', ')}. ` : ''}${growth.length ? `성장 상위: ${[...growth].sort((a, b) => b.d - a.d).slice(0, 3).map((g) => `${g.p.name} ${g.d > 0 ? '+' : ''}${g.d}`).join(', ')}.` : ''}`),
    ...newcomers.map((p) => news(0, 'youth', `유스 입단: ${p.name}`, `${p.age}세 ${p.pos} ${p.name} 선수가 1군에 합류했습니다. 스카우트는 성장 가능성을 눈여겨보고 있습니다.`, { playerId: p.id })),
  ]
  const fresh = {
    ...save,
    seasonNo: next, round: 0, results: [], pstats: {}, status, mods, rosters, youth, history,
    tradeLog: [], bidTalks: {}, inbox: [...inbox, ...(save.inbox || [])].slice(0, 80),
    lineup: save.lineup.map((id) => (id && rosters[save.teamId].includes(id) ? id : null)),
  }
  return { save: fresh, review, conf, next }
}
