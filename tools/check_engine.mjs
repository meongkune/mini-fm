// 경기 엔진 검사 (CI): 프리미어리그·분데스리가 전 경기를 돌려 득점·승률·세트피스 비율이 현실 범위인지,
// 배속·건너뛰기·빠른 계산이 같은 결과를 내는지 확인한다. 하나라도 벗어나면 종료 코드 1
// 실행: node tools/check_engine.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FE = path.join(ROOT, 'frontend')
const M = await import(pathToFileURL(path.join(FE, 'src/engine/match.js')).href)
const index = JSON.parse(fs.readFileSync(path.join(FE, 'public/data/index.json'), 'utf8'))
const load = (lid) => {
  const l = index.leagues.find((x) => x.id === lid)
  const d = JSON.parse(fs.readFileSync(path.join(FE, 'public/data', l.seasons[0].file), 'utf8'))
  const rf = path.join(FE, 'public/data/ratings', `${lid}.json`)
  const r = fs.existsSync(rf) ? JSON.parse(fs.readFileSync(rf, 'utf8')).players : {}
  return d.teams.map((t) => ({ ...t, players: t.players.map((p) => ({ ...p, ...(r[p.id] || {}) })) }))
}

const T = { n: 0, goals: 0, hw: 0, d: 0, sp: 0, poss70: 0 }
let seed = 1
for (const lid of ['premier-league', 'bundesliga']) {
  const teams = load(lid)
  for (const h of teams) for (const a of teams) {
    if (h === a) continue
    const m = M.createMatch({ home: h, away: a, seed: seed++ * 7919, status: {} })
    M.advance(m, { teams: [h, a], status: {} }, 90, { withEvents: false })
    const [x, y] = m.score
    T.n++; T.goals += x + y
    if (x > y) T.hw++; else if (x === y) T.d++
    T.sp += m.scorers.filter((s) => ['corner', 'fk', 'fkx', 'pen'].includes(s.how)).length
    const p0 = m.stats[0].poss / (m.stats[0].poss + m.stats[1].poss)
    if (Math.max(p0, 1 - p0) > 0.7) T.poss70++
  }
}
// 같은 seed면 1분씩 재생 · 전반/후반 건너뛰기 · 빠른 계산이 모두 같은 결과여야 한다
const pl = load('premier-league')
let diff = 0
for (let k = 0; k < 40; k++) {
  const h = pl[k % 20]
  const a = pl[(k * 7 + 3) % 20]
  if (h === a) continue
  const ctx = { teams: [h, a], status: {} }
  const run = (mode) => {
    const m = M.createMatch({ home: h, away: a, seed: 1000 + k, status: {} })
    if (mode === 'step') { while (!M.halfOver(m, 2)) M.step(m, ctx) } else if (mode === 'skip') { M.advance(m, ctx, 45); M.advance(m, ctx, 90) } else M.advance(m, ctx, 90, { withEvents: false })
    return JSON.stringify([m.score, m.scorers.map((s) => [s.playerId, s.minute, s.plus])])
  }
  const r = [run('step'), run('skip'), run('quick')]
  if (r[0] !== r[1] || r[1] !== r[2]) diff++
}

const pct = (v) => (v / T.n) * 100
const checks = [
  ['경기당 골', T.goals / T.n, 2.3, 3.3, (v) => v.toFixed(2)],
  ['홈 승률', pct(T.hw), 36, 52, (v) => `${v.toFixed(1)}%`],
  ['무승부', pct(T.d), 16, 31, (v) => `${v.toFixed(1)}%`],
  ['세트피스 골 비율', (T.sp / T.goals) * 100, 15, 38, (v) => `${v.toFixed(1)}%`],
  ['점유율 70% 넘는 경기', pct(T.poss70), 0, 20, (v) => `${v.toFixed(1)}%`],
  ['배속·건너뛰기 결과 불일치', diff, 0, 0, (v) => `${v}경기`],
]
let bad = 0
console.log(`프리미어리그·분데스리가 ${T.n}경기 시뮬레이션`)
for (const [name, v, lo, hi, fmt] of checks) {
  const ok = v >= lo && v <= hi
  if (!ok) bad++
  console.log(`${ok ? '✔' : '✖'} ${name} ${fmt(v)} (정상 ${lo}~${hi})`)
}
if (bad) { console.log(`\n엔진 검사 실패 ${bad}건 — 배포를 멈춥니다`); process.exit(1) }
console.log('\n엔진 검사 통과')
