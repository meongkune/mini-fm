import { Suspense, lazy, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BEARDS_3D, BOTTOM_COLORS, GLASSES_3D, HAIRS_3D, HAIR_COLORS_3D, OUTFITS_3D, SKINS_3D, TIE_COLORS, TOP_COLORS, randomLook3D, toLook3D } from '../components/managerLook.js'
import { useGame } from '../store.jsx'

// three.js는 이 화면에서만 필요하므로 따로 불러온다 (첫 화면 로딩을 가볍게)
const Manager3D = lazy(() => import('../components/Manager3D.jsx'))

const TABS = [['face', '얼굴'], ['hair', '헤어'], ['body', '체형'], ['outfit', '의상']]

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
function Slider({ label, value, min, max, onChange, left, right }) {
  return (
    <label className="look-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step="0.01" value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <small><em>{left}</em><em>{right}</em></small>
    </label>
  )
}

export default function Manager() {
  const { manager, saveManager, myTeam, save } = useGame()
  const navigate = useNavigate()
  const view = useRef(null)
  const [look, setLook] = useState(() => (manager?.look ? toLook3D(manager.look) : randomLook3D()))
  const [name, setName] = useState(manager?.name || '')
  const [tab, setTab] = useState('face')
  const [framing, setFraming] = useState('full')
  const teamColor = myTeam?.color || '#7c5cff'
  const set = (patch) => setLook((l) => ({ ...l, ...patch, v: 3 }))
  const history = save.history || []
  const titles = history.filter((h) => h.pos === 1).length

  const done = () => {
    const thumb = view.current?.capture?.(160) || manager?.thumb || null
    saveManager({ name: name.trim() || '무명 감독', look: { ...look, v: 3 }, thumb })
    navigate('/')
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>{manager ? '감독 프로필' : '감독 만들기'}</h1>
          <p className="muted">끌어서 돌려 보고, 얼굴·헤어·체형·의상을 고르세요.</p>
        </div>
      </div>

      <div className="card mgr-stage" style={{ '--c': teamColor }}>
        <Suspense fallback={<div className="mgr3d loading" style={{ height: 340 }}>3D 감독 불러오는 중…</div>}>
          <Manager3D ref={view} look={look} teamColor={teamColor} height={340} framing={framing} />
        </Suspense>
        <div className="mgr-tools">
          <button className="chip" onClick={() => view.current?.turn(-0.8)}>⟲</button>
          <button className={`chip ${framing === 'full' ? 'on' : ''}`} onClick={() => setFraming('full')}>전신</button>
          <button className={`chip ${framing === 'bust' ? 'on' : ''}`} onClick={() => setFraming('bust')}>상반신</button>
          <button className="chip" onClick={() => view.current?.wave()}>👋 인사</button>
          <button className="chip" onClick={() => view.current?.turn(0.8)}>⟳</button>
        </div>
        <input className="mgr-name" value={name} maxLength={16} placeholder="감독 이름" onChange={(e) => setName(e.target.value)} />
        <span className="muted small">{myTeam ? `${myTeam.name} 감독` : '아직 맡은 팀 없음'}{history.length ? ` · ${history.length}시즌 · 우승 ${titles}회` : ''}</span>
        <button className="btn ghost small" onClick={() => setLook(randomLook3D())}>🎲 랜덤</button>
      </div>

      <div className="seg">
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      <div className="card look-panel">
        {tab === 'face' && (<>
          <h4>피부</h4><Swatches colors={SKINS_3D} value={look.skin} onChange={(skin) => set({ skin })} />
          <h4>수염</h4><Chips options={BEARDS_3D} value={look.beard} onChange={(beard) => set({ beard })} />
          <h4>안경</h4><Chips options={GLASSES_3D} value={look.glasses} onChange={(glasses) => set({ glasses })} />
        </>)}
        {tab === 'hair' && (<>
          <h4>헤어스타일</h4><Chips options={HAIRS_3D} value={look.hair} onChange={(hair) => set({ hair })} />
          <h4>머리·수염 색</h4><Swatches colors={HAIR_COLORS_3D} value={look.hairColor} onChange={(hairColor) => set({ hairColor })} />
        </>)}
        {tab === 'body' && (<>
          <Slider label="키" value={look.height} min={0.9} max={1.1} left="작게" right="크게" onChange={(height) => set({ height })} />
          <Slider label="체격" value={look.build} min={0.85} max={1.3} left="마름" right="건장" onChange={(build) => set({ build })} />
          <Slider label="머리 크기" value={look.headSize} min={0.9} max={1.12} left="작게" right="크게" onChange={(headSize) => set({ headSize })} />
        </>)}
        {tab === 'outfit' && (<>
          <h4>의상</h4><Chips options={OUTFITS_3D} value={look.outfit} onChange={(outfit) => set({ outfit })} />
          <h4>상의 색</h4><Swatches colors={TOP_COLORS} value={look.top} onChange={(top) => set({ top })} teamColor={teamColor} />
          <h4>하의 색</h4><Swatches colors={BOTTOM_COLORS} value={look.bottom} onChange={(bottom) => set({ bottom })} teamColor={teamColor} />
          {look.outfit === 'suit' && (<><h4>넥타이</h4><Swatches colors={TIE_COLORS} value={look.tie} onChange={(tie) => set({ tie })} teamColor={teamColor} /></>)}
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
      <p className="muted small">3D 모델: Quaternius "Ultimate Modular Men Pack" (CC0)</p>
    </section>
  )
}
