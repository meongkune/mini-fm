// 실시간 경기 시뮬레이션(engine/live.js) 시험: 여러 경기를 돌려 수치를 보고, 한 경기의 일부를 프레임 그림으로 뽑는다
//   node tools/live_proto.mjs [경기 수=20]                      → 경기당 골·슛·점유율 등
//   node tools/live_proto.mjs film [경기=0] [시작 초=0] [프레임 수=18] [간격 초=0.6]  → frontend/public/_film.html
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const FE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend')
const imp = (f) => import(pathToFileURL(path.join(FE, 'src', f)).href)
const LV = await imp('engine/live.js')
const { buildSlots } = await imp('engine/formation.js')
const index = JSON.parse(fs.readFileSync(path.join(FE, 'public/data/index.json'), 'utf8'))
const l = index.leagues.find((x) => x.id === 'premier-league')
const d = JSON.parse(fs.readFileSync(path.join(FE, 'public/data', l.seasons[0].file), 'utf8'))
const rngOf = (seed) => { let a = seed | 0; return { random: () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } } }
const xiOf = (team, formation = '4-3-3') => {
  const slots = buildSlots(formation)
  const pool = [...team.players].sort((a, b) => Math.max(b.att, b.def) - Math.max(a.att, a.def))
  const used = new Set()
  const want = { GK: 'GK', LB: 'DF', CB: 'DF', RB: 'DF', LWB: 'DF', RWB: 'DF', DM: 'MF', CM: 'MF', AM: 'MF', LM: 'MF', RM: 'MF', LW: 'FW', RW: 'FW', ST: 'FW' }
  return slots.map((s) => { const p = pool.find((x) => !used.has(x.id) && x.pos === want[s.role]) || pool.find((x) => !used.has(x.id)); used.add(p.id); return { ...p, sx: s.x, sy: s.y, slot: s.role } })
}
const PHILS = ['possession', 'balanced', 'counter', 'direct']
const mk = (g) => {
  const home = d.teams[(g * 3) % d.teams.length]
  // SYM=1: 같은 팀끼리 붙여 좌우 편향을 본다
  const away = process.env.SYM ? { ...home, players: home.players.map((p) => ({ ...p, id: p.id + '_b' })) } : d.teams[(g * 7 + 5) % d.teams.length]
  const lineups = process.env.SYM ? [xiOf(home), xiOf(away)] : [xiOf(home, g % 2 ? '4-4-2' : '4-3-3'), xiOf(away, g % 3 ? '4-2-3-1' : '4-4-2')]
  const tactics = process.env.SYM ? [{ formation: '4-3-3', phil: 'balanced' }, { formation: '4-3-3', phil: 'balanced' }] : [{ formation: g % 2 ? '4-4-2' : '4-3-3', phil: PHILS[g % 4] }, { formation: g % 3 ? '4-2-3-1' : '4-4-2', phil: PHILS[(g + 2) % 4] }]
  return { home, away, L: LV.createLive({ lineups, tactics, rng: rngOf(1000 + g) }) }
}

if (process.argv[2] === 'film') {
  const [G, FROM, NF, STEP] = [Number(process.argv[3]) || 0, Number(process.argv[4]) || 0, Number(process.argv[5]) || 18, Number(process.argv[6]) || 0.6]
  const { home, away, L } = mk(G)
  const frames = []
  let next = FROM
  let lastEv = ''
  LV.runLive(L, (S) => {
    const e = S.events.at(-1)
    if (e && e.t > S.t - 0.11) lastEv = `${e.type}${e.res ? ':' + e.res : ''}${e.kind ? ':' + e.kind : ''}`
    if (frames.length < NF && S.t >= next) {
      next += STEP
      const o = S.ball.owner ? S.byId[S.ball.owner] : null
      frames.push({ t: S.t, clock: S.clock, min: Math.floor((S.clock / LV.LIVE.playSeconds) * 90) + 1, score: [...S.score], ev: lastEv, dead: S.dead?.type || '', owner: o ? `${o.name.split(' ').at(-1)}` : '-', os: o?.side, ball: { x: S.ball.x, y: S.ball.y, z: S.ball.z }, pos: S.players.map((p) => ({ id: p.id, side: p.side, gk: p.gk, x: p.x, y: p.y, own: p.id === S.ball.owner })) })
      lastEv = ''
    }
  })
  const S = 2.15, W = 105, H = 68, col = ['#e11d48', '#2563eb']
  const svg = (f, prev) => {
    const X = (x) => (x * S).toFixed(1), Y = (y) => (y * S).toFixed(1)
    let o = `<svg width="${W * S}" height="${H * S}" style="background:#2e7d46"><rect width="${W * S}" height="${H * S}" fill="none" stroke="#fff"/><line x1="${X(52.5)}" y1="0" x2="${X(52.5)}" y2="${Y(H)}" stroke="#fff" stroke-width=".6"/><rect x="0" y="${Y(13.85)}" width="${X(16.5)}" height="${Y(40.3)}" fill="none" stroke="#fff" stroke-width=".6"/><rect x="${X(88.5)}" y="${Y(13.85)}" width="${X(16.5)}" height="${Y(40.3)}" fill="none" stroke="#fff" stroke-width=".6"/>`
    f.pos.forEach((p, k) => {
      const q = prev?.pos[k]
      if (q) o += `<line x1="${X(q.x)}" y1="${Y(q.y)}" x2="${X(p.x)}" y2="${Y(p.y)}" stroke="${col[p.side]}" stroke-width="1" opacity=".55"/>`
      o += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.own ? 5 : 3.8}" fill="${p.gk ? '#111' : col[p.side]}" stroke="${p.own ? '#fde047' : '#fff'}" stroke-width="${p.own ? 2 : .7}"/>`
    })
    if (prev) o += `<line x1="${X(prev.ball.x)}" y1="${Y(prev.ball.y)}" x2="${X(f.ball.x)}" y2="${Y(f.ball.y)}" stroke="#fde047" stroke-width="1.4" stroke-dasharray="3 2"/>`
    o += `<circle cx="${X(f.ball.x)}" cy="${Y(f.ball.y)}" r="${2.6 + f.ball.z * 0.5}" fill="#fff" stroke="#000"/></svg>`
    return o
  }
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111;color:#eee;font:11px system-ui"><div style="display:grid;grid-template-columns:repeat(3,${W * S}px);gap:4px 6px;padding:4px">${frames.map((f, i) => `<div><div style="height:14px;white-space:nowrap;overflow:hidden">${f.t.toFixed(1)}s ${f.min}' ${f.score.join('-')} ⚽<b style="color:${col[f.os] || '#eee'}">${f.owner}</b> ${f.dead ? '[' + f.dead + ']' : ''} ${f.ev}</div>${svg(f, frames[i - 1])}</div>`).join('')}</div><p style="padding:4px">${home.name}(빨강 →) vs ${away.name}(파랑 ←)</p>`
  fs.writeFileSync(path.join(FE, 'public/_film.html'), html)
  for (const f of frames) console.log(f.t.toFixed(1).padStart(6), (f.min + "'").padStart(4), f.score.join('-'), '공', f.ball.x.toFixed(0).padStart(3), f.ball.y.toFixed(0).padStart(2), 'z' + f.ball.z.toFixed(1), (f.owner + (f.os != null ? '(' + '홈원'[f.os] + ')' : '')).padEnd(16), f.dead.padEnd(8), f.ev)
} else {
  const N = Number(process.argv[2]) || 20
  const T = { g: 0, sh: 0, on: 0, pass: 0, ok: 0, foul: 0, cor: 0, off: 0, tk: 0, xg: 0, hw: 0, dr: 0, aw: 0, big: 0, pens: 0, throws: 0, gk: 0, poss: [], secs: 0 }
  const byPos = { FW: 0, MF: 0, DF: 0, GK: 0 }
  const t0 = Date.now()
  for (let g = 0; g < N; g++) {
    const { L } = mk(g)
    LV.runLive(L)
    const [a, b] = L.stats
    T.g += a.goals + b.goals; T.sh += a.shots + b.shots; T.on += a.on + b.on; T.pass += a.passes + b.passes; T.ok += a.passOk + b.passOk
    T.foul += a.fouls + b.fouls; T.cor += a.corners + b.corners; T.off += a.offsides + b.offsides; T.tk += a.tackles + b.tackles; T.xg += a.xg + b.xg
    T.poss.push(a.possT / Math.max(1, a.possT + b.possT)); T.secs += L.t
    if (L.score[0] > L.score[1]) T.hw++; else if (L.score[0] === L.score[1]) T.dr++; else T.aw++
    if (Math.abs(L.score[0] - L.score[1]) >= 3) T.big++
    for (const e of L.events) { if (e.type === 'goal') byPos[L.byId[e.p].pos]++; if (e.type === 'restart' && e.kind === 'pen') T.pens++; if (e.type === 'restart' && e.kind === 'throw') T.throws++; if (e.type === 'restart' && e.kind === 'goalkick') T.gk++ }
  }
  const f = (v, k = 2) => (v / N).toFixed(k)
  const gs = byPos.FW + byPos.MF + byPos.DF + byPos.GK || 1
  console.log(`경기 ${N} · ${((Date.now() - t0) / N).toFixed(0)}ms/경기 · 화면 시간 ${(T.secs / N / 60).toFixed(1)}분/경기 (플레이 ${LV.LIVE.playSeconds / 60}분)`)
  console.log(`골 ${f(T.g)} (목표 2.7~3.0) · 슛 ${f(T.sh, 1)} (25~27) · 유효 ${f(T.on, 1)} (8.5~9.5) · xG ${f(T.xg)}`)
  console.log(`홈승 ${((T.hw / N) * 100).toFixed(0)}% · 무 ${((T.dr / N) * 100).toFixed(0)}% (21~26) · 원정승 ${((T.aw / N) * 100).toFixed(0)}% · 3골 차+ ${((T.big / N) * 100).toFixed(0)}% (10~15)`)
  console.log(`득점 FW ${((byPos.FW / gs) * 100).toFixed(0)}% (50~58) · MF ${((byPos.MF / gs) * 100).toFixed(0)}% (30~36) · DF ${((byPos.DF / gs) * 100).toFixed(0)}% (10~14)`)
  console.log(`패스 ${f(T.pass, 0)} · 성공률 ${((T.ok / Math.max(1, T.pass)) * 100).toFixed(0)}% · 태클 ${f(T.tk, 1)} · 파울 ${f(T.foul, 1)} (21) · 코너 ${f(T.cor, 1)} (10.5) · 오프사이드 ${f(T.off, 1)} (3.7) · 페널티 ${f(T.pens)} · 스로인 ${f(T.throws, 1)} · 골킥 ${f(T.gk, 1)}`)
  console.log(`홈 점유율 평균 ${((T.poss.reduce((a, c) => a + c, 0) / N) * 100).toFixed(0)}% (최소 ${(Math.min(...T.poss) * 100).toFixed(0)} ~ 최대 ${(Math.max(...T.poss) * 100).toFixed(0)})`)
}
