// 팀 전술(연속값) · AI 구단 스타일 · 전술 상성
// 전술 값은 0~100 (50 = 보통). 예전 저장값(문자열: 'attacking', 'high' …)도 그대로 읽는다.
import { buildSlots, layoutShift, ROLE_POS } from './formation.js'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }

const OLD = {
  mentality: { parkbus: 10, defensive: 30, balanced: 50, attacking: 70, allout: 90 },
  pressing: { low: 25, normal: 50, high: 80 },
  line: { low: 25, normal: 50, high: 80 },
  tempo: { slow: 25, normal: 50, fast: 80 },
}
const num = (v, key) => (typeof v === 'number' ? v : OLD[key]?.[v] ?? 50)

// ── 전술 구조 ──
// 감독이 정하는 것은 세 덩어리다:
//   ① 어디에 서나 — 포메이션·드래그 배치(formation.js). 수비 라인 높이와 공격 폭은 여기서 '계산'된다 (따로 고르지 않는다)
//   ② 어떻게 공격하나 — 철학(phil: 점유·균형·역습·직선) + 공격 방향(focus). 철학이 공격 가담·템포·패스 길이의 기본값을 정한다 (세부 조정 가능)
//   ③ 어떻게 뺏나 — 압박 강도(pressing)·태클(tackling)·오프사이드 트랩(trap)
//   경기 중 터치라인 지시는 adj(잠깐 더하는 값)에 따로 쌓인다 → 무엇이 바뀌었는지 보여 주고 한 번에 되돌릴 수 있다
// 엔진이 읽는 값(tacOf 결과)은 예전과 같다. 값이 명시돼 있으면(AI 구단 프리셋·예전 세이브·세부 조정) 그대로, 없으면 철학의 기본값.
export const PHILS = [
  ['possession', '점유', '짧은 패스로 공을 지키며 상대를 끌어낸다. 중원을 잡지만 찬스는 천천히 난다', { approach: 'possession', mentality: 55, tempo: 35, passing: 20, line: 62 }],
  ['balanced', '균형', '상황에 맞춰 짧게도 길게도 푼다', { approach: 'balanced', mentality: 50, tempo: 50, passing: 50, line: 50 }],
  ['counter', '역습', '내려앉아 버티다가 공을 잡으면 빠르게 뒷공간을 찌른다. 공은 덜 갖는다', { approach: 'counter', mentality: 40, tempo: 75, passing: 65, line: 35 }],
  ['direct', '직선', '길게 넘겨 최전방 타깃과 2선 침투로 마무리한다. 공중볼 싸움이 중요하다', { approach: 'balanced', mentality: 55, tempo: 70, passing: 90, line: 45 }],
]
const PHIL_BASE = Object.fromEntries(PHILS.map(([k, , , v]) => [k, v]))
const has = (v) => v !== undefined && v !== null
/** 철학: 저장된 값이 없으면(예전 세이브·AI 프리셋) 공격 방식·패스 길이로 알아낸다 */
export const philOf = (t = {}) => (PHIL_BASE[t.phil] ? t.phil : t.approach === 'possession' ? 'possession' : t.approach === 'counter' ? 'counter' : typeof t.passing === 'number' && t.passing >= 80 ? 'direct' : 'balanced')
/** 세부 조정을 지우는 patch (철학·빠른 설정을 고를 때 같이 쓴다) */
export const TAC_CLEAR = { mentality: null, tempo: null, passing: null, approach: null, line: null, width: null, adj: null }

/** 엔진이 읽는 전술 값 (0~100, 50 = 보통). 예전 저장값(문자열: 'attacking', 'high' …)도 그대로 읽는다 */
export function tacOf(t = {}) {
  const phil = philOf(t)
  const P = PHIL_BASE[phil]
  const adj = t.adj || {}
  const n = (v, key, d) => (has(v) ? num(v, key) : d)
  const c = (v, key) => (adj[key] ? clamp(v + adj[key], 0, 100) : v)
  const press = n(t.pressing, 'pressing', 50)
  return {
    phil,
    mentality: c(n(t.mentality, 'mentality', P.mentality), 'mentality'),
    tempo: c(n(t.tempo, 'tempo', P.tempo), 'tempo'),
    width: c(has(t.width) ? t.width : 50, 'width'), // 드래그 배치의 폭은 edges에서 더해진다
    passing: c(has(t.passing) ? t.passing : P.passing, 'passing'), // 0 짧게 ~ 100 길게(직선적)
    approach: t.approach || P.approach, // possession | balanced | counter
    focus: adj.focus || t.focus || 'mixed', // mixed | wings | center
    press: c(press, 'pressing'),
    // 수비 라인: 명시된 값이 없으면 철학 기본 + 압박 강도 (전방 압박을 하면 블록 전체가 올라간다). 드래그 배치의 높이는 edges에서 더해진다
    line: c(has(t.line) ? num(t.line, 'line') : clamp(P.line + (press - 50) * 0.5, 5, 95), 'line'),
    trap: !!t.trap, // 오프사이드 트랩
    tackling: t.tackling || 'normal', // soft | normal | hard
  }
}

/** 화면 표시용: 드래그 배치까지 더한 수비 라인 높이·공격 폭 (엔진의 edges와 같은 계산) */
export function shapeOf(t = {}, formation = t.formation) {
  const x = tacOf(t)
  const g = layoutShift(formation)
  return { line: clamp(x.line + g.line, 0, 100), width: clamp(x.width + g.width, 0, 100), dragged: !!g.d }
}

/** 빠른 설정 (내 구단용): 예전 스타일 프리셋을 새 구조(철학 + 수비 성향 + 세부 조정)로 옮긴 것 */
export const QUICK_SETUPS = [
  ['gegen', '게겐프레싱', { phil: 'balanced', focus: 'mixed', mentality: 65, tempo: 75, passing: 40, pressing: 90, trap: true, tackling: 'hard' }],
  ['tiki', '점유율 축구', { phil: 'possession', focus: 'center', pressing: 65, trap: false, tackling: 'normal' }],
  ['counter', '역습', { phil: 'counter', focus: 'mixed', pressing: 35, trap: false, tackling: 'normal' }],
  ['wing', '측면 공격', { phil: 'balanced', focus: 'wings', mentality: 60, tempo: 60, pressing: 55, trap: false, tackling: 'normal' }],
  ['route1', '롱볼', { phil: 'direct', focus: 'center', pressing: 45, trap: false, tackling: 'hard' }],
  ['bus', '버스 세우기', { phil: 'counter', focus: 'mixed', mentality: 12, tempo: 30, pressing: 20, trap: false, tackling: 'hard' }],
].map(([k, label, p]) => [k, label, { ...TAC_CLEAR, ...p }])

/**
 * 서로 어긋나는 조합 경고 (고르는 즉시 보여 준다). 드래그 배치까지 더한 값으로 본다
 * @returns [문구…]
 */
export function tacWarnings(t = {}, formation = t.formation) {
  const x = tacOf(t)
  const s = shapeOf(t, formation)
  const out = []
  if (x.approach === 'counter' && s.line >= 65) out.push('역습인데 수비 라인이 높습니다 — 내려앉아야 뒷공간이 생기고, 지금은 우리 뒷공간만 내줍니다')
  if (x.approach === 'counter' && x.tempo <= 35) out.push('역습인데 템포가 느립니다 — 공을 잡은 뒤 빨리 나가지 못하면 역습이 되지 않습니다')
  if (x.approach === 'counter' && x.mentality >= 75) out.push('역습인데 공격 가담이 너무 많습니다 — 다 올라가면 버틸 사람이 없습니다')
  if (x.approach === 'possession' && x.passing >= 70) out.push('점유인데 패스가 깁니다 — 롱볼은 공을 자주 잃어 점유가 되지 않습니다')
  if (x.approach === 'possession' && x.tempo >= 75) out.push('점유인데 템포가 아주 빠릅니다 — 서두르면 패스 실수가 늘어납니다')
  if (x.press >= 75 && s.line <= 35) out.push('전방 압박인데 수비 라인이 낮습니다 — 앞과 뒤 사이가 벌어져 중원이 뚫립니다')
  if (x.press <= 35 && s.line >= 70) out.push('라인은 높은데 압박이 약합니다 — 상대가 편하게 뒷공간으로 공을 넣습니다')
  if (x.trap && s.line <= 40) out.push('오프사이드 트랩은 라인이 높아야 통합니다 — 지금 높이에서는 효과가 거의 없습니다')
  if (x.focus === 'wings' && s.width <= 35) out.push('측면 공격인데 배치가 좁습니다 — 윙어·풀백을 바깥으로 벌려 세우세요')
  if (x.focus === 'center' && s.width >= 75) out.push('중앙 공격인데 배치가 아주 넓습니다 — 중앙에 숫자가 부족합니다')
  if (x.mentality <= 20 && x.press >= 75) out.push('잠그는 운영인데 압박이 아주 강합니다 — 체력만 쓰고 자리를 비우게 됩니다')
  return out
}

// ── 터치라인 지시: 전술값에 잠깐 더하는 값(adj)으로 쌓인다. 저장된 팀 전술은 그대로 ──
export const SHOUTS = [
  ['push', '⚔️ 공격 앞으로', '라인을 올리고 더 많이 공격합니다', { mentality: 20, line: 10 }],
  ['hold', '🛡️ 지키자', '내려앉아 리드를 지킵니다', { mentality: -20, line: -15 }],
  ['press', '🔥 압박 올려', '전방에서 공을 뺏습니다 (체력 소모 ↑)', { pressing: 25 }],
  ['breathe', '😮‍💨 숨 고르기', '압박·템포를 낮춰 체력을 아낍니다', { pressing: -25, tempo: -20 }],
  ['wings', '↔️ 측면으로', '넓게 벌려 측면을 공략합니다', { width: 25, focus: 'wings' }],
  ['direct', '🎯 뒷공간으로', '길고 빠르게 수비 뒤를 노립니다', { passing: 25, tempo: 15 }],
  ['waste', '⏳ 시간 끌기', '템포를 늦추고 볼을 돌립니다', { tempo: -30, mentality: -10, passing: -20 }],
]
const ADJ_LABEL = { mentality: '공격 가담', line: '수비 라인', pressing: '압박', tempo: '템포', width: '공격 폭', passing: '패스 길이' }
const ADJ_MAX = 50
/** 지시 한 번 적용 → 새 전술 (여러 번 누르면 더 세지고, 반대 지시는 서로 지운다) */
export function applyShout(t, key) {
  const d = SHOUTS.find((s) => s[0] === key)?.[3]
  if (!d) return t
  const adj = { ...(t.adj || {}) }
  for (const [k, v] of Object.entries(d)) {
    if (k === 'focus') adj.focus = v
    else { adj[k] = clamp((adj[k] || 0) + v, -ADJ_MAX, ADJ_MAX); if (!adj[k]) delete adj[k] }
  }
  return { ...t, adj: Object.keys(adj).length ? adj : null }
}
/** 지금 걸려 있는 지시 효과 → ['공격 가담 +20', '수비 라인 +10', '측면 집중'] */
export function adjText(t = {}) {
  const adj = t.adj || {}
  return [...Object.entries(ADJ_LABEL).filter(([k]) => adj[k]).map(([k, l]) => `${l} ${adj[k] > 0 ? '+' : ''}${adj[k]}`), ...(adj.focus === 'wings' ? ['측면 집중'] : [])]
}

/** 전술 프리셋 (AI 구단용 — 값이 모두 명시돼 있다. 내 구단 화면은 QUICK_SETUPS를 쓴다) */
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
  return { ...t, corner: ['mixed', 'near', 'far', 'short'][(h >>> 5) % 4], cornerDef: ['zonal', 'man', 'mixed'][(h >>> 9) % 3] }
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
  // 직접 조정한 배치의 수비 라인 높이·폭은 팀 지시(라인·폭)에 더해진다
  const withLayout = (t, f) => { const g = layoutShift(f); return { ...t, line: clamp(t.line + g.line, 0, 100), width: clamp(t.width + g.width, 0, 100) } }
  const a = withLayout(tacOf(me.tac), me.formation)
  const b = withLayout(tacOf(opp.tac), opp.formation)
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
