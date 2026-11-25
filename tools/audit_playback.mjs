// 장면 일관성 자동 점검: 경기를 60fps로 재생하면서 "화면에서 벌어진 일"이 말이 되는지, 엔진 결과·상단 문구와 맞는지 규칙으로 검사한다
//   실행: node tools/audit_playback.mjs [경기 수=4] [--trace N]  (trace: 처음 N장면의 대본을 글로 출력)
// 이 점검기는 여기 적힌 규칙만 잡는다. 사람이 보고 어색한 장면을 찾으면 그 경우를 규칙으로 추가한다 (통과 = 축구처럼 보인다는 뜻이 아니다)
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
let circs = 0, clips = 0, shots = 0, losts = 0, passes = 0, changes = 0, traced = 0, kickoffs = 0, corners = 0, secs = 0
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
      let sc = sim.script
      clips++
      const atk = tick.t, goalX = atk === 0 ? W : 0, dir = atk === 0 ? 1 : -1
      const uOf = (pt) => (atk === 0 ? pt.x : W - pt.x) // 공격 팀 골문에서의 거리
      const tag = `${tick.m}' ${match.sides[atk].name} ev=${tick.ev || '-'} k=${tick.k}${tick.fin ? ' fin=' + tick.fin : ''}${tick.sp ? ' sp=' + tick.sp : ''}${tick.r ? ' r=' + tick.r : ''}${tick.lost ? ' lost' : ''}`
      if (traced < TR) { traced++; console.log(`\n[${tag}] 시작: ${before.carrier ? name(before.carrier) + '(' + (sideOf(before.carrier) === atk ? '우리' : '상대') + ')' : '공 주인 없음'} · 공 깊이 ${uOf(before.ball).toFixed(0)}m`); for (const sg of sc.segs) console.log(`   ${sg.t0.toFixed(1)}~${sg.t1.toFixed(1)}s ${sg.type.padEnd(7)} ${sg.who ? name(sg.who) : ''}${sg.to ? ' → ' + name(sg.to) : ''}${sg.kind ? ' (' + sg.kind + ')' : ''}${sg.pt ? ' @' + uOf(sg.pt).toFixed(0) + 'm' : ''}  「${sg.label ?? ''}」`) }
      // ── 재생 ──
      const turnover = !tick.sp && before.carrier && sideOf(before.carrier) !== atk && !before.prev?.r && before.prev?.k !== 'goal'
      if (turnover) changes++
      const u0 = uOf(sim.ball)
      let lastStart = true, maxU = u0, backMost = 0, minGoalDist = 99, shotSeen = false, ballOutSide = false, lastSeg = -1, frames = 0, prevCarrier = sim.carrier, prevHolderPos = null
      const segLog = []
      let takerU0 = null, takerBack = 0
      while (!sim.done && frames < 60 * 40) {
        PB.stepSim(sim, lu, T, 1 / 60)
        sc = sim.script
        frames++
        const sg = sc.segs[sim.seg]
        const first = sim.seg !== lastSeg
        if (first) segLog.push({ i: sim.seg, a: uOf(sim.ball) }); segLog.at(-1).b = uOf(sim.ball); segLog.at(-1).c = sim.carrier; segLog.at(-1).n = (segLog.at(-1).n || 0) + 1
        lastSeg = sim.seg
        if (!Number.isFinite(sim.ball.x) || !Number.isFinite(sim.ball.y)) { bump('값이 깨짐', tag); break }
        // 세트피스: 킥이 시작되는 순간 키커가 공 앞에 있어야 한다
        if (sc.sp && first && (sg.type === 'kick' || (sg.type === 'shot' && !sc.segs.some((x) => x.type === 'kick')))) {
          const kt = tick.kt ?? tick.p
          if (tick.sp === 'corner') corners++
          if (kt && sim.pos[kt] && Math.hypot(sim.pos[kt].x - sim.ball.x, sim.pos[kt].y - sim.ball.y) > 3) bump('키커가 공 앞에 서기 전에 세트피스가 진행됨', tag + ` (${Math.hypot(sim.pos[kt].x - sim.ball.x, sim.pos[kt].y - sim.ball.y).toFixed(0)}m 떨어짐)`)
        }
        // 킥오프: 시작하는 순간 양 팀이 자기 진영에 있어야 한다
        if (first && lastSeg > 0 && sc.segs[lastSeg - 1].type === 'kickoff') {
          kickoffs++
          let wrong = 0
          lu.forEach((side, si) => side.forEach((p) => { const q = sim.pos[p.id]; if (q && (si === 0 ? q.x > W / 2 + 3 : q.x < W / 2 - 3)) wrong++ }))
          if (wrong > 2) bump('킥오프인데 선수들이 자기 진영으로 돌아오지 않음', tag + ` (${wrong}명이 상대 진영)`)
          if (Math.hypot(sim.ball.x - W / 2, sim.ball.y - H / 2) > 3) bump('킥오프인데 공이 가운데에 없음', tag)
        }
        if (sg.type === 'circ') { lastStart = true; if (first) circs++ } // 공 돌리기: 뒤로 주는 것도 정상
        if (!sc.sp && !['restart', 'kickoff', 'recv', 'win', 'circ', 'plan'].includes(sg.type)) { // 시작 구간(상대 골킥이 날아오는 것 등)은 뺀다
          // 공이 뒤로 끌려가는가: 이 장면에서 가장 멀리 나간 곳보다 얼마나 뒤로 갔나 (뺏긴 뒤 수비가 갖고 있는 것은 제외)
          const u = uOf(sim.ball)
          if (first && lastStart) { maxU = u; lastStart = false }
          if (!(sg.lost || sg.type === 'cut')) { maxU = Math.max(maxU, u); backMost = Math.max(backMost, maxU - u) }
        }
        if (sg.type === 'shot' || (sg.type === 'after' && SHOT.has(tick.k))) { shotSeen = true; minGoalDist = Math.min(minGoalDist, Math.abs(sim.ball.x - goalX)) }
        if (!tick.sp && !tick.r && (sim.ball.y < 0.3 || sim.ball.y > H - 0.3)) ballOutSide = true
        // 태클: 공이 수비에게 넘어가는 순간 둘이 붙어 있어야 한다
        if (sg.type === 'tackle' && sim.carrier === sg.to && prevCarrier === sg.who && prevHolderPos) { const dd = Math.hypot(sim.pos[sg.to].x - prevHolderPos.x, sim.pos[sg.to].y - prevHolderPos.y); if (dd > 4) bump('수비가 붙지 않았는데 공이 넘어감', tag + ` (${dd.toFixed(0)}m)`) }
        // 뺏은 선수가 자기 골문 쪽으로 물러나는가 (공격 팀 기준 깊이가 늘어나면 뺏은 쪽이 물러난 것)
        if (sg.type === 'after' && sg.lost && sim.carrier === sg.who) { const uu = uOf(sim.ball); takerU0 ??= uu; takerBack = Math.max(takerBack, uu - takerU0) }
        prevCarrier = sim.carrier
        if (sg.who && sim.pos[sg.who]) prevHolderPos = { ...sim.pos[sg.who] }
      }
      secs += frames / 60
      // ── 대본 규칙 ──
      const types = sc.segs.map((s) => s.type)
      const labels = sc.segs.map((s) => s.label || '').join(' ')
      if (SHOT.has(tick.k) && !types.includes('shot')) bump('슛 장면인데 대본에 슛이 없음', tag)
      if (!SHOT.has(tick.k) && types.includes('shot')) bump('슛이 없는 장면인데 대본에 슛이 있음', tag)
      if (!SHOT.has(tick.k) && /1대1|슛!|골!|선방|빗나감/.test(labels)) bump('슛이 없는데 문구에 1대1·슛·결과가 나옴', tag + ' :: ' + labels)
      if (SHOT.has(tick.k) && !/골!|선방|빗나감/.test(labels)) bump('슛 장면인데 문구에 결과가 없음', tag)
      if (tick.lost && !SHOT.has(tick.k) && !tick.sp && tick.r !== 'offside' && tick.k !== 'card' && !/뺏|차단|막힙|걷어/.test(labels)) bump('뺏긴 장면인데 문구에 뺏김이 없음', tag + ' :: ' + labels)
      if (before.prev?.k === 'goal' && !types.includes('kickoff')) bump('골 다음 장면인데 킥오프가 없음', tag)
      // 공을 갖고 있던 우리 선수가 그대로 이어 가는가
      if (!tick.sp && before.carrier && sideOf(before.carrier) === atk && before.prev?.k !== 'goal' && sc.segs[0].who !== before.carrier) bump('공 가진 선수가 아닌 다른 선수가 장면을 시작함', tag)
      if (sc.staged) bump('2단계 대본이 만들어지지 않음', tag)
      for (const sg of sc.segs) if (sg.type === 'pass') {
        passes++
        const a = sg.ptFrom, b = sg.ptTo
        if (a && b) { const len = Math.hypot(a.x - b.x, a.y - b.y); if (len > 45 && sg.kind === 'ground') bump('45m 넘는 땅볼 패스', tag); if ((b.x - a.x) * dir < -20) bump('20m 넘는 백패스', tag) }
      }
      if (takerBack > 4) bump('뺏은 선수가 자기 골문 쪽으로 4m 넘게 물러남', tag + ` (${takerBack.toFixed(0)}m)`)
      if (!sim.done) bump('장면이 40초 안에 끝나지 않음', tag)
      if (backMost > 15) bump('공이 15m 넘게 뒤로 끌려감', tag + ` (${backMost.toFixed(0)}m)`)
      if (backMost > 15 && process.argv.includes('--why') && (globalThis.whyN = (globalThis.whyN || 0) + 1) <= 4) { console.log(`
[뒤로 ${backMost.toFixed(0)}m] ${tag} · 시작 깊이 ${u0.toFixed(0)}m · 앞 장면 ${before.prev ? (before.prev.ev || before.prev.sp || before.prev.k) + (before.prev.r ? '/' + before.prev.r : '') : '없음'} · 공 주인 ${before.carrier ? name(before.carrier) + (sideOf(before.carrier) === atk ? '(우리)' : '(상대)') : '없음'}`); for (const [qi, sg] of sc.segs.entries()) console.log(`   ${(segLog.find((x) => x.i === qi) ? segLog.find((x) => x.i === qi).a.toFixed(0) + '→' + segLog.find((x) => x.i === qi).b.toFixed(0) + 'm ' + (segLog.find((x) => x.i === qi).n / 60).toFixed(1) + 's 끝주인 ' + (segLog.find((x) => x.i === qi).c ? name(segLog.find((x) => x.i === qi).c) : '-') : '건너뜀').padEnd(34)} ${sg.type.padEnd(7)} ${sg.who ? name(sg.who) : ''}${sg.to ? ' → ' + name(sg.to) : ''}${sg.pt ? ' @' + uOf(sg.pt).toFixed(0) + 'm' : ''}${sg.ptTo ? ' →@' + uOf(sg.ptTo).toFixed(0) + 'm' : ''} 「${sg.label ?? ''}」`) }
      if (turnover && uOf(sim.ball) < u0 - 30 && !tick.lost) bump('공을 뺏은 뒤 30m 넘게 물러남', tag + ` (${(u0 - uOf(sim.ball)).toFixed(0)}m)`)
      if (SHOT.has(tick.k)) { shots++; if (!shotSeen || minGoalDist > 6) bump('슛 장면인데 공이 골문 근처로 가지 않음', tag + ` (골라인까지 ${minGoalDist.toFixed(0)}m)`) }
      if (tick.lost && !SHOT.has(tick.k) && !tick.sp && !tick.r && tick.k !== 'card') {
        losts++
        if (!sim.carrier || sideOf(sim.carrier) !== 1 - atk) bump('뺏긴 장면인데 끝날 때 수비가 공을 갖고 있지 않음', tag + ` (끝: ${sim.carrier ? name(sim.carrier) : '없음'})`)
      }
      if (ballOutSide) bump('재개가 없는 장면인데 공이 옆줄 밖으로 나감', tag)
    }
  }
}
console.log(`\n장면 ${clips}개 (슛 ${shots} · 뺏김 ${losts} · 패스 ${passes} · 공 돌리기 ${circs} · 뺏으며 시작 ${changes} · 킥오프 ${kickoffs} · 코너킥 ${corners}) · 대본 시간 경기당 ${(secs / N / 60).toFixed(1)}분`)
const keys = Object.keys(issues)
if (!keys.length) console.log('규칙에 걸린 장면 없음 (규칙에 적은 것만 본다)')
for (const k of keys.sort((a, b) => issues[b].n - issues[a].n)) { console.log(`✖ ${k}: ${issues[k].n}건`); for (const e of issues[k].ex) console.log('     예) ' + e) }
