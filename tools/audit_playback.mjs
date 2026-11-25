// 장면 일관성 자동 점검: 경기를 60fps로 재생하면서 "화면에서 벌어진 일"이 엔진 결과·상단 문구와 맞는지 규칙으로 검사한다
//   실행: node tools/audit_playback.mjs [경기 수=4] [--trace N]  (trace: 처음 N장면의 대본을 글로 출력)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const FE = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'frontend')
const imp = (f) => import(pathToFileURL(path.join(FE, 'src', f)).href)
const M = await imp('engine/match.js')
const PB = await imp('engine/playback.js')
const { buildSlots } = await imp('engine/formation.js')
const N = Number(process.argv[2]) || 4
const TR = process.argv.includes('--trace') ? Number(process.argv[process.argv.indexOf('--trace') + 1]) || 12 : 0
const index = JSON.parse(fs.readFileSync(path.join(FE, 'public/data/index.json'), 'utf8'))
const l = index.leagues.find((x) => x.id === 'premier-league')
const d = JSON.parse(fs.readFileSync(path.join(FE, 'public/data', l.seasons[0].file), 'utf8'))
const W = 105, H = 68
const SHOT = new Set(['goal', 'save', 'miss'])
const issues = {}
const bump = (k, ex) => { (issues[k] ??= { n: 0, ex: [] }).n++; if (issues[k].ex.length < 3) issues[k].ex.push(ex) }
let clips = 0, shots = 0, losts = 0, passes = 0, longPass = 0, backPass = 0, startFly = 0, changes = 0, traced = 0
for (let g = 0; g < N; g++) {
  const home = d.teams[(g * 3) % d.teams.length], away = d.teams[(g * 7 + 5) % d.teams.length]
  if (home === away) continue
  const ctx = { teams: [home, away], status: {} }
  const lineupsOf = (match) => match.sides.map((sd, i) => {
    const all = buildSlots(sd.tactics.formation); const used = new Set()
    return sd.onPitch.map((id, k) => { const j = all.findIndex((s, x) => !used.has(x) && s.role === sd.slots[k]); used.add(j); const p = ctx.teams[i].players.find((x) => x.id === id); return { ...p, sx: all[j]?.x, sy: all[j]?.y, slot: sd.slots[k] } })
  })
  const match = M.createMatch({ home, away, seed: 100 + g, status: {}, myIdx: 0 })
  const sim = PB.makeSim()
  let shown = 0
  while (!M.halfOver(match, 2)) {
    M.step(match, ctx)
    const lu = lineupsOf(match)
    const T = match.sides.map((s) => s.tactics)
    const name = (id) => lu.flat().find((p) => p.id === id)?.name?.split(' ').at(-1) || '?'
    const sideOf = (id) => (lu[0].some((p) => p.id === id) ? 0 : lu[1].some((p) => p.id === id) ? 1 : null)
    for (; shown < match.timeline.length; shown++) {
      const tick = match.timeline[shown]
      const before = { carrier: sim.carrier, ball: { ...sim.ball }, prev: sim.tick }
      PB.startClip(sim, lu, tick, T)
      const sc = sim.script
      clips++
      const atk = tick.t, goalX = atk === 0 ? W : 0, dir = atk === 0 ? 1 : -1
      const tag = `${tick.m}' ${match.sides[atk].name} ev=${tick.ev || '-'} k=${tick.k}${tick.fin ? ' fin=' + tick.fin : ''}${tick.sp ? ' sp=' + tick.sp : ''}${tick.r ? ' r=' + tick.r : ''}${tick.lost ? ' lost' : ''}`
      if (traced < TR) { traced++; console.log(`\n[${tag}] 시작: ${before.carrier ? name(before.carrier) + '(' + (sideOf(before.carrier) === atk ? '우리' : '상대') + ')' : '공 주인 없음'}`); for (const sg of sc.segs) console.log(`   ${sg.t0.toFixed(1)}~${sg.t1.toFixed(1)}s ${sg.type.padEnd(7)} ${sg.who ? name(sg.who) : ''}${sg.to ? ' → ' + name(sg.to) : ''}${sg.kind ? ' (' + sg.kind + ')' : ''}  「${sg.label ?? ''}」`) }
      // 1) 대본 규칙
      const types = sc.segs.map((s) => s.type)
      if (SHOT.has(tick.k) && !types.includes('shot')) bump('슛 장면인데 대본에 슛이 없음', tag)
      if (!SHOT.has(tick.k) && types.includes('shot')) bump('슛이 없는 장면인데 대본에 슛이 있음', tag)
      const labels = sc.segs.map((s) => s.label || '').join(' ')
      if (!SHOT.has(tick.k) && /1대1|슛!|골!|선방|빗나감/.test(labels)) bump('슛이 없는데 문구에 1대1·슛·결과가 나옴', tag + ' :: ' + labels)
      if (SHOT.has(tick.k) && !/골!|선방|빗나감/.test(labels)) bump('슛 장면인데 문구에 결과가 없음', tag)
      if (tick.lost && !SHOT.has(tick.k) && !tick.sp && tick.r !== 'offside' && !/뺏|차단|막힙|걷어/.test(labels)) bump('뺏긴 장면인데 문구에 뺏김이 없음', tag + ' :: ' + labels)
      for (const sg of sc.segs) if (sg.type === 'pass') {
        passes++
        const a = sg.ptFrom || sim.pos[sg.who], b = sg.ptTo
        if (a && b) { const len = Math.hypot(a.x - b.x, a.y - b.y); if (len > 45 && sg.kind === 'ground') { longPass++; bump('45m 넘는 땅볼 패스', tag) } if ((b.x - a.x) * dir < -20) { backPass++; bump('20m 넘는 백패스', tag) } }
      }
      // 2) 재생
      const startBall = { ...sim.ball }
      let maxStartFly = 0, endCarrier = null, minGoalDist = 99, shotSeen = false, ballOutSide = false
      const n = Math.ceil(sc.dur * 60)
      for (let f = 0; f < n; f++) {
        PB.stepSim(sim, lu, T, 1 / 60)
        const sg = sc.segs[sim.seg]
        if (sg.type === 'recv' || sg.type === 'win') maxStartFly = Math.max(maxStartFly, Math.hypot(sim.ball.x - startBall.x, sim.ball.y - startBall.y))
        if (sg.type === 'shot' || (sg.type === 'after' && SHOT.has(tick.k))) { shotSeen = true; minGoalDist = Math.min(minGoalDist, Math.abs(sim.ball.x - goalX)) }
        if (!tick.sp && !tick.r && (sim.ball.y < 0.3 || sim.ball.y > H - 0.3)) ballOutSide = true
        if (!Number.isFinite(sim.ball.x)) bump('값이 깨짐', tag)
      }
      endCarrier = sim.carrier
      // 시작: 공이 처음에 멀리 날아갔나 (재개·세트피스 직후가 아닌데 30m 이상)
      if (!tick.sp && maxStartFly > 30 && !before.prev?.r && !before.prev?.sp && before.prev?.k !== 'goal') { startFly++; bump('장면 시작에 공이 30m 넘게 날아감', tag + ` (${maxStartFly.toFixed(0)}m)`) }
      if (before.carrier && sideOf(before.carrier) !== atk) changes++
      if (SHOT.has(tick.k)) { shots++; if (!shotSeen || minGoalDist > 6) bump('슛 장면인데 공이 골문 근처로 가지 않음', tag + ` (골라인까지 ${minGoalDist.toFixed(0)}m)`) }
      if (tick.lost && !SHOT.has(tick.k) && !tick.sp && !tick.r) {
        losts++
        if (!endCarrier || sideOf(endCarrier) !== 1 - atk) bump('뺏긴 장면인데 끝날 때 수비가 공을 갖고 있지 않음', tag + ` (끝: ${endCarrier ? name(endCarrier) : '없음'})`)
      }
      if (ballOutSide) bump('재개가 없는 장면인데 공이 옆줄 밖으로 나감', tag)
    }
  }
}
console.log(`\n장면 ${clips}개 (슛 ${shots} · 뺏김 ${losts} · 패스 ${passes} · 공 주인이 바뀌며 시작 ${changes})`)
const keys = Object.keys(issues)
if (!keys.length) console.log('문제 없음')
for (const k of keys.sort((a, b) => issues[b].n - issues[a].n)) { console.log(`✖ ${k}: ${issues[k].n}건`); for (const e of issues[k].ex) console.log('     예) ' + e) }
