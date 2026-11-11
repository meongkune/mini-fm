// 경기 엔진 진단: 한 리그 전 경기를 돌려 실제 축구 통계와 비교할 수 있는 숫자를 뽑는다 (검사가 아니라 조정용 참고 자료)
// 실행: node tools/diag_engine.mjs [리그=premier-league]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FE = path.join(ROOT, 'frontend')
const M = await import(pathToFileURL(path.join(FE, 'src/engine/match.js')).href)
const { playerOvrOf } = await import(pathToFileURL(path.join(FE, 'src/engine/engine.js')).href)
const index = JSON.parse(fs.readFileSync(path.join(FE, 'public/data/index.json'), 'utf8'))
const lid = process.argv[2] || 'premier-league'
const l = index.leagues.find((x) => x.id === lid)
const d = JSON.parse(fs.readFileSync(path.join(FE, 'public/data', l.seasons[0].file), 'utf8'))
const rf = path.join(FE, 'public/data/ratings', `${lid}.json`)
const r = fs.existsSync(rf) ? JSON.parse(fs.readFileSync(rf, 'utf8')).players : {}
const teams = d.teams.map((t) => ({ ...t, players: t.players.map((p) => ({ ...p, ...(r[p.id] || {}) })) }))
const str = (t) => { const o = t.players.map(playerOvrOf).sort((a, b) => b - a).slice(0, 11); return o.reduce((a, b) => a + b, 0) / o.length }
const byPid = Object.fromEntries(teams.flatMap((t) => t.players.map((p) => [p.id, p])))

const T = { n: 0, goals: 0, hw: 0, dr: 0, aw: 0, g1h: 0, late: 0, nil: 0, big: 0, assisted: 0, how: {}, pos: {}, sh: 0, sot: 0, cor: 0, foul: 0, yc: 0, rc: 0, off: 0, inj: 0, pen: 0, xg: 0, scores: {}, margin3: 0 }
const gapBins = {} // 전력 차(홈-원정) 구간별 [경기, 홈승, 무, 원정승]
const scorer = {}
let seed = 1
for (const h of teams) for (const a of teams) {
  if (h === a) continue
  const s = M.quickMatch(h, a, {}, seed++ * 7919)
  const [x, y] = s.score
  T.n++; T.goals += x + y
  if (x > y) T.hw++; else if (x === y) T.dr++; else T.aw++
  if (x + y === 0) T.nil++
  if (x + y >= 5) T.big++
  if (Math.abs(x - y) >= 3) T.margin3++
  const k = `${Math.max(x, y)}-${Math.min(x, y)}`
  T.scores[k] = (T.scores[k] || 0) + 1
  for (const g of s.scorers) {
    if (g.minute <= 45) T.g1h++
    if (g.minute >= 76) T.late++
    if (g.assistId) T.assisted++
    T.how[g.how || 'open'] = (T.how[g.how || 'open'] || 0) + 1
    const p = byPid[g.playerId]
    if (p) { T.pos[p.pos] = (T.pos[p.pos] || 0) + 1; scorer[p.id] = (scorer[p.id] || 0) + 1 }
  }
  for (const st of s.stats) { T.sh += st.shots; T.sot += st.onTarget; T.cor += st.corners; T.foul += st.fouls; T.yc += st.yellow; T.rc += st.red; T.off += st.offsides; T.xg += st.xg }
  T.inj += s.injuries.length
  const gap = str(h) - str(a)
  const b = gap >= 5 ? '홈 +5 이상' : gap >= 2 ? '홈 +2~5' : gap > -2 ? '비슷 (±2)' : gap > -5 ? '원정 +2~5' : '원정 +5 이상'
  gapBins[b] ??= [0, 0, 0, 0]
  gapBins[b][0]++; gapBins[b][x > y ? 1 : x === y ? 2 : 3]++
}
const per = (v) => (v / T.n).toFixed(2)
const pc = (v, t = T.n) => `${((v / t) * 100).toFixed(1)}%`
console.log(`■ ${l.name} ${T.n}경기 (괄호 안은 실제 프리미어리그 대략값)`)
console.log(`골/경기 ${per(T.goals)} (2.8~3.2) · 홈승 ${pc(T.hw)} (44%) · 무 ${pc(T.dr)} (23%) · 원정승 ${pc(T.aw)} (33%)`)
console.log(`0-0 ${pc(T.nil)} (6%) · 5골 이상 ${pc(T.big)} (11%) · 3골 차 이상 ${pc(T.margin3)} (13%)`)
console.log(`전반 골 ${pc(T.g1h, T.goals)} (44%) · 76분 이후 골 ${pc(T.late, T.goals)} (23%) · 도움 있는 골 ${pc(T.assisted, T.goals)} (70%)`)
console.log(`득점 방식: ${Object.entries(T.how).map(([k, v]) => `${k} ${pc(v, T.goals)}`).join(' · ')}  (페널티 7%, 코너 11%, 프리킥 직접 2~3%)`)
console.log(`득점 포지션: ${['FW', 'MF', 'DF', 'GK'].map((k) => `${k} ${pc(T.pos[k] || 0, T.goals)}`).join(' · ')}  (FW 52%, MF 33%, DF 13%)`)
console.log(`경기당(양 팀 합): 슛 ${per(T.sh)} (26) · 유효슛 ${per(T.sot)} (9) · xG ${per(T.xg)} · 코너 ${per(T.cor)} (10.5) · 파울 ${per(T.foul)} (21) · 오프사이드 ${per(T.off)} (3.7) · 경고 ${per(T.yc)} (4.2) · 퇴장 ${per(T.rc)} (0.12) · 부상 ${per(T.inj)}`)
console.log('전력 차별 결과 (홈승/무/원정승):')
for (const b of ['홈 +5 이상', '홈 +2~5', '비슷 (±2)', '원정 +2~5', '원정 +5 이상']) if (gapBins[b]) console.log(`  ${b.padEnd(9)} ${String(gapBins[b][0]).padStart(3)}경기: ${pc(gapBins[b][1], gapBins[b][0])} / ${pc(gapBins[b][2], gapBins[b][0])} / ${pc(gapBins[b][3], gapBins[b][0])}`)
const top = Object.entries(scorer).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, g]) => `${byPid[id].name.split(' ').at(-1)} ${g}`)
console.log(`득점 순위 (38경기 환산 아님, ${teams.length * 2 - 2}경기): ${top.join(', ')}  (실제 득점왕 25~30골)`)
console.log(`많이 나온 스코어: ${Object.entries(T.scores).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${pc(v)}`).join(' · ')}  (1-0 17%, 2-1 16%, 1-1 11%, 2-0 12%)`)
