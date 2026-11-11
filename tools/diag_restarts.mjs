// 정지 상황(재개) 진단: 코너킥·스로인·골킥·프리킥·오프사이드가 경기마다 얼마나, 얼마나 고르게(또는 들쭉날쭉하게) 나오는지
// 그리고 공격을 많이 한 팀이 코너킥도 많이 얻는지(슈팅·점유와의 상관)를 실제 축구 통계와 비교한다
// 실행: node tools/diag_restarts.mjs [리그=premier-league]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FE = path.join(ROOT, 'frontend')
const M = await import(pathToFileURL(path.join(FE, 'src/engine/match.js')).href)
const index = JSON.parse(fs.readFileSync(path.join(FE, 'public/data/index.json'), 'utf8'))
const lid = process.argv[2] || 'premier-league'
const l = index.leagues.find((x) => x.id === lid)
const d = JSON.parse(fs.readFileSync(path.join(FE, 'public/data', l.seasons[0].file), 'utf8'))
const rf = path.join(FE, 'public/data/ratings', `${lid}.json`)
const r = fs.existsSync(rf) ? JSON.parse(fs.readFileSync(rf, 'utf8')).players : {}
const teams = d.teams.map((t) => ({ ...t, players: t.players.map((p) => ({ ...p, ...(r[p.id] || {}) })) }))

const per = { corner: [], throw: [], goalkick: [], fk: [], offside: [] } // 경기당 양 팀 합
const teamRows = [] // [코너, 슈팅, 점유율]
let seed = 1
for (const h of teams) for (const a of teams) {
  if (h === a) continue
  const m = M.createMatch({ home: h, away: a, seed: seed++ * 7919, status: {} })
  M.advance(m, { teams: [h, a], status: {} }, 90)
  const c = { corner: 0, throw: 0, goalkick: 0, fk: 0, offside: 0 }
  for (const t of m.timeline) {
    if (t.sp === 'corner') c.corner++
    if (t.r === 'throw') c.throw++
    if (t.r === 'goalkick') c.goalkick++
    if (t.r === 'fk' || t.sp === 'fk' || t.sp === 'fkx' || t.sp === 'pen') c.fk++
    if (t.r === 'offside') c.offside++
  }
  for (const k in per) per[k].push(c[k])
  const P = m.stats[0].poss + m.stats[1].poss
  for (const i of [0, 1]) teamRows.push([m.stats[i].corners, m.stats[i].shots, m.stats[i].poss / P])
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
const sd = (a) => { const u = mean(a); return Math.sqrt(mean(a.map((x) => (x - u) ** 2))) }
const pct = (a, q) => [...a].sort((x, y) => x - y)[Math.floor(q * (a.length - 1))]
const corr = (xs, ys) => { const mx = mean(xs), my = mean(ys); let s = 0, a = 0, b = 0; for (let i = 0; i < xs.length; i++) { s += (xs[i] - mx) * (ys[i] - my); a += (xs[i] - mx) ** 2; b += (ys[i] - my) ** 2 } return s / Math.sqrt(a * b) }
const REAL = { corner: '10.5 (표준편차 약 3.3, 보통 4~18)', throw: '약 40 (화면 연출)', goalkick: '약 16', fk: '약 22 (파울 수와 비슷)', offside: '약 3.7' }
const NAME = { corner: '코너킥', throw: '스로인', goalkick: '골킥', fk: '프리킥(반칙)', offside: '오프사이드' }
console.log(`■ ${l.name} ${per.corner.length}경기 · 경기당 양 팀 합 (실제 프리미어리그 대략값)`)
for (const k in per) {
  const a = per[k]
  console.log(`${NAME[k].padEnd(7)} 평균 ${mean(a).toFixed(1).padStart(5)} · 표준편차 ${sd(a).toFixed(1)} · 하위10% ${pct(a, 0.1)} · 상위10% ${pct(a, 0.9)} · 최소 ${Math.min(...a)} · 최대 ${Math.max(...a)}   (${REAL[k]})`)
}
const zero = teamRows.filter((x) => x[0] === 0).length
console.log(`한 팀 코너킥 0개인 경기 비율 ${((zero / teamRows.length) * 100).toFixed(1)}%  (실제 약 3~5%)`)
console.log(`팀 코너킥 ↔ 슈팅 상관 ${corr(teamRows.map((x) => x[0]), teamRows.map((x) => x[1])).toFixed(2)}  (실제 약 0.5)`)
console.log(`팀 코너킥 ↔ 점유율 상관 ${corr(teamRows.map((x) => x[0]), teamRows.map((x) => x[2])).toFixed(2)}  (실제 약 0.4)`)
