// 감독 프로필: 이름과 커리어
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MgrBadge from '../components/MgrBadge.jsx'
import { useGame } from '../store.jsx'

export default function Manager() {
  const { manager, saveManager, myTeam, save } = useGame()
  const navigate = useNavigate()
  const [name, setName] = useState(manager?.name || '')
  const teamColor = myTeam?.color || '#7c5cff'
  const history = save.history || []
  const titles = history.filter((h) => h.pos === 1).length

  const done = () => {
    saveManager({ name: name.trim() || '무명 감독' })
    navigate('/')
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>{manager ? '감독 프로필' : '감독 등록'}</h1>
          <p className="muted">구단을 이끌 감독 겸 구단주의 이름을 정하세요.</p>
        </div>
      </div>

      <div className="card mgr-stage" style={{ '--c': teamColor }}>
        <MgrBadge name={name} color={teamColor} size={88} />
        <input className="mgr-name" value={name} maxLength={16} placeholder="감독 이름" onChange={(e) => setName(e.target.value)} />
        <span className="muted small">{myTeam ? `${myTeam.name} 감독 겸 구단주` : '아직 맡은 팀 없음'}{history.length ? ` · ${history.length}시즌 · 우승 ${titles}회` : ''}</span>
      </div>

      <button className="btn wide" onClick={done}>{manager ? '저장' : '감독 등록 →'}</button>

      {history.length > 0 && (
        <div className="card">
          <h3>감독 커리어</h3>
          <ul className="history">
            {history.map((h) => <li key={h.seasonNo}><span>{h.label}</span><b>{h.pos}위</b>{h.pos === 1 && <small>🏆 우승</small>}</li>)}
          </ul>
        </div>
      )}
    </section>
  )
}
