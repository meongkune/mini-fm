// 팀 지시 (FM식): 스타일 프리셋 + 공격 시 · 수비 시 세부 지시. 전술 화면과 경기 중 전술 변경에서 같이 쓴다
import { TAC_PRESETS, styleName, tacOf } from '../engine/tactics.js'
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

export const CORNER_OPTS = [['mixed', '섞어서'], ['near', '니어 포스트'], ['far', '파 포스트'], ['short', '짧게']]
export const CORNER_DEF_OPTS = [['zonal', '지역 방어'], ['man', '대인 방어'], ['mixed', '혼합']]

/** value: 저장된 전술(예전 문자열 값도 가능), onChange(patch), players: 키커로 고를 선수(선발 11명) */
export default function TacticsPanel({ value, onChange, compact = false, players = null }) {
  const t = tacOf(value)
  const set = (k) => (v) => onChange({ [k]: v })
  return (
    <div className={`tp ${compact ? 'compact' : ''}`}>
      <div className="tp-presets">
        <span className="muted small">스타일: <b className="tp-style">{styleName(value)}</b></span>
        <div className="chips-scroll">
          {TAC_PRESETS.map(([k, label, p]) => <button key={k} className={`chip ${styleName(value) === label ? 'on' : ''}`} onClick={() => onChange(p)}>{label}</button>)}
        </div>
      </div>
      <div className="tp-cols">
        <section>
          <h4>⚽ 공격 시</h4>
          <Slider label="운영 성향" value={t.mentality} onChange={set('mentality')} left="버스 세우기" right="노빠꾸" hint={word(t.mentality, ['버스 세우기', '수비적', '균형', '공격적', '노빠꾸'])} />
          <Slider label="템포" value={t.tempo} onChange={set('tempo')} left="느리게" right="빠르게" hint={word(t.tempo, ['아주 느림', '느림', '보통', '빠름', '아주 빠름'])} />
          <Slider label="공격 폭" value={t.width} onChange={set('width')} left="좁게" right="넓게" hint={word(t.width, ['아주 좁게', '좁게', '보통', '넓게', '아주 넓게'])} />
          <Slider label="패스 길이" value={t.passing} onChange={set('passing')} left="짧게" right="길게(직선적)" hint={word(t.passing, ['아주 짧게', '짧게', '섞어서', '길게', '롱볼'])} />
          <Seg label="공격 방식" value={t.approach} onChange={set('approach')} options={[['possession', '점유'], ['balanced', '균형'], ['counter', '역습']]} />
          <Seg label="공격 방향" value={t.focus} onChange={set('focus')} options={[['mixed', '골고루'], ['wings', '측면'], ['center', '중앙']]} />
        </section>
        <section>
          <h4>🛡️ 수비 시</h4>
          <Slider label="수비 라인" value={t.line} onChange={set('line')} left="깊게" right="높게" hint={word(t.line, ['아주 깊게', '깊게', '보통', '높게', '아주 높게'])} />
          <Slider label="압박 강도" value={t.press} onChange={(v) => onChange({ pressing: v })} left="물러서기" right="전방 압박" hint={word(t.press, ['거의 안 함', '약하게', '보통', '강하게', '극단적'])} />
          <Seg label="태클" value={t.tackling} onChange={set('tackling')} options={[['soft', '조심'], ['normal', '보통'], ['hard', '거칠게']]} />
          <Seg label="오프사이드 트랩" value={t.trap ? 'on' : 'off'} onChange={(v) => onChange({ trap: v === 'on' })} options={[['off', '안 씀'], ['on', '씀']]} />
          <p className="tp-tip small muted">압박·템포가 높을수록 빨리 지칩니다. 라인을 올리면 상대 역습에 뒷공간이 열립니다.</p>
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
