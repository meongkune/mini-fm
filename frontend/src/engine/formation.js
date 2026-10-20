// 포메이션 = 자리(slot) 11개. 각 자리는 세부 역할(role)과 경기장 좌표(x: 0 왼쪽~100 오른쪽, y: 0 우리 골문~100 상대 골문)를 가진다.
// "4-2-3-1"처럼 숫자 줄로 적으면 어떤 전형이든 자리를 만든다.
import { playerOvrOf } from './engine.js'

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

/** 포메이션 이름 → 자리 11개 [{ role, x, y }] (첫 자리는 GK) */
export function buildSlots(name) {
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
  return {
    att: (fw - 2) * 3 + am * 1.5 - dm * 1,
    mid: (mid - 4) * 2,
    def: (df - 4) * 2.5 + dm * 1.5 - am * 0.5,
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
/** 자리 적합도: 1(본 포지션) · 0.92(비슷한 역할) · 0.82(같은 큰 포지션) · 0.6(다른 포지션) · GK 아닌데 GK 자리 0.3 */
export function fitOf(p, slotRole) {
  const r = roleOf(p)
  if (r === slotRole) return 1
  if ((slotRole === 'GK') !== (r === 'GK')) return 0.3
  if (NEAR[r]?.includes(slotRole)) return 0.92
  if (ROLE_POS[r] === ROLE_POS[slotRole]) return 0.82
  return 0.6
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
