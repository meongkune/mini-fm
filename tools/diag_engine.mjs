// 경기 엔진 진단: 한 리그 전 경기를 돌려 실제 축구 통계와 비교할 수 있는 숫자를 뽑는다 (검사가 아니라 조정용 참고 자료)
// 실행: node tools/diag_engine.mjs [리그=premier-league] [반복=1]
//   반복을 주면 seed를 바꿔 시즌을 여러 번 돌려 평균을 낸다 — 한 번(306~380경기)만 돌리면 승률·무승부가 ±5%p씩 흔들려서
//   "분데스리가만 홈 승률이 낮다" 같은 착시가 생긴다. 계수를 조정할 때는 3~4번 평균으로 볼 것 (± 뒤 숫자 = 시즌별 표준편차)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FE = path.join(ROOT, 'frontend')
const M = await import(pathToFileURL(path.join(FE, 'src/engine/match.js')).href)
const { playerOvrOf } = await import(pathToFileURL(path.join(FE, 'src/engine/engine.js')).href)
const index = JSON.parse(fs.readFileSync(path.join(FE, 'public/data/index.json'), 'utf8'))
const lid = process.argv[2] || 'premier-league'
const R = Math.max(1, Number(process.argv[3]) || 1)
const l = index.leagues.find((x) => x.id === lid)
const d = JSON.parse(fs.readFileSync(path.join(FE, 'public/data', l.seasons[0].file), 'utf8'))
const rf = path.join(FE, 'public/data/ratings', `${lid}.json`)
const r = fs.existsSync(rf) ? JSON.parse(fs.readFileSync(rf, 'utf8')).players : {}
const teams = d.teams.map((t) => ({ ...t, players: t.players.map((p) => ({ ...p, ...(r[p.id] || {}) })) }))
const str = (t) => { const o = t.players.map(playerOvrOf).sort((a, b) => b - a).slice(0, 11); return o.reduce((a, b) => a + b, 0) / o.length }
const byPid = Object.fromEntries(teams.flatMap((t) => t.players.map((p) => [p.id, p])))
const games = teams.length * 2 - 2

const T = { n: 0, goals: 0, hw: 0, dr: 0, aw: 0, g1h: 0, late: 0, nil: 0, big: 0, assisted: 0, how: {}, pos: {}, lane: {}, sh: 0, sot: 0, cor: 0, foul: 0, yc: 0, rc: 0, off: 0, inj: 0, pen: 0, xg: 0, scores: {}, margin3: 0 }
const gapBins = {} // 전력 차(홈-원정) 구간별 [경기, 홈승, 무, 원정승]
const seasons = [] // 시즌(반복)별 요약 — 흔들림 폭을 보려고
let firstTop = null
let seed = 1
for (let rep = 0; rep < R; rep++) {
  const S = { n: 0, hw: 0, dr: 0, m3: 0, goals: 0 }
  const scorer = {}
  for (const h of teams) for (const a of teams) {
    if (h === a) continue
    // 첫 반복은 예전과 같은 seed (기록해 둔 숫자와 비교할 수 있게)
    const s = M.quickMatch(h, a, {}, rep === 0 ? seed++ * 7919 : (seed++ * 7919 + rep * 104729) % 1e9 + 1)
    const [x, y] = s.score
    T.n++; T.goals += x + y; S.n++; S.goals += x + y
    if (x > y) { T.hw++; S.hw++ } else if (x === y) { T.dr++; S.dr++ } else T.aw++
    if (x + y === 0) T.nil++
    if (x + y >= 5) T.big++
    if (Math.abs(x - y) >= 3) { T.margin3++; S.m3++ }
    const k = `${Math.max(x, y)}-${Math.min(x, y)}`
    T.scores[k] = (T.scores[k] || 0) + 1
    for (const g of s.scorers) {
      if (g.minute <= 45) T.g1h++
      if (g.minute >= 76) T.late++
      if (g.assistId) T.assisted++
      T.how[g.how || 'open'] = (T.how[g.how || 'open'] || 0) + 1
      if (g.lane) T.lane[g.lane] = (T.lane[g.lane] || 0) + 1
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
  const ranked = Object.entries(scorer).sort((a, b) => b[1] - a[1])
  // 그 시즌 득점왕 골 수(38경기 환산) · 그 선수가 팀 득점에서 차지한 비중은 아래 목록에서 본다
  seasons.push({ hw: S.hw / S.n, dr: S.dr / S.n, m3: S.m3 / S.n, gpg: S.goals / S.n, top: (ranked[0]?.[1] || 0) * 38 / games, topName: ranked[0] ? byPid[ranked[0][0]].name.split(' ').at(-1) : '-' })
  if (rep === 0) firstTop = ranked.slice(0, 8).map(([id, g]) => `${byPid[id].name.split(' ').at(-1)} ${g}`)
}
const per = (v) => (v / T.n).toFixed(2)
const pc = (v, t = T.n) => `${((v / t) * 100).toFixed(1)}%`
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
const sd = (a) => (a.length > 1 ? Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2))) : 0)
// 여러 번 돌렸으면 시즌별 표준편차를 붙인다
const pm = (key, k = 100, f = 1) => (R > 1 ? ` ±${(sd(seasons.map((s) => s[key])) * k).toFixed(f)}` : '')
// 5골 이상 경기: 득점이 포아송 분포라면 평균 골 수만으로 정해지는 기준값 (실제 리그도 이 값 근처다)
const lam = T.goals / T.n
let p4 = 0
for (let k = 0, term = Math.exp(-lam); k <= 4; k++) { p4 += term; term *= lam / (k + 1) }
console.log(`■ ${l.name} ${T.n}경기${R > 1 ? ` (${R}시즌 평균)` : ''} (괄호 안은 실제 프리미어리그 대략값)`)
console.log(`골/경기 ${per(T.goals)}${pm('gpg', 1, 2)} (2.8~3.2) · 홈승 ${pc(T.hw)}${pm('hw')} (44%) · 무 ${pc(T.dr)}${pm('dr')} (23%) · 원정승 ${pc(T.aw)} (33%)`)
console.log(`0-0 ${pc(T.nil)} (6%) · 5골 이상 ${pc(T.big)} (이 평균 골 수의 포아송 기준 ${((1 - p4) * 100).toFixed(1)}%) · 3골 차 이상 ${pc(T.margin3)}${pm('m3')} (13%)`)
console.log(`전반 골 ${pc(T.g1h, T.goals)} (44%) · 76분 이후 골 ${pc(T.late, T.goals)} (23%) · 도움 있는 골 ${pc(T.assisted, T.goals)} (70%)`)
console.log(`득점 방식: ${Object.entries(T.how).map(([k, v]) => `${k} ${pc(v, T.goals)}`).join(' · ')}  (페널티 7%, 코너 11%, 프리킥 직접 2~3%)`)
if (Object.keys(T.lane).length) console.log(`오픈 플레이 골의 통로: ${['left', 'right', 'center', 'air'].map((k) => `${{ left: '왼쪽', right: '오른쪽', center: '중앙', air: '공중볼' }[k]} ${pc(T.lane[k] || 0, Object.values(T.lane).reduce((a, b) => a + b, 0))}`).join(' · ')}`)
console.log(`득점 포지션: ${['FW', 'MF', 'DF', 'GK'].map((k) => `${k} ${pc(T.pos[k] || 0, T.goals)}`).join(' · ')}  (FW 52%, MF 33%, DF 13%)`)
console.log(`경기당(양 팀 합): 슛 ${per(T.sh)} (26) · 유효슛 ${per(T.sot)} (9) · xG ${per(T.xg)} · 코너 ${per(T.cor)} (10.5) · 파울 ${per(T.foul)} (21) · 오프사이드 ${per(T.off)} (3.7) · 경고 ${per(T.yc)} (4.2) · 퇴장 ${per(T.rc)} (0.12) · 부상 ${per(T.inj)}`)
console.log('전력 차별 결과 (홈승/무/원정승):')
for (const b of ['홈 +5 이상', '홈 +2~5', '비슷 (±2)', '원정 +2~5', '원정 +5 이상']) if (gapBins[b]) console.log(`  ${b.padEnd(9)} ${String(gapBins[b][0]).padStart(3)}경기: ${pc(gapBins[b][1], gapBins[b][0])} / ${pc(gapBins[b][2], gapBins[b][0])} / ${pc(gapBins[b][3], gapBins[b][0])}`)
console.log(`득점 순위 (38경기 환산 아님, ${games}경기${R > 1 ? ', 첫 시즌' : ''}): ${firstTop.join(', ')}  (실제 득점왕 25~30골)`)
if (R > 1) console.log(`시즌별 득점왕 (38경기 환산): ${seasons.map((s) => `${s.topName} ${s.top.toFixed(0)}`).join(' · ')} → 평균 ${mean(seasons.map((s) => s.top)).toFixed(1)}골`)
console.log(`많이 나온 스코어: ${Object.entries(T.scores).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${pc(v)}`).join(' · ')}  (1-0 17%, 2-1 16%, 1-1 11%, 2-0 12%)`)
