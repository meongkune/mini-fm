// 대항전(챔피언스·유로파·컨퍼런스리그): 여러 리그 상위 팀이 모이는 대회 (조별리그 → 단판 토너먼트)
// 리그 경기 사이(정해진 라운드 뒤)에 매치데이가 끼어든다. 세이브에는 대진·결과만 저장하고 팀 데이터는 각 리그 파일에서 읽는다.
import { playerOvrOf } from '../engine/engine.js'
import { quickMatch } from '../engine/match.js'

// 대항전 3개: 리그 순위에 따라 챔피언스리그 → 유로파리그 → 컨퍼런스리그 순으로 나눠 나간다 (한 팀은 한 대회만)
export const COMPS = [
  { id: 'ucl', name: '챔피언스리그', short: '챔스', icon: '🏆', pay: 1 },
  { id: 'uel', name: '유로파리그', short: '유로파', icon: '🥈', pay: 0.55 },
  { id: 'uecl', name: '컨퍼런스리그', short: '컨퍼런스', icon: '🥉', pay: 0.3 },
]
export const CUP_NAME = COMPS[0].name
// 리그별 [챔스, 유로파, 컨퍼런스] 출전 팀 수 → 각 대회 32팀
const BIG = [5, 3, 4]
const MID = [3, 5, 4]
export const SLOTS = { 'premier-league': BIG, 'la-liga': BIG, bundesliga: BIG, 'serie-a': BIG, 'ligue-1': MID, eredivisie: MID, 'primeira-liga': MID, brasileirao: MID }
export const CUP_LEAGUES = Object.keys(SLOTS)
/** 대회 안의 팀 키: 리그가 달라도 약자가 같을 수 있어(FCB=바르셀로나·바이에른) 리그 ID를 붙인다 */
export const cupKey = (leagueId, teamId) => `${leagueId}/${teamId}`

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
export const strength = (t) => {
  const top = t.players.map(playerOvrOf).sort((a, b) => b - a).slice(0, 11)
  return top.reduce((s, v) => s + v, 0) / (top.length || 1)
}

/**
 * 세 대회 참가팀 선정 + 조 추첨 + 일정
 * @param leagues [{ leagueId, teams, order? }] order는 지난 시즌 순위(팀 ID 배열, 없으면 전력 순)
 * @returns 대회 배열 (리그가 하나뿐이면 빈 배열)
 */
export function buildCups(leagues, { seed = 1, totalRounds = 38 } = {}) {
  const pools = leagues
    .filter((l) => SLOTS[l.leagueId] && l.teams.length >= 4)
    .map((l) => {
      const ranked = l.order?.length ? l.order.map((id) => l.teams.find((t) => t.id === id)).filter(Boolean) : [...l.teams].sort((a, b) => strength(b) - strength(a))
      return { leagueId: l.leagueId, ranked, next: 0 }
    })
  if (pools.length < 2) return []
  const used = new Set()
  const cups = []
  COMPS.forEach((comp, ci) => {
    const picked = []
    for (const p of pools) {
      for (const t of p.ranked.slice(p.next, p.next + SLOTS[p.leagueId][ci])) picked.push({ t, leagueId: p.leagueId })
      p.next += SLOTS[p.leagueId][ci]
    }
    // 리그 데이터가 빠져 자리가 남으면 아직 안 뽑힌 팀 중 리그 순위가 높은 팀부터 채운다
    const left = pools.flatMap((p) => p.ranked.slice(p.next).map((t, i) => ({ t, leagueId: p.leagueId, i, p })))
      .filter((e) => !used.has(cupKey(e.leagueId, e.t.id))).sort((a, b) => a.i - b.i || strength(b.t) - strength(a.t))
    const size = picked.length + left.length >= 32 ? 32 : 16
    while (picked.length < size && left.length) { const e = left.shift(); e.p.next++; picked.push(e) }
    const entrants = picked.slice(0, size).map((e) => ({ t: e.t, leagueId: e.leagueId, key: cupKey(e.leagueId, e.t.id) }))
    entrants.forEach((e) => used.add(e.key))
    if (entrants.length >= 16) cups.push({ id: comp.id, tier: ci, ...drawCup(entrants, comp.name, size, seed + ci * 7, totalRounds) })
  })
  return cups
}

function drawCup(list, name, size, seed, totalRounds) {
  const entrants = [...list].sort((a, b) => strength(b.t) - strength(a.t))
  const groupsN = size / 4

  // 포트 추첨: 전력 순 4개 포트, 같은 리그끼리는 같은 조에 넣지 않으려 노력
  const groups = Array.from({ length: groupsN }, () => [])
  for (let pot = 0; pot < 4; pot++) {
    const potTeams = entrants.slice(pot * groupsN, (pot + 1) * groupsN).sort((a, b) => hash(`${seed}-${a.key}`) - hash(`${seed}-${b.key}`))
    for (const e of potTeams) {
      const free = groups.map((g, i) => i).filter((i) => groups[i].length === pot)
      const ok = free.find((i) => !groups[i].some((x) => x.leagueId === e.leagueId)) ?? free[0]
      groups[ok].push(e)
    }
  }
  // 조별 매치데이 6개: 더블 라운드 로빈
  // 각 팀이 홈 3번·원정 3번 (1~3차전과 4~6차전은 홈·원정을 뒤집는다)
  const pairs = [[[0, 1], [2, 3]], [[2, 0], [1, 3]], [[0, 3], [1, 2]]]
  const at = (k) => Math.max(1, Math.round(totalRounds * k))
  const groupAfter = [0.08, 0.16, 0.24, 0.32, 0.4, 0.48].map(at)
  const fixtures = []
  for (let md = 0; md < 6; md++) {
    const pr = pairs[md % 3]
    groups.forEach((g, gi) => {
      for (const [a, b] of pr) {
        const [h, w] = md < 3 ? [g[a], g[b]] : [g[b], g[a]]
        fixtures.push({ stage: 'group', md, group: gi, home: h.key, away: w.key })
      }
    })
  }
  const koStages = size === 32 ? ['R16', 'QF', 'SF', 'F'] : ['QF', 'SF', 'F']
  const koAfter = (size === 32 ? [0.58, 0.68, 0.78, 0.9] : [0.62, 0.76, 0.9]).map(at)
  return {
    name,
    size,
    teams: entrants.map((e) => ({ key: e.key, id: e.t.id, leagueId: e.leagueId, name: e.t.name, short: e.t.short, color: e.t.color, ext: e.t.ext })),
    groups: groups.map((g) => g.map((e) => e.key)),
    matchdays: [
      ...groupAfter.map((after, md) => ({ key: `G${md + 1}`, label: `조별리그 ${md + 1}차전`, stage: 'group', md, after })),
      ...koStages.map((s, i) => ({ key: s, label: { R16: '16강', QF: '8강', SF: '4강', F: '결승' }[s], stage: s, after: koAfter[i] })),
    ],
    fixtures,
    played: [], // 끝난 매치데이 key
    winner: null,
  }
}

export const STAGE_LABEL = { R16: '16강', QF: '8강', SF: '4강', F: '결승' }

/** 조 순위 */
export function groupTable(cup, gi) {
  const rows = Object.fromEntries(cup.groups[gi].map((id) => [id, { id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]))
  for (const f of cup.fixtures) {
    if (f.stage !== 'group' || f.group !== gi || !f.score) continue
    const [h, a] = f.score
    const H = rows[f.home]
    const A = rows[f.away]
    H.p++; A.p++; H.gf += h; H.ga += a; A.gf += a; A.ga += h
    if (h > a) { H.w++; A.l++; H.pts += 3 } else if (h < a) { A.w++; H.l++; A.pts += 3 } else { H.d++; A.d++; H.pts++; A.pts++ }
  }
  return Object.values(rows).sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.id.localeCompare(y.id))
}

/** 다음 매치데이 (리그 라운드를 after만큼 치렀고 아직 안 끝난 것) */
export function dueMatchday(cup, leagueRoundsDone) {
  if (!cup || cup.winner) return null
  return cup.matchdays.find((m) => !cup.played.includes(m.key) && leagueRoundsDone >= m.after) || null
}

/** 그 매치데이의 경기 목록 (토너먼트는 대진이 정해졌을 때) */
export const fixturesOf = (cup, md) => cup.fixtures.filter((f) => (md.stage === 'group' ? f.stage === 'group' && f.md === md.md : f.stage === md.stage))

// 조별리그가 끝나면 16강(또는 8강) 대진: 조 1위 vs 다른 조 2위
function drawFirstKnockout(cup) {
  const stage = cup.size === 32 ? 'R16' : 'QF'
  const tables = cup.groups.map((_, gi) => groupTable(cup, gi))
  const n = tables.length
  const out = []
  for (let i = 0; i < n; i++) out.push({ stage, home: tables[i][0].id, away: tables[(i + 1) % n][1].id, slot: i })
  return out
}
function drawNext(cup, from, to) {
  const prev = cup.fixtures.filter((f) => f.stage === from).sort((a, b) => a.slot - b.slot)
  const out = []
  for (let i = 0; i < prev.length; i += 2) out.push({ stage: to, home: prev[i].winner, away: prev[i + 1].winner, slot: i / 2 })
  return out
}

/**
 * 매치데이 진행. mine = { home, away, summary } (내 경기, 없으면 null)
 * 반환: { cup, results: [ {home, away, score, pens?, winner?, summary} ] }
 */
export function playMatchday(cup, md, teamsById, status, mine, seasonNo = 1) {
  const next = structuredClone(cup)
  const results = []
  for (const f of next.fixtures) {
    const inMd = md.stage === 'group' ? f.stage === 'group' && f.md === md.md : f.stage === md.stage
    if (!inMd || f.score) continue
    const isMine = mine && f.home === mine.home && f.away === mine.away
    const sum = isMine ? mine.summary : quickMatch(teamsById[f.home], teamsById[f.away], status, (hash(`cup-${seasonNo}-${md.key}-${f.home}-${f.away}`) || 1))
    f.score = sum.score
    f.scorers = sum.scorers.map((x) => ({ name: x.name, team: x.team === 0 ? f.home : f.away, minute: x.minute }))
    if (isMine) f.mine = true
    if (md.stage !== 'group') {
      const [h, a] = sum.score
      if (h !== a) f.winner = h > a ? f.home : f.away
      else {
        // 승부차기: 전력이 조금 더 강한 쪽이 약간 유리
        const sh = strength(teamsById[f.home])
        const sa = strength(teamsById[f.away])
        const r = (hash(`pk-${seasonNo}-${f.home}-${f.away}`) % 1000) / 1000
        const homeWins = r < 0.5 + (sh - sa) / 60
        f.winner = homeWins ? f.home : f.away
        f.pens = homeWins ? [5, 4] : [3, 4]
      }
    }
    results.push({ ...f, summary: sum })
  }
  next.played = [...next.played, md.key]
  // 한 단계가 끝나면 바로 다음 대진을 짠다 (다음 상대를 미리 볼 수 있게)
  const order = next.size === 32 ? ['R16', 'QF', 'SF', 'F'] : ['QF', 'SF', 'F']
  if (md.key === 'G6') next.fixtures.push(...drawFirstKnockout(next))
  else if (md.stage !== 'group' && md.stage !== 'F') next.fixtures.push(...drawNext(next, md.stage, order[order.indexOf(md.stage) + 1]))
  if (md.stage === 'F') next.winner = next.fixtures.find((f) => f.stage === 'F')?.winner ?? null
  return { cup: next, results }
}

/** 이 팀의 다음 대회 경기 (대진이 아직 안 나온 토너먼트면 null) */
export function myCupFixture(cup, md, teamId) {
  if (!cup || !md) return null
  return fixturesOf(cup, md).find((f) => !f.score && (f.home === teamId || f.away === teamId)) || null
}

/** 탈락 여부: 조별리그 끝나고 토너먼트 대진에 없으면 탈락 */
export function cupStatus(cup, teamId) {
  if (!cup) return null
  if (!cup.teams.some((t) => t.key === teamId)) return { in: false, text: '이번 시즌 이 대회에는 나가지 않습니다' }
  if (cup.winner === teamId) return { in: true, text: '🏆 우승!' }
  const ko = cup.fixtures.filter((f) => f.stage !== 'group' && (f.home === teamId || f.away === teamId))
  const lost = ko.find((f) => f.winner && f.winner !== teamId)
  if (lost) return { in: true, out: true, text: `${STAGE_LABEL[lost.stage]} 탈락` }
  if (cup.played.includes('G6') && !ko.length) return { in: true, out: true, text: '조별리그 탈락' }
  const last = ko.at(-1)
  const gi = cup.groups.findIndex((g) => g.includes(teamId))
  const pos = groupTable(cup, gi).findIndex((r) => r.id === teamId) + 1
  return { in: true, text: last ? `${STAGE_LABEL[last.stage]} 진출` : `조별리그 ${String.fromCharCode(65 + gi)}조 ${pos}위` }
}

/** 리그 순위표 색 구간: 대항전 출전권(세 대회) + 원래 데이터의 강등 구간 */
export function leagueZones(leagueId, zones = []) {
  const s = SLOTS[leagueId]
  if (!s) return zones
  const colors = ['#3b82f6', '#f59e0b', '#22c55e']
  let from = 1
  const cups = COMPS.map((c, i) => { const z = { from, to: from + s[i] - 1, label: c.name, color: colors[i] }; from += s[i]; return z })
  return [...cups, ...zones.filter((z) => z.from < 0)]
}
