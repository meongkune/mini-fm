// 데이터 품질 검사 (CI): 게임 데이터가 정상인지, 직전 버전과 비교해 이상하게 줄거나 바뀌지 않았는지 확인한다.
// 하나라도 실패하면 종료 코드 1 → 워크플로가 멈춘다 (데이터 커밋·사이트 배포가 안 된다)
//
// 실행: node tools/check_data.mjs [--base <git 기준>] [--allow-squad-change]
//   --base HEAD     : 아직 커밋 안 한 변경을 마지막 커밋과 비교 (데이터 봇이 커밋하기 직전)
//   --base HEAD~1   : 마지막 커밋을 그 전 커밋과 비교 (push 뒤 배포 직전)
//   --allow-squad-change : 시즌 명단을 새로 가져올 때 (명단이 크게 바뀌는 게 정상)
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'frontend', 'public', 'data')
const args = process.argv.slice(2)
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : null
const allowSquad = args.includes('--allow-squad-change')

const errors = []
const notes = []
const fail = (m) => errors.push(m)
const ok = (m) => notes.push(m)
const read = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'))
const exists = (rel) => fs.existsSync(path.join(DATA, rel))
// 기준 버전의 파일 (없으면 null)
const readBase = (rel) => {
  if (!base) return null
  try { return JSON.parse(execSync(`git -C "${ROOT}" show ${base}:frontend/public/data/${rel}`, { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString()) } catch { return null }
}
const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

const index = read('index.json')
const allIds = new Map()
let radNow = 0
let radBase = 0
for (const l of index.leagues) {
  const file = l.seasons[0].file
  // ── 1. 시즌 명단 ──
  const season = read(file)
  const teams = season.teams || []
  if (teams.length < (l.marketOnly ? 10 : 16)) fail(`${l.id}: 구단 수 ${teams.length} (너무 적음)`)
  for (const t of teams) {
    const n = t.players.length
    const max = l.marketOnly ? 50 : 32
    if (n < 14 || n > max) fail(`${l.id} ${t.id}: 선수 ${n}명 (정상 14~${max})`)
    for (const p of t.players) {
      if (!p.id || !p.name || !['GK', 'DF', 'MF', 'FW'].includes(p.pos)) fail(`${l.id} ${t.id}: 필수 정보가 빠진 선수 ${p.id || p.name}`)
      if (allIds.has(p.id)) fail(`선수 ID 중복: ${p.id} (${allIds.get(p.id)} · ${l.id})`)
      allIds.set(p.id, l.id)
      if (!inRange(p.att, 20, 99) || !inRange(p.def, 20, 99)) fail(`${l.id} ${p.id}: 능력치 범위 밖 (공격 ${p.att} · 수비 ${p.def})`)
    }
  }
  // 직전 버전과 비교: 한 번에 명단이 크게 바뀌면 (다음 시즌 명단이 섞이는 등) 실패
  const prev = readBase(file)
  if (prev && !allowSquad) {
    let added = 0
    let removed = 0
    const prevIds = new Set(prev.teams.flatMap((t) => t.players.map((p) => p.id)))
    const nowIds = new Set(teams.flatMap((t) => t.players.map((p) => p.id)))
    for (const id of nowIds) if (!prevIds.has(id)) added++
    for (const id of prevIds) if (!nowIds.has(id)) removed++
    if (added + removed > 10) fail(`${l.id}: 명단이 한 번에 ${added}명 추가 · ${removed}명 삭제됨 (10명 넘게 바뀌면 사람이 확인해야 함)`)
  }

  // ── 2. 능력치 (SportsAPI) ──
  const rf = `ratings/${l.id}.json`
  if (exists(rf)) {
    const r = read(rf).players
    let rad = 0
    for (const [id, x] of Object.entries(r)) {
      if (!inRange(x.att, 15, 99) || !inRange(x.def, 15, 99)) fail(`${rf} ${id}: 능력치 범위 밖 (공격 ${x.att} · 수비 ${x.def})`) // 골키퍼 공격은 20까지 낮다
      if (x.rad !== undefined && x.rad !== 'none') {
        if (!Array.isArray(x.rad) || x.rad.length !== 5 || !x.rad.every((v) => inRange(v, 30, 99))) fail(`${rf} ${id}: 레이더 형식 오류`)
        else rad++
      }
      if (x.gk !== undefined) {
        if (!Array.isArray(x.gk) || x.gk.length !== 4 || !x.gk.every((v) => inRange(v, 30, 99))) fail(`${rf} ${id}: 골키퍼 능력치 형식 오류`)
        else rad++
      }
    }
    radNow += rad
    const pr = readBase(rf)?.players
    if (pr) {
      const prevRad = Object.values(pr).filter((x) => Array.isArray(x.rad) || Array.isArray(x.gk)).length
      radBase += prevRad
      // 레이더는 쌓이기만 해야 한다 (어제 941 → 161명 사고)
      if (rad < prevRad - 2) fail(`${l.id}: 레이더 ${prevRad} → ${rad}명 (줄어들면 안 됨)`)
      // 시장가치 능력치가 붙은 선수 수가 크게 줄면 실패
      const n0 = Object.keys(pr).length
      const n1 = Object.keys(r).length
      if (n1 < n0 * 0.95) fail(`${l.id}: 시장가치 반영 선수 ${n0} → ${n1}명 (5% 넘게 줄어듦)`)
      // 하루 만에 OVR이 크게 바뀐 선수가 많으면 데이터가 깨졌을 가능성
      const jumps = Object.entries(r).filter(([id, x]) => pr[id] && Math.abs((x.att + x.def) / 2 - (pr[id].att + pr[id].def) / 2) > 10).length
      if (jumps > 20) fail(`${l.id}: 능력치가 10 넘게 바뀐 선수 ${jumps}명`)
    }
  }

  // ── 3. 연봉·키·등번호 (TheSportsDB) ──
  const wf = `wages/${l.id}.json`
  if (exists(wf)) {
    for (const [id, x] of Object.entries(read(wf).players)) {
      if (x.w !== undefined && !inRange(x.w, 0.01, 80)) fail(`${wf} ${id}: 연봉 ${x.w} (범위 밖)`)
      if (x.h !== undefined && !inRange(x.h, 150, 210)) fail(`${wf} ${id}: 키 ${x.h}cm (범위 밖)`)
      if (x.n !== undefined && !inRange(x.n, 1, 99)) fail(`${wf} ${id}: 등번호 ${x.n} (범위 밖)`)
    }
  }
  // ── 4. 통일 사진: 목록에 있는 선수는 파일이 있어야 한다 ──
  const ff = `faces/${l.id}.json`
  if (exists(ff)) {
    const missing = Object.keys(read(ff).players).filter((id) => !exists(`faces/${id}.webp`))
    if (missing.length) fail(`${ff}: 사진 파일이 없는 선수 ${missing.length}명 (예: ${missing.slice(0, 3).join(', ')})`)
  }
}
ok(`리그 ${index.leagues.length}개 · 선수 ${allIds.size.toLocaleString()}명 · 중복 ID 없음`)
ok(`레이더 ${base ? `${radBase} → ` : ''}${radNow}명`)

for (const n of notes) console.log(`✔ ${n}`)
if (errors.length) {
  for (const e of errors.slice(0, 40)) console.log(`✖ ${e}`)
  if (errors.length > 40) console.log(`… 외 ${errors.length - 40}건`)
  console.log(`\n데이터 검사 실패 ${errors.length}건 — 배포(또는 커밋)를 멈춥니다`)
  process.exit(1)
}
console.log('\n데이터 검사 통과')
