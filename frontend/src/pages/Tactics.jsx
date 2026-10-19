import { api } from '../api.js'
import { formationNeeds, useGame } from '../store.jsx'
import NeedTeam from './NeedTeam.jsx'

export const MENTALITY = [
  ['defensive', '🛡️ 수비적', '실점은 줄이고 역습을 노립니다'],
  ['balanced', '⚖️ 균형', '공수 밸런스를 유지합니다'],
  ['attacking', '🔥 공격적', '득점력이 오르지만 뒷공간이 열립니다'],
]
export const PRESSING = [
  ['low', '낮음', '체력 소모가 적습니다'],
  ['normal', '보통', '기본 압박'],
  ['high', '강함', '점유율이 오르지만 후반에 지칩니다'],
]
const FORMATION_DESC = {
  '4-4-2': '가장 기본적인 균형형',
  '4-3-3': '공격수 3명으로 공격력 강화, 중원은 약간 약해짐',
  '3-5-2': '중원 장악에 유리, 수비 뒷공간 주의',
  '5-3-2': '수비 강화형, 득점력은 낮아짐',
}

export function Pitch({ team, lineup, formation }) {
  const byId = Object.fromEntries(team.players.map((p) => [p.id, p]))
  const xi = lineup.map((id) => byId[id]).filter(Boolean)
  const rows = ['FW', 'MF', 'DF', 'GK'].map((pos) => xi.filter((p) => p.pos === pos))
  return (
    <div className="pitch" aria-label={`${formation} 포메이션`}>
      {rows.map((row, i) => (
        <div key={i} className="pitch-row">
          {row.map((p) => (
            <div key={p.id} className="dot" style={{ '--c': team.color }}>
              <span>{p.number}</span>
              <small>{p.name}</small>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function OptionGroup({ options, value, onChange, cols }) {
  return (
    <div className="options" style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}>
      {options.map(([key, label, desc]) => (
        <button key={key} className={`option ${value === key ? 'on' : ''}`} onClick={() => onChange(key)}>
          <strong>{label}</strong>
          <span className="small muted">{desc}</span>
        </button>
      ))}
    </div>
  )
}

export default function Tactics() {
  const { data, myTeam, save, update } = useGame()
  if (!myTeam) return <NeedTeam />

  const changeFormation = async (formation) => {
    // 포메이션을 바꾸면 그에 맞는 베스트 11로 자동 재선발
    const { lineup } = await api.autoLineup(myTeam.id, formation)
    update({ formation, lineup })
  }
  const needs = formationNeeds(save.formation)

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>전술</h1>
          <p className="muted">포메이션을 바꾸면 그에 맞게 선발이 자동으로 다시 짜입니다. 세부 선발은 스쿼드에서 조정하세요.</p>
        </div>
      </div>
      <div className="tactics-layout">
        <div className="card">
          <h3>포메이션</h3>
          <OptionGroup
            options={data.formations.map((f) => [f, f, FORMATION_DESC[f]])}
            value={save.formation}
            onChange={changeFormation}
            cols={2}
          />
          <h3>경기 운영</h3>
          <OptionGroup options={MENTALITY} value={save.mentality} onChange={(mentality) => update({ mentality })} />
          <h3>압박 강도</h3>
          <OptionGroup options={PRESSING} value={save.pressing} onChange={(pressing) => update({ pressing })} />
        </div>
        <div className="card">
          <h3>{save.formation} <span className="muted small">DF {needs.DF} · MF {needs.MF} · FW {needs.FW}</span></h3>
          <Pitch team={myTeam} lineup={save.lineup} formation={save.formation} />
        </div>
      </div>
    </section>
  )
}
