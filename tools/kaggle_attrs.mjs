// Kaggle 공개 데이터셋(실제 경기 기록)으로 선수 세부 능력치(3층)를 계산한다 — 빅5 리그 시험판
//   입력(저장소에 올리지 않음, data_in/ — .gitignore):
//     kaggle-fbref-2025-26/players_data-2025_2026.csv           FBref 2025-26 (MIT 표기) — 득점·슈팅·크로스·인터셉트·태클 성공·파울·골키퍼
//     kaggle-fbref-2017-2025/Top5_League_Players_2017to2024_dataset.csv  FBref 2017-18~2024-25 (CC0) — 패스·드리블·공중볼·찬스 창출·xG
//     kaggle-sofascore-2025-26/all_player_*.csv                 SofaScore 2025-26 (비상업 표기) — 이번 시즌 xG·xA·태클
//   출력: frontend/public/data/attrs/{리그}.json — 원본 숫자는 남기지 않고, 계산한 게임용 값(30~99)과 추정 여부만
//   방식: 같은 역할군(GK·CB·풀백·중앙 MF·2선·ST) 안 백분위 → 그 선수의 레이더(2층) 값을 중심으로 ±기울이기.
//         표본(출전 시간·슛 수 등)이 적을수록 레이더 쪽으로 끌어당긴다. 기록이 없으면 레이더로 추정(e 비트).
// 실행: node tools/kaggle_attrs.mjs [--report]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { attrsOf, detailBase, DETAIL, DETAIL_GK } from '../frontend/src/game/attributes.js'
import { roleOf } from '../frontend/src/engine/formation.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IN = path.join(ROOT, 'data_in')
const DATA = path.join(ROOT, 'frontend', 'public', 'data')
const OUT = path.join(DATA, 'attrs')
const REPORT = process.argv.includes('--report')

const LEAGUES = {
  'premier-league': { cur: 'eng Premier League', old: 'ENG-Premier League', sofa: 'Premier League' },
  'la-liga': { cur: 'es La Liga', old: 'ESP-La Liga', sofa: 'LaLiga' },
  bundesliga: { cur: 'de Bundesliga', old: 'GER-Bundesliga', sofa: 'Bundesliga' },
  'serie-a': { cur: 'it Serie A', old: 'ITA-Serie A', sofa: 'Serie A' },
  'ligue-1': { cur: 'fr Ligue 1', old: 'FRA-Ligue 1', sofa: 'Ligue 1' },
}
// 세부 능력치 이름·순서(DETAIL, DETAIL_GK)와 중심값(detailBase)은 game/attributes.js와 공유

// ---------- CSV ----------
function parseCsv(text, delim = ',') {
  const rows = []
  let row = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c
    } else if (c === '"') q = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const head = rows.shift().map((h) => h.replace(/^﻿/, ''))
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}
const read = (rel, delim) => parseCsv(fs.readFileSync(path.join(IN, rel), 'utf8'), delim)
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }

// ---------- 이름 ----------
const norm = (s = '') => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/[łŁ]/g, 'l').replace(/đ/g, 'd')
  .toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const tokens = (s) => norm(s).split(' ').filter(Boolean)
const last = (s) => tokens(s).at(-1) || ''
/** 두 이름이 같은 사람일 가능성 (0~1) */
function nameScore(a, b) {
  const na = norm(a), nb = norm(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const ta = tokens(a), tb = tokens(b)
  const sa = new Set(ta), sb = new Set(tb)
  const common = ta.filter((t) => sb.has(t) && t.length > 1).length
  if (common && (common === Math.min(sa.size, sb.size))) return 0.9 // 한쪽 이름이 다른 쪽에 다 들어 있음 (Vinicius Junior ↔ Vinicius Jose Paixao de Oliveira Junior)
  if (last(a) === last(b) && ta[0]?.[0] === tb[0]?.[0]) return 0.8
  if (last(a) === last(b)) return 0.6
  if (common) return 0.5
  return 0
}

// ---------- 데이터 읽기 ----------
const cur = read('kaggle-fbref-2025-26/players_data-2025_2026.csv')
const old = read('kaggle-fbref-2017-2025/Top5_League_Players_2017to2024_dataset.csv', ';')
const sofaProf = read('kaggle-sofascore-2025-26/all_player_profiles.csv')
const sofaStat = Object.fromEntries(read('kaggle-sofascore-2025-26/all_player_stats.csv').map((r) => [r.player_id, r]))

// 과거 기록: 이름+출생 연도로 묶기 (시즌 가중: 24-25 0.8, 23-24 0.6, 그 전 0.3)
const SEASON_W = { 2425: 0.8, 2324: 0.6 }
const oldBy = new Map()
for (const r of old) {
  const k = `${norm(r.player)}|${r.born_}`
  if (!oldBy.has(k)) oldBy.set(k, [])
  oldBy.get(k).push({ ...r, w: SEASON_W[r.season] ?? 0.3 })
}
const oldByName = new Map()
for (const k of oldBy.keys()) { const n = k.split('|')[0]; oldByName.set(n, [...(oldByName.get(n) || []), k]) }

// ---------- 지표 모으기 ----------
/** 한 선수의 실제 기록을 가중 합산 → 지표별 { v(90분당 등), n(표본) } */
function metricsOf(c, olds, sofa) {
  const m = {}
  const add = (k, v, n) => { if (n > 0 && Number.isFinite(v)) m[k] = { v, n } }
  // 가중 합산 도우미: [[값, 분모, 가중]] → 합
  const pool = (parts) => { let a = 0, b = 0; for (const [x, y, w] of parts) { a += x * w; b += y * w } return [a, b] }
  const curMin = c ? num(c.Min) : 0
  const om = (r) => num(r['Playing Time_Min'])
  const O = (k) => olds.map((r) => [num(r[k]), om(r), r.w])
  const C = (k) => (c ? [[num(c[k]), curMin, 1]] : [])

  // 슈팅: 90분당 슛 / 유효 슛 비율
  const [sh, shMin] = pool([...C('Sh'), ...O('Standard_Sh')])
  add('sh90', (sh / Math.max(shMin, 1)) * 90, shMin)
  const [sot, shots] = pool([...(c ? [[num(c.SoT), num(c.Sh), 1]] : []), ...olds.map((r) => [num(r.Standard_SoT), num(r.Standard_Sh), r.w])])
  add('sotPct', (sot + 3) / (shots + 9), shots) // 3/9 = 평균 쪽으로 당기는 사전값
  // 결정력: 페널티 뺀 골 ÷ 페널티 뺀 xG (이번 시즌 xG는 SofaScore, 과거는 FBref npxG)
  const parts = olds.map((r) => [num(r.Performance_Gls) - num(r.Performance_PK), num(r.Expected_npxG), r.w])
  if (c && sofa && num(sofa.expected_goals) > 0) parts.push([num(c.Gls) - num(c.PK), Math.max(0.1, num(sofa.expected_goals) - 0.76 * num(c.PKatt)), 1])
  const [npg, npxg] = pool(parts)
  if (npxg > 0) add('fin', (npg + 2) / (npxg + 2), shots)
  // 패스·찬스 창출·드리블·공중볼·안정성: 과거 기록(FBref 고급 기록)만 있음
  const [cmp, att] = pool(olds.map((r) => [num(r.Total_Cmp), num(r.Total_Att), r.w]))
  add('cmpPct', (cmp + 80) / (att + 100), att / 30)
  const per90 = (k, extra = []) => { const [a, b] = pool([...O(k), ...extra]); return [(a / Math.max(b, 1)) * 90, b] }
  const [prgp, oMin] = per90('PrgP_'); add('prgp90', prgp, oMin)
  const [kp] = per90('KP_'); add('kp90', kp, oMin)
  const xaParts = sofa && c ? [[num(sofa.expected_assists), curMin, 1]] : []
  const [xa, xaMin] = per90('Expected_xA', xaParts); add('xa90', xa, xaMin)
  const [sca] = per90('SCA_SCA'); add('sca90', sca, oMin)
  const [tos] = per90('Take-Ons_Succ'); add('tos90', tos, oMin)
  const [toS, toA] = pool(olds.map((r) => [num(r['Take-Ons_Succ']), num(r['Take-Ons_Att']), r.w]))
  add('toPct', (toS + 5) / (toA + 11), toA)
  const [prgc] = per90('Carries_PrgC'); add('prgc90', prgc, oMin)
  const [crs, crsMin] = per90('Performance_Crs', C('Crs')); add('crs90', crs, crsMin)
  const [crspa] = per90('CrsPA_'); add('crspa90', crspa, oMin)
  const [tkl, tklMin] = per90('Tackles_Tkl', sofa && c ? [[num(sofa.tackles), curMin, 1]] : []); add('tkl90', tkl, tklMin)
  const [chT, chA] = pool(olds.map((r) => [num(r.Challenges_Tkl), num(r.Challenges_Att), r.w]))
  add('chPct', (chT + 5) / (chA + 10), chA)
  const [int, intMin] = per90('Int_', C('Int')); add('int90', int, intMin)
  const [clr] = pool(olds.map((r) => [num(r.Clr_) + num(r.Blocks_Blocks), om(r), r.w])); add('clr90', (clr / Math.max(oMin, 1)) * 90, oMin)
  const [aw, al] = pool(olds.map((r) => [num(r['Aerial Duels_Won']), num(r['Aerial Duels_Lost']), r.w]))
  add('aw90', (aw / Math.max(oMin, 1)) * 90, oMin)
  add('awPct', (aw + 5) / (aw + al + 10), aw + al)
  const [loss, touch] = pool(olds.map((r) => [num(r.Carries_Dis) + num(r.Carries_Mis), num(r.Touches_Touches), r.w]))
  add('lossPct', -(loss + 5) / (touch + 50), touch / 20) // 높을수록 좋게 부호 반전
  const [err] = per90('Err_'); add('err90', -err, oMin)
  // 규율: 파울·경고·퇴장 (높을수록 깨끗하게 부호 반전)
  const fp = (fls, y, r) => fls + 4 * y + 12 * r
  const discParts = olds.map((r) => [fp(num(r.Performance_Fls), num(r.Performance_CrdY), num(r.Performance_CrdR)), om(r), r.w])
  if (c) discParts.push([fp(num(c.Fls), num(c.CrdY), num(c.CrdR)), curMin, 1])
  const [dp, dMin] = pool(discParts); add('disc', -(dp / Math.max(dMin, 1)) * 90, dMin)
  // 골키퍼 (이번 시즌만)
  if (c && num(c.SoTA) > 0) {
    add('savePct', (num(c.Saves) + 20) / (num(c.SoTA) + 29), num(c.SoTA)) // 20/29 ≈ 리그 평균 쪽으로
    const pkFaced = num(c.PKatt_stats_keeper)
    add('pkSave', (num(c.PKsv) + 1.5) / (pkFaced + 7), pkFaced)
  }
  return m
}

// 능력치 = 지표 조합 [지표, 비중, 표본 기준(이만큼이면 절반 신뢰)]
const RECIPE = {
  결정력: [['fin', 1, 40]],
  슈팅: [['sh90', 0.6, 900], ['sotPct', 0.4, 30]],
  패스: [['cmpPct', 0.5, 40], ['prgp90', 0.5, 900]],
  '찬스 창출': [['kp90', 0.4, 900], ['xa90', 0.4, 900], ['sca90', 0.2, 900]],
  드리블: [['tos90', 0.5, 900], ['toPct', 0.25, 25], ['prgc90', 0.25, 900]],
  크로스: [['crs90', 0.6, 900], ['crspa90', 0.4, 900]],
  태클: [['tkl90', 0.6, 900], ['chPct', 0.4, 25]],
  '위치 선정': [['int90', 0.5, 900], ['clr90', 0.5, 900]],
  공중볼: [['aw90', 0.5, 900], ['awPct', 0.5, 25]],
  안정성: [['lossPct', 0.7, 40], ['err90', 0.3, 900]],
  규율: [['disc', 1, 900]],
  선방률: [['savePct', 1, 80]], // 한 시즌 선방률은 수비진 영향이 커서 더 보수적으로
  'PK 선방': [['pkSave', 1, 8]],
  빌드업: [['cmpPct', 1, 40]],
}
// 중심값(detailBase) = 전체 수준(레이더 평균)과 그 능력치에 가까운 레이더 값의 반반 — 레이더만 쓰면 스타는 모든 항목이 천장에 붙는다.
// 그 위에 같은 역할군 안 백분위로 ±SPREAD/2 기울여 강점·약점을 가른다.
const SPREAD = 40
const GROUP = { GK: 'GK', CB: 'CB', LB: 'FB', RB: 'FB', LWB: 'FB', RWB: 'FB', DM: 'CM', CM: 'CM', AM: 'AT', LM: 'AT', RM: 'AT', LW: 'AT', RW: 'AT', ST: 'ST' }
const clamp = (v) => Math.max(30, Math.min(99, Math.round(v)))

// ---------- 리그별 처리 ----------
const all = [] // { league, team, p, metrics, group }
const report = { leagues: {} }
const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'))
for (const [lid, L] of Object.entries(LEAGUES)) {
  const season = index.leagues?.find?.((l) => l.id === lid)?.defaultSeason || '2025-26'
  const file = path.join(DATA, lid, `${season}.json`)
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  const ratings = JSON.parse(fs.readFileSync(path.join(DATA, 'ratings', `${lid}.json`), 'utf8')).players || {}
  const curL = cur.filter((r) => r.Comp === L.cur)
  const squads = [...new Set(curL.map((r) => r.Squad))]
  const sofaL = sofaProf.filter((r) => r.league === L.sofa)
  const rep = { teams: [], matched: 0, total: 0, old: 0, sofa: 0, unmatched: [] }
  const usedSquads = new Set()
  // 구단 짝: 선수 이름이 가장 많이 겹치는 FBref 구단
  const pairs = data.teams.map((t) => {
    const ps = t.players.map((p) => ({ ...p, ...(ratings[p.id] || {}) }))
    const scored = squads.map((s) => {
      const rows = curL.filter((r) => r.Squad === s)
      const hits = ps.filter((p) => rows.some((r) => nameScore(p.name, r.Player) >= 0.8)).length
      return { s, hits }
    }).sort((a, b) => b.hits - a.hits)
    return { t, ps, best: scored[0] }
  }).sort((a, b) => b.best.hits - a.best.hits)
  for (const { t, ps, best } of pairs) {
    const squad = best && !usedSquads.has(best.s) && best.hits >= 3 ? best.s : null
    if (squad) usedSquads.add(squad)
    const rows = squad ? curL.filter((r) => r.Squad === squad) : []
    let m = 0
    for (const p of ps) {
      rep.total++
      // 같은 구단 안에서 가장 비슷한 이름 → 없으면 리그 전체에서 완전 일치(시즌 중 이적)
      const cand = rows.map((r) => ({ r, s: nameScore(p.name, r.Player) })).filter((x) => x.s >= 0.6).sort((a, b) => b.s - a.s)
      let c = cand.length && (cand.length === 1 || cand[0].s > cand[1].s) ? cand[0].r : null
      if (!c) { const ex = curL.filter((r) => norm(r.Player) === norm(p.name)); if (ex.length === 1) c = ex[0] }
      // 과거 기록: FBref 이름+출생 연도 → 없으면 우리 이름+나이로 계산한 출생 연도
      const born = c?.Born || String(2025 - (p.age || 25))
      const keys = [`${norm(c?.Player || p.name)}|${born}`, `${norm(p.name)}|${born}`, `${norm(p.name)}|${+born - 1}`, `${norm(p.name)}|${+born + 1}`]
      let ok = keys.find((k) => oldBy.has(k))
      if (!ok) { const byN = oldByName.get(norm(c?.Player || p.name)) || []; if (byN.length === 1) ok = byN[0] }
      const olds = ok ? oldBy.get(ok) : []
      // SofaScore: 같은 리그에서 이름 (같은 이름이 둘이면 포기)
      const sc = sofaL.map((r) => ({ r, s: nameScore(c?.Player || p.name, r.name) })).filter((x) => x.s >= 0.8).sort((a, b) => b.s - a.s)
      const sofa = sc.length && (sc.length === 1 || sc[0].s > sc[1].s) ? sofaStat[sc[0].r.player_id] : null
      if (c) { m++; rep.matched++ } else rep.unmatched.push(`${t.short} ${p.name}`)
      if (olds.length) rep.old++
      if (sofa) rep.sofa++
      all.push({ lid, team: t, p, group: GROUP[roleOf(p)] || 'CM', metrics: c || olds.length ? metricsOf(c, olds, sofa) : {} })
    }
    rep.teams.push(`${t.short}=${squad || '없음'}(${m}/${ps.length})`)
  }
  report.leagues[lid] = rep
}

// ---------- 백분위 → 능력치 ----------
// 역할군·지표별 분포 (표본이 충분한 선수만으로 기준을 만든다)
const dist = {}
for (const x of all) for (const [k, { v, n }] of Object.entries(x.metrics)) {
  const minN = /Pct|fin|pkSave/.test(k) ? 15 : 600
  if (n < minN) continue
  const g = /savePct|pkSave/.test(k) ? 'GK' : x.group
  ;(dist[`${g}|${k}`] ??= []).push(v)
}
for (const k in dist) dist[k].sort((a, b) => a - b)
const pctOf = (g, k, v) => {
  const d = dist[`${g}|${k}`]
  if (!d || d.length < 8) return null
  let lo = 0, hi = d.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (d[mid] < v) lo = mid + 1; else hi = mid }
  return lo / d.length
}

const out = {}
const famous = []
for (const x of all) {
  const labels = attrsOf(x.p).gk ? DETAIL_GK : DETAIL
  let est = 0
  const v = labels.map((label, i) => {
    const base = detailBase(x.p, label)
    let tilt = 0, wsum = 0
    for (const [k, w, half] of RECIPE[label]) {
      const mm = x.metrics[k]
      const pc = mm && pctOf(x.group, k, mm.v)
      if (pc == null) continue
      const conf = mm.n / (mm.n + half) // 표본이 적으면 레이더 쪽으로
      tilt += w * conf * (pc - 0.5) * SPREAD
      wsum += w
    }
    if (!wsum) est |= 1 << i
    return clamp(base + tilt)
  })
  ;(out[x.lid] ??= {})[x.p.id] = est ? { v, e: est } : { v }
  if (REPORT) famous.push({ name: x.p.name, team: x.team.short, role: roleOf(x.p), labels, v, est })
}

fs.mkdirSync(OUT, { recursive: true })
const now = new Date().toISOString()
for (const [lid, players] of Object.entries(out)) {
  fs.writeFileSync(path.join(OUT, `${lid}.json`), JSON.stringify({
    source: 'FBref(2017-18~2025-26, Kaggle 공개 데이터셋)·SofaScore(2025-26) 기록으로 계산한 게임용 값 — 원본 수치는 담지 않음',
    updatedAt: now, labels: DETAIL, labelsGk: DETAIL_GK, players,
  }) + '\n')
}

// ---------- 보고 ----------
for (const [lid, r] of Object.entries(report.leagues)) {
  console.log(`\n[${lid}] 이번 시즌 기록 매칭 ${r.matched}/${r.total} (${Math.round((r.matched / r.total) * 100)}%) · 과거 기록 ${r.old} · SofaScore ${r.sofa}`)
  if (REPORT) { console.log('  구단 짝:', r.teams.join(', ')); console.log('  못 찾음(앞 15):', r.unmatched.slice(0, 15).join(', ')) }
}
if (REPORT) {
  // 천장 쏠림 점검: 900분 이상 기록이 있는 필드 선수의 20점 비율, 항목별 평균
  const t20 = (v) => Math.max(1, Math.min(20, Math.round((v - 40) / 3)))
  const field = famous.filter((f) => f.labels === DETAIL)
  const top = field.flatMap((f) => f.v).filter((v) => t20(v) === 20).length / Math.max(1, field.length * DETAIL.length)
  console.log(`\n필드 선수 ${field.length}명 · 20점 비율 ${(top * 100).toFixed(1)}% · 항목 평균: ` + DETAIL.map((l, i) => `${l} ${(field.reduce((s, f) => s + t20(f.v[i]), 0) / field.length).toFixed(1)}`).join(', '))
  const pick =['Haaland', 'Rodri', 'Virgil van Dijk', 'Mohamed Salah', 'Bukayo Saka', 'Kylian Mbapp', 'Lamine Yamal', 'Harry Kane', 'Declan Rice', 'Martin Ødegaard', 'Bruno Fernandes', 'Pedri', 'Vitinha', 'Alisson', 'Gianluigi Donnarumma', 'Antonio Rüdiger', 'Rúben Dias', 'Joshua Kimmich']
  for (const f of famous.filter((f) => pick.some((n) => norm(f.name).includes(norm(n))))) {
    console.log(`${f.name} (${f.team} ${f.role}) ` + f.labels.map((l, i) => `${l} ${Math.max(1, Math.min(20, Math.round((f.v[i] - 40) / 3)))}${f.est & (1 << i) ? '~' : ''}`).join(' · '))
  }
}
