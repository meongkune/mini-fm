// 포메이션 = 자리(slot) 11개. 각 자리는 세부 역할(role)과 경기장 좌표(x: 0 왼쪽~100 오른쪽, y: 0 우리 골문~100 상대 골문)를 가진다.
// "4-2-3-1"처럼 숫자 줄로 적으면 어떤 전형이든 자리를 만든다.
import { playerOvrOf } from './engine.js'
import { roleScore } from '../game/attributes.js'

export const ROLE_LABEL = {
  GK: '골키퍼', LB: '왼쪽 풀백', CB: '센터백', RB: '오른쪽 풀백', LWB: '왼쪽 윙백', RWB: '오른쪽 윙백',
  DM: '수비형 미드', CM: '중앙 미드', LM: '왼쪽 미드', RM: '오른쪽 미드', AM: '공격형 미드',
  LW: '왼쪽 윙어', RW: '오른쪽 윙어', ST: '스트라이커',
}
// 역할 → 엔진이 쓰는 큰 포지션
export const ROLE_POS = { GK: 'GK', LB: 'DF', CB: 'DF', RB: 'DF', LWB: 'DF', RWB: 'DF', DM: 'MF', CM: 'MF', LM: 'MF', RM: 'MF', AM: 'MF', LW: 'FW', RW: 'FW', ST: 'FW' }

export const PRESETS = [
  ['4-4-2', '균형 잡힌 기본형'],
  ['4-3-3', '윙어를 활용한 공격형'],
  ['4-2-3-1', '두 명의 수비형 미드 + 공격형 미드'],
  ['4-1-4-1', '중원 장악 + 원톱'],
  ['4-4-1-1', '처진 공격수를 둔 4-4-2'],
  ['4-3-1-2', '다이아몬드 중원 투톱'],
  ['3-5-2', '윙백과 두꺼운 중원'],
  ['3-4-3', '공격적인 스리백'],
  ['5-3-2', '수비 강화형'],
  ['5-4-1', '극단적 수비 + 역습'],
]

/** "4-2-3-1" → [4,2,3,1] (필드 플레이어 10명, 2~5줄, 줄마다 1~6명) */
export function parseShape(name) {
  const lines = String(name).split('-').map((x) => parseInt(x, 10))
  if (lines.length < 2 || lines.length > 5 || lines.some((n) => !(n >= 1 && n <= 6))) return null
  if (lines.reduce((s, n) => s + n, 0) !== 10) return null
  if (lines[0] < 2) return null
  return lines
}

// 줄 종류별 역할 배치 (왼쪽 → 오른쪽)
const LINE_ROLES = {
  def: { 2: ['CB', 'CB'], 3: ['CB', 'CB', 'CB'], 4: ['LB', 'CB', 'CB', 'RB'], 5: ['LWB', 'CB', 'CB', 'CB', 'RWB'], 6: ['LWB', 'CB', 'CB', 'CB', 'CB', 'RWB'] },
  dm: { 1: ['DM'], 2: ['DM', 'DM'], 3: ['DM', 'DM', 'DM'] },
  mid: { 1: ['CM'], 2: ['CM', 'CM'], 3: ['CM', 'CM', 'CM'], 4: ['LM', 'CM', 'CM', 'RM'], 5: ['LM', 'CM', 'CM', 'CM', 'RM'], 6: ['LM', 'CM', 'CM', 'CM', 'CM', 'RM'] },
  am: { 1: ['AM'], 2: ['AM', 'AM'], 3: ['LW', 'AM', 'RW'], 4: ['LW', 'AM', 'AM', 'RW'] },
  fwd: { 1: ['ST'], 2: ['ST', 'ST'], 3: ['LW', 'ST', 'RW'], 4: ['LW', 'ST', 'ST', 'RW'] },
}
const fill = (table, n, fallback) => table[n] || Array.from({ length: n }, () => fallback)

// ── 직접 조정한 배치 ──
// 경기장에서 자리를 끌어 옮기면 기본 전형 이름 뒤에 '*'를 붙인 배치가 된다 (예: '4-4-2*').
// 좌표는 세이브(save.layout)에 있고, 화면이 그리기 전에 여기 등록한다. AI 구단은 쓰지 않는다.
const CUSTOM = new Map()
export const isCustom = (name) => String(name).endsWith('*')
export const baseOf = (name) => String(name).replace(/\*$/, '')
/** 화면 표시용 전형 이름: 직접 조정한 전형(이름 끝 *)은 '4-1-4-1 · 직접 조정'으로 */
export const formationLabel = (name) => (isCustom(name) ? `${baseOf(name)} · 직접 조정` : String(name))
export function setCustomLayout(name, pos) { if (name && Array.isArray(pos)) CUSTOM.set(name, pos) }

/**
 * 위치 → 역할 (x: 0 왼쪽~100 오른쪽, y: 0 우리 골문~100 상대 골문)
 *  수비 줄(y<32): 측면 풀백 · 가운데 센터백 / 32~42: 측면 윙백 · 가운데 수비형 미드
 *  42~62: 측면 미드 · 중앙 미드 / 62~76: 측면 윙어 · 공격형 미드 / 76~: 윙어 · 스트라이커
 */
export function roleAt(x, y) {
  const side = x < 50 ? 'L' : 'R'
  const wide = Math.abs(x - 50)
  if (y < 32) return wide >= 26 ? `${side}B` : 'CB'
  if (y < 42) return wide >= 26 ? `${side}WB` : 'DM'
  if (y < 62) return wide >= 27 ? `${side}M` : 'CM'
  if (y < 76) return wide >= 22 ? `${side}W` : 'AM'
  return wide >= 22 ? `${side}W` : 'ST'
}

const avg = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0)
function geometry(slots) {
  const f = slots.slice(1)
  const df = f.filter((s) => ROLE_POS[s.role] === 'DF')
  const ys = f.map((s) => s.y)
  return {
    y: avg(ys), // 팀 전체 높이
    dfY: df.length ? avg(df.map((s) => s.y)) : 22, // 수비 라인 높이
    width: avg(f.map((s) => Math.abs(s.x - 50))), // 폭
    span: Math.max(...ys) - Math.min(...ys), // 맨 뒤 ~ 맨 앞 간격 (작을수록 촘촘)
  }
}
/**
 * 직접 조정한 배치가 기본 전형과 얼마나 다른지 → 전술 보정
 *  line·width: 팀 지시(수비 라인·공격 폭)에 더해진다 (0~100 척도)
 *  att·def: 팀 전체를 올리면 공격 +·수비 −, 간격을 좁히면 수비 +·공격 −
 */
export function layoutShift(name) {
  const zero = { line: 0, width: 0, att: 0, def: 0, d: null }
  if (!isCustom(name) || !CUSTOM.has(name)) return zero
  const g = geometry(buildSlots(name))
  const b = geometry(buildSlots(baseOf(name)))
  const cl = (v, m) => Math.max(-m, Math.min(m, v))
  const dy = g.y - b.y
  const compact = b.span - g.span
  return {
    line: cl((g.dfY - b.dfY) * 2.5, 35),
    width: cl((g.width - b.width) * 2, 35),
    att: cl(dy * 0.18 - Math.max(0, compact) * 0.05, 4),
    def: cl(-dy * 0.14 + Math.max(0, compact) * 0.09, 4),
    d: { dy, dfY: g.dfY - b.dfY, width: g.width - b.width, compact },
  }
}

/** 포메이션 이름 → 자리 11개 [{ role, x, y }] (첫 자리는 GK) — '4-4-2*'처럼 *가 붙으면 직접 조정한 배치 */
export function buildSlots(name) {
  if (isCustom(name)) {
    const base = buildSlots(baseOf(name))
    const pos = CUSTOM.get(name)
    if (!pos || pos.length !== base.length) return base
    return base.map((s, i) => (i === 0 ? s : { role: roleAt(pos[i].x, pos[i].y), x: pos[i].x, y: pos[i].y }))
  }
  const lines = parseShape(name) || parseShape('4-4-2')
  const k = lines.length
  // 줄 종류: 첫 줄 수비, 마지막 줄 공격, 가운데는 개수에 따라 수비형·중앙·공격형
  const kinds = lines.map((n, i) => {
    if (i === 0) return 'def'
    if (i === k - 1) return 'fwd'
    const mids = k - 2
    if (mids === 1) return 'mid'
    if (mids === 2) return i === 1 ? (n <= 2 ? 'dm' : 'mid') : 'am'
    return ['dm', 'mid', 'am'][Math.min(2, i - 1)]
  })
  const slots = [{ role: 'GK', x: 50, y: 9 }] // 이름표가 경기장 아래로 잘리지 않게 조금 위로
  lines.forEach((n, i) => {
    const roles = fill(LINE_ROLES[kinds[i]], n, { def: 'CB', dm: 'DM', mid: 'CM', am: 'AM', fwd: 'ST' }[kinds[i]])
    const y = k === 1 ? 50 : 22 + (i * (82 - 22)) / (k - 1)
    roles.forEach((role, j) => {
      const wide = n === 1 ? 0 : n === 2 ? 34 : n === 3 ? 60 : 80
      const x = n === 1 ? 50 : 50 - wide / 2 + (j * wide) / (n - 1)
      slots.push({ role, x, y })
    })
  })
  return slots
}

/** 포메이션의 공격/중원/수비 보정 (자리 구성으로 계산) */
export function shapeMods(name) {
  const slots = buildSlots(name)
  const c = (r) => slots.filter((s) => r.includes(s.role)).length
  const df = c(['LB', 'CB', 'RB', 'LWB', 'RWB'])
  const fw = c(['LW', 'RW', 'ST'])
  const am = c(['AM'])
  const dm = c(['DM'])
  const mid = c(['CM', 'LM', 'RM', 'DM', 'AM'])
  const geo = layoutShift(name) // 직접 조정한 배치: 전체 높이·간격 보정
  return {
    att: (fw - 2) * 3 + am * 1.5 - dm * 1 + geo.att,
    mid: (mid - 4) * 2,
    def: (df - 4) * 2.5 + dm * 1.5 - am * 0.5 + geo.def,
  }
}

/** 큰 포지션 인원 (GK·DF·MF·FW) */
export function shapeNeeds(name) {
  const out = { GK: 0, DF: 0, MF: 0, FW: 0 }
  for (const s of buildSlots(name)) out[ROLE_POS[s.role]]++
  return out
}

/** 선수의 세부 포지션: 데이터에 있으면 그대로, 없으면 능력치로 추정 */
export function roleOf(p) {
  if (p.role) return p.role
  if (p.pos === 'GK') return 'GK'
  if (p.pos === 'DF') return 'CB'
  if (p.pos === 'FW') return 'ST'
  return p.att >= p.def + 8 ? 'AM' : p.def >= p.att + 8 ? 'DM' : 'CM'
}

// 비슷한 역할끼리 (적합도 0.92)
const NEAR = {
  LB: ['LWB', 'CB', 'LM'], RB: ['RWB', 'CB', 'RM'], CB: ['LB', 'RB', 'DM'], LWB: ['LB', 'LM'], RWB: ['RB', 'RM'],
  DM: ['CM', 'CB'], CM: ['DM', 'AM', 'LM', 'RM'], LM: ['LW', 'CM', 'LWB', 'LB'], RM: ['RW', 'CM', 'RWB', 'RB'], AM: ['CM', 'ST', 'LW', 'RW'],
  LW: ['LM', 'RW', 'AM', 'ST'], RW: ['RM', 'LW', 'AM', 'ST'], ST: ['AM', 'LW', 'RW'], GK: [],
}
/**
 * 자리 적합도: 1(본 포지션) · 0.92(비슷한 역할) · 0.82(같은 큰 포지션) · 0.65(한 줄 떨어진 포지션, 예: MF↔DF)
 * · 0.5(공격수↔수비수) · GK와 필드 플레이어가 바뀌면 0.3
 */
export function fitOf(p, slotRole) {
  const r = roleOf(p)
  if (r === slotRole) return 1
  if ((slotRole === 'GK') !== (r === 'GK')) return 0.3
  const a = ROLE_POS[r]
  const b = ROLE_POS[slotRole]
  const fam = NEAR[r]?.includes(slotRole) ? 0.92 : a === b ? 0.82 : (a === 'DF' && b === 'FW') || (a === 'FW' && b === 'DF') ? 0.5 : 0.65
  // 세부 능력치가 그 자리에 맞으면 경험 부족을 일부(최대 절반) 메운다
  //   예: 수비력 좋은 윙어는 풀백에서 덜 어색하고, 기술·창의성 좋은 센터백은 수비형 미드필더로 쓸 만하다
  const ratio = roleScore(p, slotRole) / Math.max(1, roleScore(p, r))
  const bonus = Math.max(0, Math.min(1, (ratio - 0.85) / 0.15)) * 0.5
  return Math.round((fam + (1 - fam) * bonus) * 100) / 100
}
export const fitTone = (f) => (f >= 1 ? 'best' : f >= 0.9 ? 'good' : f >= 0.8 ? 'ok' : 'bad')

/**
 * 자리에 선수 배정 (자동): 적합도 × 능력치(× 컨디션)가 높은 순으로 욕심쟁이 배정
 * keep: 이미 정해 둔 배정을 유지할 자리 인덱스 → 선수 ID
 */
export function assignSlots(team, formation, { status = {}, available = () => true, useCondition = true, keep = {} } = {}) {
  const slots = buildSlots(formation)
  const cond = (p) => (useCondition ? 0.72 + 0.28 * ((status[p.id]?.cond ?? 100) / 100) : 1)
  const pool = team.players.filter((p) => available(p.id))
  const ids = Array(slots.length).fill(null)
  const used = new Set()
  for (const [i, id] of Object.entries(keep)) {
    if (id && pool.some((p) => p.id === id)) { ids[i] = id; used.add(id) }
  }
  // 모든 (자리, 선수) 쌍 점수 → 높은 순 배정
  const pairs = []
  slots.forEach((s, i) => {
    if (ids[i]) return
    for (const p of pool) pairs.push({ i, p, v: playerOvrOf(p) * fitOf(p, s.role) * cond(p) })
  })
  pairs.sort((a, b) => b.v - a.v)
  for (const { i, p } of pairs) {
    if (ids[i] || used.has(p.id)) continue
    ids[i] = p.id
    used.add(p.id)
  }
  return ids
}

/**
 * 세부 포지션이 없는 선수들의 역할을 팀 안에서 추정한다 (API가 "Defence"처럼 넓게만 주는 경우가 많다)
 * 수비수: 공격 성향이 낮은 절반은 CB, 나머지는 LB·RB 번갈아 / 미드: 수비 성향 30% DM, 공격 성향 30% AM, 나머지 CM
 * 공격수: 공격력 상위 40%는 ST, 나머지는 LW·RW 번갈아
 */
export function inferRoles(players) {
  const out = new Map()
  const lack = (pos) => players.filter((p) => p.pos === pos && !p.role)
  const df = lack('DF').sort((a, b) => (a.att - a.def) - (b.att - b.def))
  const cbN = Math.ceil(df.length / 2)
  df.forEach((p, i) => out.set(p.id, i < cbN ? 'CB' : (i - cbN) % 2 === 0 ? 'LB' : 'RB'))
  const mf = lack('MF').sort((a, b) => (b.def - b.att) - (a.def - a.att))
  const dmN = Math.round(mf.length * 0.3)
  const amN = Math.round(mf.length * 0.3)
  mf.forEach((p, i) => out.set(p.id, i < dmN ? 'DM' : i >= mf.length - amN ? 'AM' : 'CM'))
  const fw = lack('FW').sort((a, b) => b.att - a.att)
  const stN = Math.ceil(fw.length * 0.4)
  fw.forEach((p, i) => out.set(p.id, i < stN ? 'ST' : (i - stN) % 2 === 0 ? 'LW' : 'RW'))
  return players.map((p) => (out.has(p.id) ? { ...p, role: out.get(p.id), roleGuess: true } : p))
}
