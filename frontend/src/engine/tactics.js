// 팀 전술(연속값) · AI 구단 스타일 · 전술 상성
// 전술 값은 0~100 (50 = 보통). 예전 저장값(문자열: 'attacking', 'high' …)도 그대로 읽는다.
import { buildSlots, ROLE_POS } from './formation.js'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }

const OLD = {
  mentality: { parkbus: 10, defensive: 30, balanced: 50, attacking: 70, allout: 90 },
  pressing: { low: 25, normal: 50, high: 80 },
  line: { low: 25, normal: 50, high: 80 },
  tempo: { slow: 25, normal: 50, fast: 80 },
}
const num = (v, key) => (typeof v === 'number' ? v : OLD[key]?.[v] ?? 50)

/** 전술 기본값 + 예전 값 변환 */
export function tacOf(t = {}) {
  return {
    mentality: num(t.mentality, 'mentality'),
    tempo: num(t.tempo, 'tempo'),
    width: t.width ?? 50,
    passing: t.passing ?? 50, // 0 짧게 ~ 100 길게(직선적)
    approach: t.approach || 'balanced', // possession | balanced | counter
    focus: t.focus || 'mixed', // mixed | wings | center
    press: num(t.pressing, 'pressing'),
    line: num(t.line, 'line'),
    trap: !!t.trap, // 오프사이드 트랩
    tackling: t.tackling || 'normal', // soft | normal | hard
  }
}

/** 전술 프리셋 (FM식 스타일) */
export const TAC_PRESETS = [
  ['gegen', '게겐프레싱', { mentality: 65, tempo: 75, width: 55, passing: 40, approach: 'balanced', focus: 'mixed', pressing: 90, line: 80, trap: true, tackling: 'hard' }],
  ['tiki', '점유율 축구', { mentality: 55, tempo: 30, width: 60, passing: 15, approach: 'possession', focus: 'center', pressing: 65, line: 70, trap: false, tackling: 'normal' }],
  ['counter', '역습', { mentality: 40, tempo: 80, width: 50, passing: 75, approach: 'counter', focus: 'mixed', pressing: 35, line: 30, trap: false, tackling: 'normal' }],
  ['wing', '측면 공격', { mentality: 60, tempo: 60, width: 90, passing: 55, approach: 'balanced', focus: 'wings', pressing: 55, line: 55, trap: false, tackling: 'normal' }],
  ['route1', '롱볼', { mentality: 55, tempo: 70, width: 60, passing: 95, approach: 'balanced', focus: 'center', pressing: 45, line: 45, trap: false, tackling: 'hard' }],
  ['bus', '버스 세우기', { mentality: 12, tempo: 30, width: 25, passing: 70, approach: 'counter', focus: 'mixed', pressing: 20, line: 15, trap: false, tackling: 'hard' }],
]
export const presetOf = (key) => TAC_PRESETS.find((p) => p[0] === key)

/** 이 전술이 어떤 스타일에 가까운지 (화면 표시용) */
export function styleName(t) {
  const x = tacOf(t)
  if (x.mentality <= 20 && x.line <= 30) return '버스 세우기'
  if (x.approach === 'counter') return '역습'
  if (x.press >= 80 && x.line >= 70) return '게겐프레싱'
  if (x.approach === 'possession' || x.passing <= 25) return '점유율 축구'
  if (x.passing >= 85) return '롱볼'
  if (x.width >= 80 || x.focus === 'wings') return '측면 공격'
  return '균형'
}

/** AI 구단 스타일: 강팀은 점유·압박, 약팀은 역습·수비 — 구단마다 고정 */
export function aiTactics(team, strength = 75) {
  const h = hash(team.id)
  const pool = strength >= 82 ? ['gegen', 'tiki', 'wing', 'tiki'] : strength >= 76 ? ['wing', 'counter', 'gegen', 'route1'] : ['counter', 'bus', 'route1', 'counter']
  const [, , t] = presetOf(pool[h % pool.length])
  return { ...t }
}

/** 전형의 측면 자원 수 (풀백·윙백·측면 미드·윙어) */
function wideCount(formation) {
  return buildSlots(formation).filter((s) => ['LB', 'RB', 'LWB', 'RWB', 'LM', 'RM', 'LW', 'RW'].includes(s.role)).length
}
function centralMid(formation) {
  return buildSlots(formation).filter((s) => ['CM', 'DM', 'AM'].includes(s.role)).length
}

/**
 * 전술 상성: 내 전술 vs 상대 전술·선수 → 공격·중원·수비 보정과 이유 목록
 * me/opp: { tac, formation, fwAtt, mfAtt, dfDef }
 */
export function edges(me, opp) {
  const a = tacOf(me.tac)
  const b = tacOf(opp.tac)
  const out = { att: 0, mid: 0, def: 0, chance: 0, quality: 0, foul: 1, offside: 1, notes: [] }
  const add = (k, v, note) => { out[k] += v; if (note && Math.abs(v) >= 0.8) out.notes.push([note, v > 0 ? 1 : -1]) }

  // 운영 성향 (0 버스 세우기 ~ 100 노빠꾸)
  const m = (a.mentality - 50) / 50
  add('att', m * 12)
  add('def', -m * (m < 0 ? 11 : 12))
  // 템포·패스 길이
  add('att', ((a.tempo - 50) / 50) * 3)
  add('mid', ((50 - a.tempo) / 50) * 2 + ((50 - a.passing) / 50) * 2)
  add('chance', ((a.passing - 50) / 50) * 0.012) // 길게 차면 기회는 빨리, 대신 정확도는 낮다
  add('quality', ((50 - a.passing) / 50) * 0.02)
  // 압박 강도 (체력 소모는 엔진에서)
  add('mid', ((a.press - 50) / 50) * 4)
  // 수비 라인
  add('mid', ((a.line - 50) / 50) * 3)
  add('def', ((50 - a.line) / 50) * 3)
  out.offside = 0.6 + (a.line / 100) * 1.1 + (a.trap ? 0.6 : 0)
  // 태클
  if (a.tackling === 'hard') { add('def', 1.5); out.foul = 1.4 }
  if (a.tackling === 'soft') { add('def', -1.5); out.foul = 0.7 }

  // ── 상성 ──
  // 1) 역습 vs 높은 라인·공격적인 상대
  if (a.approach === 'counter') {
    add('mid', -4)
    add('def', 3) // 내려앉아 촘촘하게 버틴다
    // 공을 덜 갖는 대신, 공을 잡으면 빠르게 결정적 기회를 만든다 (상대 라인이 높을수록 더)
    add('chance', 0.02 + Math.max(0, b.line - 50) / 50 * 0.03)
    add('quality', 0.03 + Math.max(0, b.line - 50) / 50 * 0.04)
    add('att', ((b.line - 50) / 50) * 5 + ((b.mentality - 50) / 50) * 3, b.line >= 65 ? '역습: 상대 라인이 높아 뒷공간이 넓다' : b.line <= 35 ? '역습: 상대가 내려앉아 뒷공간이 없다' : null)
    if (me.fwAtt > opp.dfDef + 4 && b.line >= 60) add('quality', 0.05, '역습: 우리 공격수가 상대 수비보다 빠르고 강하다')
  }
  // 2) 점유율 vs 강한 압박 (중원 기술이 약하면 공을 뺏긴다)
  if (a.approach === 'possession') {
    add('mid', 4)
    add('chance', -0.01)
    add('quality', 0.03)
    if (b.press >= 70) add('att', me.mfAtt >= 78 ? 1.5 : -4, me.mfAtt >= 78 ? '점유율: 압박을 기술로 벗겨낸다' : '점유율: 상대 압박에 중원에서 공을 자주 뺏긴다')
  }
  // 3) 내 압박 vs 상대 빌드업
  if (a.press >= 70) {
    if (b.passing <= 35 && opp.mfAtt < 78) add('att', 3, '압박: 상대가 짧은 패스로 풀다가 공을 잃는다')
    if (b.passing >= 70) add('def', -2.5, '압박: 상대가 롱볼로 압박을 건너뛴다')
  }
  // 4) 측면 공격 vs 측면 자원이 적은 상대
  const wide = a.width >= 70 || a.focus === 'wings'
  if (wide) {
    const ow = wideCount(opp.formation)
    add('att', ow <= 3 ? 3.5 : ow >= 6 ? -2 : 1, ow <= 3 ? '측면 공격: 상대 전형에 측면 수비가 부족하다' : ow >= 6 ? '측면 공격: 상대 윙백·윙어가 측면을 막는다' : null)
  }
  if (a.width <= 30 && b.line <= 35 && b.width <= 40) add('att', -2.5, '좁은 공격: 내려앉은 상대 중앙이 너무 촘촘하다')
  // 5) 중앙 숫자 싸움
  const cm = centralMid(me.formation) - centralMid(opp.formation)
  if (cm) add('mid', cm * 2, cm > 0 ? '중원: 중앙 미드필더 숫자가 많다' : '중원: 중앙에서 숫자가 밀린다')
  // 6) 내 라인 높이 vs 상대의 빠른 공격수·역습
  if (a.line >= 65 && (b.approach === 'counter' || opp.fwAtt >= 82)) add('def', -((a.line - 50) / 50) * (b.approach === 'counter' ? 7 : 4), '높은 라인: 상대 공격수에게 뒷공간을 내준다')
  // 7) 롱볼 vs 수비 공중볼 (공격수 힘 vs 수비)
  if (a.passing >= 80) add('att', (me.fwAtt - opp.dfDef) / 6, me.fwAtt > opp.dfDef ? '롱볼: 우리 공격수가 상대 수비와의 경합에서 이긴다' : '롱볼: 상대 수비가 경합에서 강하다')
  return out
}
