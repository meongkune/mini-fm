import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ManagerAvatar, { BEARDS, FACES, GLASSES, HAIRS, HAIR_COLORS, OUTFITS, OUTFIT_COLORS, SKINS, TIES, randomLook } from '../components/ManagerAvatar.jsx'
import { useGame } from '../store.jsx'

const TABS = [['face', '얼굴'], ['hair', '헤어'], ['beard', '수염'], ['glasses', '안경'], ['outfit', '의상']]

function Chips({ options, value, onChange }) {
  return (
    <div className="look-chips">
      {options.map(([k, label]) => <button key={k} className={`chip ${value === k ? 'on' : ''}`} onClick={() => onChange(k)}>{label}</button>)}
    </div>
  )
}
function Swatches({ colors, value, onChange, teamColor }) {
  return (
    <div className="swatches">
      {colors.map((c) => {
        const [k, label] = Array.isArray(c) ? c : [c, '']
        const col = k === 'team' ? teamColor : k
        return <button key={k} className={`sw ${value === k ? 'on' : ''}`} style={{ background: col }} title={label} aria-label={label || col} onClick={() => onChange(k)}>{k === 'team' ? '팀' : ''}</button>
      })}
    </div>
  )
}

export default function Manager() {
  const { manager, saveManager, myTeam, save } = useGame()
  const navigate = useNavigate()
  const [look, setLook] = useState(manager?.look || randomLook())
  const [name, setName] = useState(manager?.name || '')
  const [tab, setTab] = useState('face')
  const teamColor = myTeam?.color || '#7c5cff'
  const set = (patch) => setLook((l) => ({ ...l, ...patch }))
  const history = save.history || []
  const titles = history.filter((h) => h.pos === 1).length

  const done = () => {
    saveManager({ name: name.trim() || '무명 감독', look })
    navigate('/')
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>{manager ? '감독 프로필' : '감독 만들기'}</h1>
          <p className="muted">벤치에 설 나만의 감독을 꾸미세요.</p>
        </div>
      </div>

      <div className="card mgr-stage" style={{ '--c': teamColor }}>
        <ManagerAvatar look={look} teamColor={teamColor} size={150} />
        <input className="mgr-name" value={name} maxLength={16} placeholder="감독 이름" onChange={(e) => setName(e.target.value)} />
        <span className="muted small">{myTeam ? `${myTeam.name} 감독` : '아직 맡은 팀 없음'}{history.length ? ` · ${history.length}시즌 · 우승 ${titles}회` : ''}</span>
        <button className="btn ghost small" onClick={() => setLook(randomLook())}>🎲 랜덤</button>
      </div>

      <div className="seg">
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      <div className="card look-panel">
        {tab === 'face' && (<>
          <h4>피부</h4><Swatches colors={SKINS} value={look.skin} onChange={(skin) => set({ skin })} />
          <h4>표정</h4><Chips options={FACES} value={look.face} onChange={(face) => set({ face })} />
        </>)}
        {tab === 'hair' && (<>
          <h4>헤어스타일</h4><Chips options={HAIRS} value={look.hair} onChange={(hair) => set({ hair })} />
          <h4>머리 색</h4><Swatches colors={HAIR_COLORS} value={look.hairColor} onChange={(hairColor) => set({ hairColor })} />
        </>)}
        {tab === 'beard' && (<>
          <h4>수염</h4><Chips options={BEARDS} value={look.beard} onChange={(beard) => set({ beard })} />
          <p className="small muted">수염 색은 머리 색을 따라갑니다.</p>
        </>)}
        {tab === 'glasses' && (<>
          <h4>안경</h4><Chips options={GLASSES} value={look.glasses} onChange={(glasses) => set({ glasses })} />
        </>)}
        {tab === 'outfit' && (<>
          <h4>의상</h4><Chips options={OUTFITS} value={look.outfit} onChange={(outfit) => set({ outfit })} />
          <h4>의상 색</h4><Swatches colors={OUTFIT_COLORS} value={look.outfitColor} onChange={(outfitColor) => set({ outfitColor })} teamColor={teamColor} />
          {look.outfit === 'suit' && (<><h4>넥타이</h4><Swatches colors={TIES} value={look.tie} onChange={(tie) => set({ tie })} teamColor={teamColor} /></>)}
        </>)}
      </div>

      <button className="btn wide" onClick={done}>{manager ? '저장' : '감독 등록 →'}</button>

      {history.length > 0 && (
        <div className="card">
          <h3>감독 커리어</h3>
          <ul className="history">
            {history.map((h) => <li key={h.seasonNo}><span>{h.label}</span><b>{h.pos}위</b><em className={h.success ? 'ok' : 'bad'}>{h.success ? '목표 달성' : '미달'}</em>{h.pos === 1 && <small>🏆 우승</small>}</li>)}
          </ul>
        </div>
      )}
    </section>
  )
}
