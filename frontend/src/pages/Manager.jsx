// 감독 프로필: VRoid Studio로 만든 VRM 3D 감독 (파일은 이 브라우저에만 저장)
import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteVrm, loadVrm, saveVrm } from '../components/vrmStore.js'
import { useGame } from '../store.jsx'

const ManagerVRM = lazy(() => import('../components/ManagerVRM.jsx'))

export default function Manager() {
  const { manager, saveManager, myTeam, save } = useGame()
  const navigate = useNavigate()
  const view = useRef(null)
  const fileRef = useRef(null)
  const [buffer, setBuffer] = useState(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState(manager?.name || '')
  const [framing, setFraming] = useState('full')
  const [msg, setMsg] = useState('')
  const teamColor = myTeam?.color || '#7c5cff'
  const history = save.history || []
  const titles = history.filter((h) => h.pos === 1).length

  useEffect(() => { loadVrm().then((b) => { setBuffer(b || null); setLoading(false) }) }, [])

  const onFile = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!/\.vrm$/i.test(f.name)) { setMsg('.vrm 파일만 올릴 수 있습니다.'); return }
    if (f.size > 80 * 1024 * 1024) { setMsg('파일이 너무 큽니다 (80MB 이하).'); return }
    const buf = await f.arrayBuffer()
    try { await saveVrm(buf) } catch { setMsg('브라우저 저장 공간이 부족해 기억하지 못했습니다. (이번 화면에서는 보입니다)') }
    setBuffer(buf)
    setMsg(`${f.name} (${(f.size / 1024 / 1024).toFixed(1)}MB)을 불러왔습니다.`)
    e.target.value = ''
  }
  const remove = async () => {
    if (!confirm('올린 VRM 감독을 지울까요?')) return
    await deleteVrm()
    setBuffer(null)
  }
  const done = () => {
    const thumb = (buffer && view.current?.capture?.(160)) || manager?.thumb || null
    saveManager({ ...(manager || {}), name: name.trim() || '무명 감독', thumb, vrm: !!buffer })
    navigate('/')
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>{manager ? '감독 프로필' : '감독 만들기'}</h1>
          <p className="muted">VRoid Studio로 만든 내 감독을 3D로 세웁니다.</p>
        </div>
      </div>

      <div className="card mgr-stage" style={{ '--c': teamColor }}>
        {loading ? <div className="mgr3d loading" style={{ height: 380 }}>불러오는 중…</div> : buffer ? (
          <>
            <Suspense fallback={<div className="mgr3d loading" style={{ height: 380 }}>3D 감독 불러오는 중…</div>}>
              <ManagerVRM ref={view} buffer={buffer} teamColor={teamColor} height={380} framing={framing} />
            </Suspense>
            <div className="mgr-tools">
              <button className="chip" onClick={() => view.current?.turn(-0.8)}>⟲</button>
              <button className={`chip ${framing === 'full' ? 'on' : ''}`} onClick={() => setFraming('full')}>전신</button>
              <button className={`chip ${framing === 'bust' ? 'on' : ''}`} onClick={() => setFraming('bust')}>상반신</button>
              <button className="chip" onClick={() => view.current?.wave()}>👋 인사</button>
              <button className="chip" onClick={() => view.current?.turn(0.8)}>⟳</button>
            </div>
          </>
        ) : (
          <div className="vrm-empty">
            {manager?.thumb ? <img className="mgr-thumb" src={manager.thumb} alt="" width={96} height={96} /> : <span className="mgr-ghost big">👔</span>}
            <p>아직 3D 감독이 없습니다. 아래 순서대로 VRoid Studio에서 만들어 올려 주세요.</p>
          </div>
        )}
        <input className="mgr-name" value={name} maxLength={16} placeholder="감독 이름" onChange={(e) => setName(e.target.value)} />
        <span className="muted small">{myTeam ? `${myTeam.name} 감독 겸 구단주` : '아직 맡은 팀 없음'}{history.length ? ` · ${history.length}시즌 · 우승 ${titles}회` : ''}</span>
        <div className="row">
          <button className="btn small" onClick={() => fileRef.current?.click()}>{buffer ? '다른 VRM 올리기' : '📁 VRM 파일 올리기'}</button>
          {buffer && <button className="btn ghost small" onClick={remove}>지우기</button>}
        </div>
        <input ref={fileRef} type="file" accept=".vrm" hidden onChange={onFile} />
        {msg && <p className="small notice">{msg}</p>}
      </div>

      <div className="card vrm-guide">
        <h3>VRoid Studio로 감독 만들기</h3>
        <ol>
          <li><a className="link" href="https://vroid.com/studio" target="_blank" rel="noreferrer">vroid.com/studio</a>에서 <b>VRoid Studio</b>(무료, Windows·Mac)를 설치합니다.</li>
          <li><b>새로 만들기 → 남성(또는 여성)</b>을 고르고 얼굴·헤어·체형을 세밀하게 다듬습니다. 수염은 얼굴 텍스처에 직접 그릴 수 있습니다.</li>
          <li><b>의상</b> 탭에서 정장·셔츠·코트 등을 고르고 색을 바꿉니다.</li>
          <li>오른쪽 위 <b>공유(촬영·내보내기) → VRM 내보내기</b>를 눌러 .vrm 파일로 저장합니다 (보통 10~30MB).</li>
          <li>여기서 <b>VRM 파일 올리기</b>를 누릅니다. 휴대폰에서 하려면 파일을 폰으로 옮긴 뒤 올리면 됩니다.</li>
        </ol>
        <p className="small muted">올린 파일은 서버로 보내지 않고 이 브라우저에만 저장됩니다. 다른 기기에서는 다시 올려야 합니다.</p>
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
