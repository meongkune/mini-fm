// 팀 지시: ① 어디에 서나(배치에서 계산) ② 어떻게 공격하나(철학) ③ 어떻게 뺏나(수비 성향) + 세트피스
// 전술 화면과 경기 중 전술 변경에서 같이 쓴다. 서로 어긋나는 조합은 고르는 즉시 경고한다
import { PHILS, QUICK_SETUPS, TAC_CLEAR, shapeOf, tacOf, tacWarnings } from '../engine/tactics.js'
import { autoTaker } from '../engine/match.js'

const Slider = ({ label, value, onChange, left, right, hint }) => (
  <label className="tp-slider">
    <span className="tp-row"><b>{label}</b><em>{hint}</em></span>
    <input type="range" min={0} max={100} step={5} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    <span className="tp-ends"><small>{left}</small><small>{right}</small></span>
  </label>
)
const Seg = ({ label, value, options, onChange }) => (
  <div className="tp-seg">
    <b>{label}</b>
    <div className="seg small">{options.map(([k, l]) => <button key={k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>
  </div>
)
const word = (v, words) => words[Math.min(words.length - 1, Math.floor(v / (101 / words.length)))]
const set = (v) => v !== undefined && v !== null

export const CORNER_OPTS = [['mixed', '섞어서'], ['near', '니어 포스트'], ['far', '파 포스트'], ['short', '짧게']]
export const CORNER_DEF_OPTS = [['zonal', '지역 방어'], ['man', '대인 방어'], ['mixed', '혼합']]

/** 배치에서 계산된 값 한 줄 (고르는 값이 아니라 보여 주기만 한다) */
const Readout = ({ label, value, words }) => (
  <div className="tp-read">
    <b>{label}</b>
    <span className="tp-read-bar"><i style={{ left: `${value}%` }} /></span>
    <em>{word(value, words)}</em>
  </div>
)

/** value: 저장된 전술(예전 값도 가능, formation 포함), onChange(patch), players: 키커로 고를 선수(선발 11명) */
export default function TacticsPanel({ value, onChange, compact = false, players = null }) {
  const t = tacOf(value)
  const shape = shapeOf(value)
  const warns = tacWarnings(value)
  const phil = PHILS.find((p) => p[0] === t.phil)
  const tuned = set(value.mentality) && typeof value.mentality === 'number' || set(value.tempo) && typeof value.tempo === 'number' || set(value.passing)
  // 지금 값이 어느 빠른 설정과 같은가 (표시용)
  const quick = QUICK_SETUPS.find(([, , p]) => p.phil === t.phil && (p.focus || 'mixed') === t.focus && p.pressing === t.press && !!p.trap === t.trap && (p.tackling || 'normal') === t.tackling && (p.mentality ?? phil[3].mentality) === t.mentality)?.[0]
  return (
    <div className={`tp ${compact ? 'compact' : ''}`}>
      <div className="tp-presets">
        <span className="muted small">빠른 설정 <em>· 철학과 수비 성향을 한 번에 맞춥니다</em></span>
        <div className="chips-scroll">
          {QUICK_SETUPS.map(([k, label, p]) => <button key={k} className={`chip ${quick === k ? 'on' : ''}`} onClick={() => onChange(p)}>{label}</button>)}
        </div>
      </div>
      {warns.length > 0 && (
        <ul className="tp-warn">
          {warns.map((w) => <li key={w}>⚠️ {w}</li>)}
        </ul>
      )}
      <div className="tp-cols">
        <section>
          <h4>📍 어디에 서나 <span className="muted small">배치에서 계산</span></h4>
          <Readout label="수비 라인" value={shape.line} words={['아주 깊게', '깊게', '보통', '높게', '아주 높게']} />
          <Readout label="공격 폭" value={shape.width} words={['아주 좁게', '좁게', '보통', '넓게', '아주 넓게']} />
          <p className="tp-tip small muted">{shape.dragged ? '자리 조정(드래그)한 배치가 반영된 값입니다.' : '수비 라인은 철학과 압박 강도를 따릅니다.'} 더 올리거나 벌리려면 전술 화면의 <b>📐 자리 조정</b>에서 수비수·윙어 자리를 옮기세요.</p>
        </section>
        <section>
          <h4>⚽ 어떻게 공격하나</h4>
          <Seg label="철학" value={t.phil} onChange={(k) => onChange({ ...TAC_CLEAR, phil: k })} options={PHILS.map(([k, l]) => [k, l])} />
          <p className="tp-tip small muted tp-phil">{phil[2]}.</p>
          <Seg label="공격 방향" value={t.focus} onChange={(v) => onChange({ focus: v })} options={[['mixed', '골고루'], ['wings', '측면'], ['center', '중앙']]} />
          <details className="tp-fine" open={!!tuned}>
            <summary>세부 조정 <span className="muted small">{tuned ? '직접 바꾼 값이 있습니다' : `${phil[1]} 기본값 사용 중`}</span></summary>
            <Slider label="공격 가담" value={t.mentality} onChange={(v) => onChange({ mentality: v })} left="잠그기" right="전원 공격" hint={word(t.mentality, ['잠그기', '수비적', '균형', '공격적', '전원 공격'])} />
            <Slider label="템포" value={t.tempo} onChange={(v) => onChange({ tempo: v })} left="느리게" right="빠르게" hint={word(t.tempo, ['아주 느림', '느림', '보통', '빠름', '아주 빠름'])} />
            <Slider label="패스 길이" value={t.passing} onChange={(v) => onChange({ passing: v })} left="짧게" right="길게(직선적)" hint={word(t.passing, ['아주 짧게', '짧게', '섞어서', '길게', '롱볼'])} />
            {tuned && <button type="button" className="linkish small" onClick={() => onChange({ mentality: null, tempo: null, passing: null })}>↺ {phil[1]} 기본값으로</button>}
          </details>
        </section>
        <section>
          <h4>🛡️ 어떻게 뺏나</h4>
          <Slider label="압박 강도" value={t.press} onChange={(v) => onChange({ pressing: v })} left="물러서기" right="전방 압박" hint={word(t.press, ['거의 안 함', '약하게', '보통', '강하게', '극단적'])} />
          <Seg label="태클" value={t.tackling} onChange={(v) => onChange({ tackling: v })} options={[['soft', '조심'], ['normal', '보통'], ['hard', '거칠게']]} />
          <Seg label="오프사이드 트랩" value={t.trap ? 'on' : 'off'} onChange={(v) => onChange({ trap: v === 'on' })} options={[['off', '안 씀'], ['on', '씀']]} />
          <p className="tp-tip small muted">압박이 강할수록 블록 전체가 올라가고 빨리 지칩니다. 라인이 높으면 상대 역습에 뒷공간이 열립니다.</p>
        </section>
        <SetPieces value={value} onChange={onChange} players={players} />
      </div>
    </div>
  )
}

/** 세트피스: 골의 약 4분의 1이 여기서 나온다 — 약팀이 강팀을 잡는 통로 */
function SetPieces({ value, onChange, players }) {
  const field = (players || []).filter((p) => p && p.pos !== 'GK')
  const auto = { sp: autoTaker(field, 'sp'), pen: autoTaker(field, 'pen') }
  const Taker = ({ label, k, kind }) => (
    <label className="tp-select">
      <b>{label}</b>
      <select value={value[k] && field.some((p) => p.id === value[k]) ? value[k] : ''} onChange={(e) => onChange({ [k]: e.target.value || null })}>
        <option value="">자동{auto[kind] ? ` (${auto[kind].name})` : ''}</option>
        {field.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.pos}</option>)}
      </select>
    </label>
  )
  return (
    <section>
      <h4>🚩 세트피스</h4>
      <Seg label="코너킥 루틴" value={value.corner || 'mixed'} onChange={(v) => onChange({ corner: v })} options={CORNER_OPTS} />
      <Seg label="코너킥 수비" value={value.cornerDef || 'zonal'} onChange={(v) => onChange({ cornerDef: v })} options={CORNER_DEF_OPTS} />
      {field.length > 0 && <Taker label="코너·프리킥 키커" k="spTaker" kind="sp" />}
      {field.length > 0 && <Taker label="페널티킥 키커" k="penTaker" kind="pen" />}
      <p className="tp-tip small muted">니어 포스트는 지역 방어에, 파 포스트는 대인 방어에 강합니다. 짧게 주면 헤더 대신 박스 앞 슈팅. 대인 방어는 공중볼이 강한 수비수가 있을 때 좋습니다.</p>
    </section>
  )
}
