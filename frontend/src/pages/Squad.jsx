import { useState } from 'react'
import { api } from '../api.js'
import { formationNeeds, playerOvr, useGame } from '../store.jsx'
import NeedTeam from './NeedTeam.jsx'

const POS_LABEL = { GK: '골키퍼', DF: '수비수', MF: '미드필더', FW: '공격수' }

function Bar({ value }) {
  return (
    <span className="bar"><span style={{ width: `${value}%` }} /><em>{value}</em></span>
  )
}

export default function Squad() {
  const { myTeam, save, update } = useGame()
  const [msg, setMsg] = useState('')
  if (!myTeam) return <NeedTeam />

  const needs = formationNeeds(save.formation)
  const selected = new Set(save.lineup)
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 }
  myTeam.players.forEach((p) => { if (selected.has(p.id)) counts[p.pos]++ })
  const ok = save.lineup.length === 11 && Object.keys(needs).every((k) => counts[k] === needs[k])

  const toggle = (p) => {
    if (selected.has(p.id)) update({ lineup: save.lineup.filter((id) => id !== p.id) })
    else if (save.lineup.length >= 11) setMsg('선발은 11명까지입니다. 먼저 다른 선수를 빼세요.')
    else update({ lineup: [...save.lineup, p.id] })
  }

  const auto = async () => {
    const { lineup } = await api.autoLineup(myTeam.id, save.formation)
    update({ lineup })
    setMsg(`${save.formation}에 맞춰 베스트 11을 자동 선발했습니다.`)
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>스쿼드</h1>
          <p className="muted">선수를 눌러 선발(11명)에 넣거나 뺍니다. 포메이션 {save.formation} 기준</p>
        </div>
        <button className="btn" onClick={auto}>⚡ 자동 선발</button>
      </div>

      <div className={`card lineup-status ${ok ? 'ok' : 'warn'}`}>
        <strong>선발 {save.lineup.length} / 11</strong>
        {Object.entries(needs).map(([pos, n]) => (
          <span key={pos} className={counts[pos] === n ? 'ok' : 'warn'}>{pos} {counts[pos]}/{n}</span>
        ))}
        <span className="small">{ok ? '✅ 포메이션에 맞는 라인업입니다' : '⚠️ 포지션이 맞지 않으면 경기력이 떨어집니다'}</span>
      </div>
      {msg && <p className="toast" onAnimationEnd={() => setMsg('')}>{msg}</p>}

      {['GK', 'DF', 'MF', 'FW'].map((pos) => (
        <div key={pos} className="card">
          <h3>{POS_LABEL[pos]}</h3>
          <table className="players">
            <thead>
              <tr><th></th><th>#</th><th>이름</th><th>나이</th><th>OVR</th><th>공격</th><th>수비</th><th>체력</th></tr>
            </thead>
            <tbody>
              {myTeam.players.filter((p) => p.pos === pos).map((p) => (
                <tr key={p.id} className={selected.has(p.id) ? 'picked' : ''} onClick={() => toggle(p)}>
                  <td>{selected.has(p.id) ? '✅' : '⬜'}</td>
                  <td>{p.number}</td>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.age}</td>
                  <td><span className="ovr-pill">{playerOvr(p)}</span></td>
                  <td><Bar value={p.att} /></td>
                  <td><Bar value={p.def} /></td>
                  <td><Bar value={p.sta} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  )
}
