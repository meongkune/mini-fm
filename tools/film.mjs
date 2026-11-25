// 재생 장면을 연속 프레임 그림으로 뽑는다 (사람이 보는 관점에서 직접 확인하기 위한 도구)
//   node tools/film.mjs [경기=0] [시작 분=1] [프레임 수=12] [간격 초=0.6] [건너뛸 초=0] [--num]  → frontend/public/_film.html (개발 서버에서 /_film.html)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const FE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend')
const imp = (f) => import(pathToFileURL(path.join(FE, 'src', f)).href)
const M = await imp('engine/match.js')
const PB = await imp('engine/playback.js')
const { buildSlots } = await imp('engine/formation.js')
const [G, FROM, NF, STEP] = [Number(process.argv[2]) || 0, Number(process.argv[3]) || 1, Number(process.argv[4]) || 12, Number(process.argv[5]) || 0.6]
const index = JSON.parse(fs.readFileSync(path.join(FE, 'public/data/index.json'), 'utf8'))
const l = index.leagues.find((x) => x.id === 'premier-league')
const d = JSON.parse(fs.readFileSync(path.join(FE, 'public/data', l.seasons[0].file), 'utf8'))
const home = d.teams[(G * 3) % d.teams.length], away = d.teams[(G * 7 + 5) % d.teams.length]
const ctx = { teams: [home, away], status: {} }
const lineupsOf = (match) => match.sides.map((sd, i) => {
  const all = buildSlots(sd.tactics.formation); const used = new Set()
  return sd.onPitch.map((id, k) => { const j = all.findIndex((s, x) => !used.has(x) && s.role === sd.slots[k]); used.add(j); const p = ctx.teams[i].players.find((x) => x.id === id); return { ...p, sx: all[j]?.x, sy: all[j]?.y, slot: sd.slots[k] } })
})
const match = M.createMatch({ home, away, seed: 100 + G, status: {}, myIdx: 0 })
const sim = PB.makeSim()
const frames = []
const SKIP = Number(process.argv[6]) || 0 // 시작 분에서 몇 초 뒤부터
let shown = 0, clock = 0, nextShot = SKIP
const S = 2.15, W = 105, H = 68
outer: while (!M.halfOver(match, 2)) {
  M.step(match, ctx)
  const lu = lineupsOf(match), T = match.sides.map((s) => s.tactics)
  for (; shown < match.timeline.length; shown++) {
    const tick = match.timeline[shown]
    PB.startClip(sim, lu, tick, T, match.timeline[shown + 1] || null)
    let guard = 0
    while (!sim.done && guard++ < 2400) {
      PB.stepSim(sim, lu, T, 1 / 60)
      if (tick.m < FROM) continue
      clock += 1 / 60
      if (clock >= nextShot) {
        nextShot += STEP
        const nm = (id) => lu.flat().find((p) => p.id === id)?.name?.split(' ').at(-1) || ''
        frames.push({ t: clock, m: tick.m, team: match.sides[tick.t].name, label: sim.label, seg: sim.script.segs[sim.seg]?.type, carrier: sim.carrier, cname: sim.carrier ? nm(sim.carrier) : '-', ball: { ...sim.ball }, pos: lu.map((side) => side.map((p) => ({ id: p.id, n: p.number, gk: p.slot === 'GK', ...sim.pos[p.id] }))), atk: tick.t })
        if (frames.length >= NF) break outer
      }
    }
  }
}
const col = ['#e11d48', '#2563eb']
const svg = (f, prev) => {
  const X = (x) => (x * S).toFixed(1), Y = (y) => (y * S).toFixed(1)
  let o = `<svg width="${W * S}" height="${H * S}" style="background:#2e7d46"><rect x="0" y="0" width="${W * S}" height="${H * S}" fill="none" stroke="#fff"/><line x1="${X(52.5)}" y1="0" x2="${X(52.5)}" y2="${Y(H)}" stroke="#fff" stroke-width=".6"/><rect x="0" y="${Y(13.85)}" width="${X(16.5)}" height="${Y(40.3)}" fill="none" stroke="#fff" stroke-width=".6"/><rect x="${X(88.5)}" y="${Y(13.85)}" width="${X(16.5)}" height="${Y(40.3)}" fill="none" stroke="#fff" stroke-width=".6"/>`
  f.pos.forEach((side, si) => side.forEach((p, k) => {
    const q = prev?.pos[si][k]
    if (q && q.id === p.id) o += `<line x1="${X(q.x)}" y1="${Y(q.y)}" x2="${X(p.x)}" y2="${Y(p.y)}" stroke="${col[si]}" stroke-width="1" opacity=".55"/>`
    o += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.id === f.carrier ? 5 : 3.8}" fill="${p.gk ? '#111' : col[si]}" stroke="${p.id === f.carrier ? '#fde047' : '#fff'}" stroke-width="${p.id === f.carrier ? 2 : .7}"/>`
  }))
  if (prev) o += `<line x1="${X(prev.ball.x)}" y1="${Y(prev.ball.y)}" x2="${X(f.ball.x)}" y2="${Y(f.ball.y)}" stroke="#fde047" stroke-width="1.4" stroke-dasharray="3 2"/>`
  o += `<circle cx="${X(f.ball.x)}" cy="${Y(f.ball.y)}" r="2.6" fill="#fff" stroke="#000"/></svg>`
  return o
}
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111;color:#eee;font:11px system-ui"><div style="display:grid;grid-template-columns:repeat(3,${W * S}px);gap:4px 6px;padding:4px">${frames.map((f, i) => `<div><div style="height:14px;white-space:nowrap;overflow:hidden">${f.t.toFixed(1)}s ${f.m}' <b style="color:${col[f.atk]}">${f.team}</b> ${f.label} [${f.seg}] ⚽${f.cname}</div>${svg(f, frames[i - 1])}</div>`).join('')}</div><p style="padding:4px">빨강=홈(→ 공격) 파랑=원정(← 공격) · 선=직전 프레임에서 이동 · 노란 점선=공 이동</p>`
fs.writeFileSync(path.join(FE, 'public/_film.html'), html)
if (process.argv.includes('--num')) for (const f of frames) { const r = (si) => { const xs = f.pos[si].filter((p) => !p.gk).map((p) => p.x); const ys = f.pos[si].filter((p) => !p.gk).map((p) => p.y); return Math.min(...xs).toFixed(0) + '~' + Math.max(...xs).toFixed(0) + ' 폭' + (Math.max(...ys) - Math.min(...ys)).toFixed(0) }; console.log(f.t.toFixed(1).padStart(5), (f.m + "'").padStart(4), f.seg.padEnd(8), '공 x' + f.ball.x.toFixed(0).padStart(3) + ' y' + f.ball.y.toFixed(0).padStart(2), '홈', r(0).padEnd(12), '원정', r(1).padEnd(12), f.atk ? '원정 공격' : '홈 공격', f.label) }
console.log(`프레임 ${frames.length}장 → /_film.html (${home.name} vs ${away.name})`)
