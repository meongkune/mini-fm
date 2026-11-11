// 명단 점검: 우리 2025-26 명단 vs 위키백과 '2025–26 ○○ 시즌' 문서의 1군 명단 → 빠진 선수·떠난 선수 목록
//   데이터를 가져와 넣지 않는다. 사람이 보고 tools/squad_fixes.json에 사실만 적기 위한 점검표다.
// 실행: FOOTBALL_DATA_TOKEN=... node tools/squad_audit.mjs [대회 코드 …]   (없으면 9개 리그)
//   football-data: 구단 영문 이름(대회당 1회) · 위키백과: 시즌 문서 검색·본문(구단당 2회, 1초 간격)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'frontend', 'public', 'data')
const FD = process.env.FOOTBALL_DATA_TOKEN
const UA = { 'User-Agent': 'MiniFM-squad-audit/1.0 (https://github.com/meongkune/mini-fm)' }
const LEAGUES = { PL: 'premier-league', BL1: 'bundesliga', PD: 'la-liga', SA: 'serie-a', FL1: 'ligue-1', DED: 'eredivisie', PPL: 'primeira-liga', ELC: 'championship', BSA: 'brasileirao' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fold = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
const wiki = async (params) => { await sleep(1000); return fetch(`https://en.wikipedia.org/w/api.php?format=json&formatversion=2&${params}`, { headers: UA }).then((r) => r.json()) }

// 같은 선수인가: 성 + 이름 첫 글자 (한 단어 이름은 그 단어)
function same(a, b) {
  const x = fold(a).split(' ')
  const y = fold(b).split(' ')
  if (x.join(' ') === y.join(' ')) return true
  if (x.length === 1 || y.length === 1) return x.some((w) => y.includes(w) && w.length > 3)
  return x.at(-1) === y.at(-1) && x[0][0] === y[0][0]
}

/** 시즌 문서 본문에서 1군 명단 (이름·임대 여부) */
function parseSquad(wt) {
  const m = wt.match(/\n(==+)\s*((First[- ]team )?[Ss]quad|Players|Current squad|Squad information)[^=\n]*==+\s*\n/)
  if (!m) return []
  const level = m[1].length
  const rest = wt.slice(m.index + m[0].length)
  const end = rest.search(new RegExp(`\\n={2,${level}}[^=]`))
  const sec = end >= 0 ? rest.slice(0, end) : rest
  const out = []
  const linkName = (s) => { const k = s.match(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/); return k ? (k[2] || k[1]).trim() : null }
  // ① 틀: {{Fs player|...|name=[[X]]}} · {{football squad player|...}}
  for (const t of sec.matchAll(/\{\{\s*(?:[Ff]s player|[Ff]ootball squad player)([^}]*)\}\}/g)) {
    const nm = t[1].match(/name\s*=\s*([^|]+)/)
    const n = nm ? (linkName(nm[1]) || nm[1].replace(/[[\]]/g, '').trim()) : null
    if (n) out.push({ name: n, loan: /loan|other\s*=\s*.*loan/i.test(t[1]) })
  }
  // ② 표: 등번호 칸 다음의 첫 링크 칸이 선수
  if (!out.length) {
    for (const row of sec.split(/\n\|-/)) {
      const cells = row.split('\n').filter((l) => /^[|!]/.test(l)).map((l) => l.replace(/^[|!]\s*/, ''))
      const ni = cells.findIndex((c) => /^\d{1,2}\s*$/.test(c))
      if (ni < 0) continue
      const pc = cells.slice(ni + 1).find((c) => /\[\[/.test(c) && !/flagicon|\(association football\)/.test(c))
      const n = pc && linkName(pc)
      if (n) out.push({ name: n, loan: /loan(ed)? (to|out)/i.test(row) })
    }
  }
  return out
}

const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'))
const fixes = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'squad_fixes.json'), 'utf8'))
const codes = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(LEAGUES)
const report = []
for (const code of codes) {
  const lid = LEAGUES[code]
  const season = JSON.parse(fs.readFileSync(path.join(DATA, index.leagues.find((l) => l.id === lid).seasons[0].file), 'utf8'))
  const fd = await fetch(`https://api.football-data.org/v4/competitions/${code}/teams?season=2025`, { headers: { 'X-Auth-Token': FD } }).then((r) => r.json())
  const enOf = Object.fromEntries((fd.teams || []).map((t) => [t.id, t]))
  report.push(`\n## ${lid}`)
  let noArticle = 0
  for (const t of season.teams) {
    const en = enOf[t.ext]
    if (!en) continue
    // 시즌 문서 찾기: '2025–26 <구단> season' (브라질은 '2025 <구단> season')
    const yr = code === 'BSA' ? '2025' : '2025–26'
    const q = await wiki(`action=query&list=search&srsearch=${encodeURIComponent(`${yr} ${en.shortName || en.name} season`)}&srlimit=5`)
    const key = fold(en.shortName || en.name).split(' ').sort((a, b) => b.length - a.length)[0]
    const title = (q.query?.search || []).map((x) => x.title).find((x) => x.startsWith(yr) && fold(x).includes(key))
    if (!title) { noArticle++; continue }
    const p = await wiki(`action=parse&page=${encodeURIComponent(title)}&prop=wikitext`)
    const squad = parseSquad(p.parse?.wikitext || '')
    if (squad.length < 12) { noArticle++; continue }
    const ours = t.players
    const missing = squad.filter((w) => !w.loan && !ours.some((o) => same(o.name, w.name)))
    const extra = ours.filter((o) => !squad.some((w) => same(o.name, w.name)))
    if (!missing.length) continue
    report.push(`- **${t.name}** (${t.id}) · 위키 ${squad.length}명 · 빠짐 ${missing.length}: ${missing.map((m) => m.name).join(', ')}${extra.length ? ` · (위키에 없는 우리 선수 ${extra.length}명)` : ''}`)
  }
  report.push(`  (시즌 문서·명단 표를 못 찾은 구단 ${noArticle}곳)`)
}
const text = `# 명단 점검 (위키백과 2025-26 시즌 문서 기준)\n이미 손 보정한 선수: ${Object.values(fixes).filter((x) => typeof x === 'object').flatMap((x) => Object.values(x).flat()).map((x) => x.name).join(', ')}\n${report.join('\n')}\n`
fs.writeFileSync(path.join(ROOT, 'squad-audit.md'), text)
console.log(text)
