// 선수 기록 재현도 검증: 시뮬레이션 선수 기록(90분당)이 실제 2025-26 기록과 얼마나 같은 순서인가 (스피어만 순위 상관)
//   세부 능력치를 붙인 엔진(on) vs 뺀 엔진(off). 실제 기록은 data_in의 FBref 2025-26 (이름 완전 일치만, 실제·시뮬 모두 900분 이상)
// 실행: node tools/validate_players.mjs [시즌 반복 수=2]  — data_in/kaggle-fbref-2025-26/players_data-2025_2026.csv가 있어야 한다
// 표본 밖 검증(2024-25까지 기록만으로 만든 능력치로 2025-26을 맞히나):
//   PAST_ONLY=1 ATTRS_OUT=<폴더> node tools/kaggle_attrs.mjs → ATTRS_DIR=<폴더> node tools/validate_players.mjs
// 2026-11 기준값(표본 밖, 2회): 골 0.704 · 도움 0.474 · 슛 0.814 · 경고 0.354 · 태클 0.527
//   참고 상한(실제 2024-25 기록으로 2025-26 예측): 골 0.686 · 도움 0.520 · 슛 0.902 · 경고 0.453 · 태클 0.745
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FE = path.join(ROOT, 'frontend')
const M = await import(pathToFileURL(path.join(FE, 'src/engine/match.js')).href)
const N = Number(process.argv[2] || 2)
const ATTRS_DIR = process.env.ATTRS_DIR || path.join(FE, 'public/data/attrs')
const LEAGUES = { 'premier-league': 'eng Premier League', 'la-liga': 'es La Liga', bundesliga: 'de Bundesliga', 'serie-a': 'it Serie A', 'ligue-1': 'fr Ligue 1' }
const norm = (s = '') => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim()
const csv = (t) => {
  const rows = []
  let r = [], c = '', q = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++ } else q = false } else c += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { r.push(c); c = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; r.push(c); rows.push(r); r = []; c = '' }
    else c += ch
  }
  const h = rows.shift()
  return rows.filter((x) => x.length > 1).map((x) => Object.fromEntries(h.map((k, i) => [k.replace(/^﻿/, ''), x[i]])))
}
const realFile = path.join(ROOT, 'data_in/kaggle-fbref-2025-26/players_data-2025_2026.csv')
if (!fs.existsSync(realFile)) throw new Error(`실제 기록 파일이 없습니다: ${realFile}`)
const real = csv(fs.readFileSync(realFile, 'utf8'))
const rd = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null)
const rank = (a) => {
  const s = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0])
  const r = Array(a.length)
  for (let i = 0; i < s.length;) { let j = i; while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++; for (let k = i; k <= j; k++) r[s[k][1]] = (i + j) / 2; i = j + 1 }
  return r
}
const pearson = (x, y) => {
  const n = x.length, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n
  let a = 0, b = 0, c = 0
  for (let i = 0; i < n; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2 }
  return a / Math.sqrt(b * c)
}
const spear = (x, y) => pearson(rank(x), rank(y))

function simulate(lid, withDet) {
  const d = rd(path.join(FE, 'public/data', lid, '2025-26.json'))
  const r = rd(path.join(FE, 'public/data/ratings', `${lid}.json`))?.players || {}
  const at = withDet ? rd(path.join(ATTRS_DIR, `${lid}.json`))?.players || {} : {}
  const teams = d.teams.map((t) => ({ ...t, players: t.players.map((p) => ({ ...p, ...(r[p.id] || {}), ...(at[p.id] ? { det: at[p.id].o, detE: at[p.id].e || 0, ...(at[p.id].r && !r[p.id]?.rad ? { rad: at[p.id].r } : {}) } : {}) })) }))
  const P = {}
  let seed = 11
  for (let s = 0; s < N; s++) for (const h of teams) for (const a of teams) {
    if (h === a) continue
    const ctx = { teams: [h, a], status: {} }
    const m = M.createMatch({ home: h, away: a, seed: seed++, status: {} })
    M.advance(m, ctx, 90, { withEvents: false })
    for (const t of [h, a]) for (const p of t.players) {
      const ps = m.ps[p.id]
      if (!ps) continue
      const x = (P[p.id] ??= { name: p.name, g: 0, a: 0, sh: 0, yc: 0, tk: 0, min: 0 })
      x.g += ps.g; x.a += ps.a; x.sh += ps.sh; x.yc += ps.yc; x.tk += ps.tk; x.min += (ps.to ?? 90) - ps.from
    }
  }
  return P
}

const KEYS = [['골', 'g', 'Gls'], ['도움', 'a', 'Ast'], ['슛', 'sh', 'Sh'], ['경고', 'yc', 'CrdY'], ['태클', 'tk', 'TklW']]
const out = {}
for (const mode of ['off', 'on']) {
  const pairs = Object.fromEntries(KEYS.map(([l]) => [l, [[], []]]))
  for (const [lid, comp] of Object.entries(LEAGUES)) {
    const P = simulate(lid, mode === 'on')
    const byName = {}
    for (const rr of real.filter((x) => x.Comp === comp)) (byName[norm(rr.Player)] ??= []).push(rr)
    for (const x of Object.values(P)) {
      const rr = byName[norm(x.name)]
      if (!rr || rr.length !== 1) continue
      const R = rr[0], rmin = +R.Min || 0
      if (rmin < 900 || x.min / N < 900) continue
      for (const [l, k, rk] of KEYS) { pairs[l][0].push((x[k] / x.min) * 90); pairs[l][1].push((+(R[rk] || 0) / rmin) * 90) }
    }
  }
  out[mode] = Object.fromEntries(KEYS.map(([l]) => [l, { rho: spear(...pairs[l]), n: pairs[l][0].length }]))
}
console.log(`실제 2025-26 기록과의 순위 상관 (빅5, 시즌 ${N}회, 900분 이상, 세부 능력치: ${ATTRS_DIR})`)
for (const [l] of KEYS) console.log(`${l.padEnd(3)}  세부 능력치 없음 ${out.off[l].rho.toFixed(3)}  →  있음 ${out.on[l].rho.toFixed(3)}   (n=${out.on[l].n})`)
