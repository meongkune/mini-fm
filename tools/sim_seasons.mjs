// 여러 시즌 밸런스 시뮬레이션: 리그 하나를 사람 없이 N시즌 돌려서 전력·득점·이적 시장·재정이 무너지지 않는지 본다.
// 실행: node tools/sim_seasons.mjs [리그=premier-league] [구단=BRE] [시즌 수=6]
//   내 구단은 '아무것도 안 하는 감독'(영입·판매·재계약 없음)으로 두고, 경기 정산·상금·FFP·이사회 예산만 굴린다.
//   --check 를 붙이면 범위를 벗어날 때 종료 코드 1 (CI용)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FE = path.join(ROOT, 'frontend')
const imp = (f) => import(pathToFileURL(path.join(FE, 'src', f)).href)
const { playerOvrOf, roundRobin } = await imp('engine/engine.js')
const { applyRound } = await imp('game/season.js')
const { effectiveTeams } = await imp('game/roster.js')
const { nextSeason, newBoard } = await imp('game/career.js')
const { runMarket, strengthOf } = await imp('game/market.js')
const F = await imp('game/finance.js')

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const CHECK = process.argv.includes('--check')
const LID = args[0] || 'premier-league'
const SEASONS = Number(args[2]) || 6
const index = JSON.parse(fs.readFileSync(path.join(FE, 'public/data/index.json'), 'utf8'))
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null)
const load = (lid) => {
  const l = index.leagues.find((x) => x.id === lid)
  const d = readJson(path.join(FE, 'public/data', l.seasons[0].file))
  const r = readJson(path.join(FE, 'public/data/ratings', `${lid}.json`))?.players || {}
  const w = readJson(path.join(FE, 'public/data/wages', `${lid}.json`))?.players || {}
  return { ...d, name: l.name, teams: d.teams.map((t) => ({ ...t, players: t.players.map((p) => ({ ...p, ...(r[p.id] || {}), ...(w[p.id]?.w ? { realWage: w[p.id].w } : {}) })) })) }
}
const data = load(LID)
const MY = args[1] || data.teams[Math.floor(data.teams.length / 2)].id
const world = index.leagues.filter((l) => l.id !== LID && l.id !== 'k-league' && l.seasons?.[0]?.file).flatMap((l) => { try { const d = load(l.id); return d.teams.map((t) => ({ lid: l.id, league: l.name, team: t })) } catch { return [] } })
const schedule = roundRobin(data.teams.map((t) => t.id))
const N = schedule.length

const table = (teams, results) => {
  const T = Object.fromEntries(teams.map((t) => [t.id, { id: t.id, name: t.name, pts: 0, gd: 0, gf: 0 }]))
  for (const r of results) {
    const [h, a] = r.score
    T[r.home].gf += h; T[r.away].gf += a; T[r.home].gd += h - a; T[r.away].gd += a - h
    if (h > a) T[r.home].pts += 3; else if (h < a) T[r.away].pts += 3; else { T[r.home].pts++; T[r.away].pts++ }
  }
  return Object.values(T).sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf)
}
const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)
const f1 = (v) => v.toFixed(1)

const my0 = data.teams.find((t) => t.id === MY)
const fin0 = F.newFinance(my0, LID)
F.setClubK(fin0.clubK)
F.setFx({ mode: 'eur' })
let save = { league: LID, teamId: MY, seasonNo: 1, round: 0, results: [], pstats: {}, status: {}, lineup: [], formation: '4-4-2', inbox: [], contracts: {}, finance: fin0, fans: 60 }
save.contracts = Object.fromEntries(my0.players.map((p) => [p.id, F.contractOf(save, p, LID)])) // 게임처럼 시작할 때 내 선수 계약을 고정
save.board = newBoard(data.teams, MY)
console.log(`■ ${data.name} · 내 구단 ${my0.name} · ${SEASONS}시즌`)
console.log(`  시작 재정: 예상 매출 €${f1(F.revenueOf(fin0))}M · 연봉 €${f1(F.wageBill(save, my0, LID))}M · 현금 €${fin0.cash}M · 이적 자금 €${F.transferFunds(fin0)}M · 임금 예산 €${F.wageBudget(fin0)}M`)
const rows = []
const t0 = Date.now()
for (let sn = 1; sn <= SEASONS; sn++) {
  for (let r = 0; r < N; r++) {
    const teams = effectiveTeams(data.teams, save)
    const teamsById = Object.fromEntries(teams.map((t) => [t.id, t]))
    const round = save.round
    save = applyRound(save, { teamsById, schedule, myTeamId: MY, mine: null, buyers: world })
    save = runMarket(save, { teams: effectiveTeams(data.teams, save), myTeamId: MY, leagueId: LID, round, totalRounds: N, world })
    const fx = schedule[round].find((f) => f.home === MY || f.away === MY)
    const res = save.results.find((x) => x.round === round && x.home === fx.home && x.away === fx.away)
    const d = fx.home === MY ? res.score[0] - res.score[1] : res.score[1] - res.score[0]
    const m = F.settleMatch(save, { team: teamsById[MY], leagueId: LID, home: fx.home === MY, result: Math.sign(d), totalRounds: N })
    save = { ...save, ...m, inbox: [] }
  }
  const teams = effectiveTeams(data.teams, save)
  const st = table(teams, save.results)
  const str = teams.map(strengthOf).sort((a, b) => b - a)
  const ages = teams.flatMap((t) => t.players.map((p) => p.age))
  const goals = save.results.reduce((a, r) => a + r.score[0] + r.score[1], 0) / save.results.length
  const deals = (save.marketLog || []).filter((d) => d.season === sn)
  const my = teams.find((t) => t.id === MY)
  const pos = st.findIndex((x) => x.id === MY) + 1
  const bill = F.wageBill(save, my, LID)
  const prize = F.prizeMoney(pos, st.length, save.finance.base)
  const ffp = F.ffpReview(F.book(save.finance, prize, '리그 상금'), bill, sn)
  rows.push({
    sn, champ: st[0].name, pts: `${st[0].pts}/${st.at(-1).pts}`, goals, top3: avg(str.slice(0, 3)), mid: avg(str), bot3: avg(str.slice(-3)),
    age: avg(ages), size: avg(teams.map((t) => t.players.length)), deals: deals.length, maxFee: Math.max(0, ...deals.map((d) => d.fee)), inOut: `${deals.filter((d) => d.league && !d.out).length}/${deals.filter((d) => d.out).length}`,
    pos, bill, net: ffp.st.cur, cash: ffp.finance.cash, ffp: ffp.st.label, ratio: ffp.st.ratio, myStr: strengthOf(my),
  })
  const r = nextSeason(save, { teams, baseTeams: data.teams, standings: st, country: data.league?.country || '잉글랜드', baseSeason: data.season })
  const finance = F.boardBudgets(ffp.finance, { success: r.review.success, confidence: r.conf, bill })
  save = { ...r.save, finance, inbox: [], board: newBoard(effectiveTeams(data.teams, r.save), MY, { confidence: r.conf, fails: r.review.fails }) }
}
console.log(`\n시즌 | 우승 | 1위/꼴찌 승점 | 골/경기 | 상위3·평균·하위3 전력 | 평균나이 | 명단 | 이적(최고액, 해외 영입/방출) || 내 순위 | 내 전력 | 연봉 | 시즌손익 | 현금 | 연봉/매출 | FFP`)
for (const x of rows) {
  console.log(`${String(x.sn).padStart(3)}  | ${x.champ.padEnd(10)} | ${x.pts.padEnd(6)} | ${x.goals.toFixed(2)} | ${f1(x.top3)} · ${f1(x.mid)} · ${f1(x.bot3)} | ${f1(x.age)} | ${f1(x.size)} | ${String(x.deals).padStart(2)}건 (€${f1(x.maxFee)}M, ${x.inOut}) || ${String(x.pos).padStart(2)}위 | ${f1(x.myStr)} | €${f1(x.bill)}M | ${x.net >= 0 ? '+' : ''}${f1(x.net)} | €${f1(x.cash)}M | ${Math.round(x.ratio * 100)}% | ${x.ffp}`)
}
console.log(`\n소요 ${((Date.now() - t0) / 1000).toFixed(1)}초`)

if (CHECK) {
  const a = rows[0]
  const z = rows.at(-1)
  const checks = [
    ['리그 평균 전력 변화(첫 시즌→마지막)', z.mid - a.mid, -2.5, 2.5],
    ['상위 3팀 전력 변화', z.top3 - a.top3, -3.5, 3.5],
    ['하위 3팀 전력 변화', z.bot3 - a.bot3, -3.5, 3.5],
    ['마지막 시즌 골/경기', z.goals, 2.2, 3.4],
    ['평균 나이 변화', z.age - a.age, -2, 2],
    ['시즌당 AI 이적 건수(평균)', avg(rows.map((x) => x.deals)), 4, 40],
    ['평균 명단 크기(마지막)', z.size, 22, 32],
  ]
  let bad = 0
  for (const [name, v, lo, hi] of checks) { const ok = v >= lo && v <= hi; if (!ok) bad++; console.log(`${ok ? '✔' : '✖'} ${name}: ${v.toFixed(2)} (정상 ${lo}~${hi})`) }
  if (bad) { console.log('\n시즌 밸런스 검사 실패'); process.exit(1) }
  console.log('\n시즌 밸런스 검사 통과')
}
