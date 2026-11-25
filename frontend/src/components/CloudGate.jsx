import { useEffect, useState } from 'react'
import { GameProvider } from '../store.jsx'
import { flush, forceMine, leaveSlot, onSession, onSync, openSlot, resetSync, session, setSession, syncState } from '../game/cloud.js'

/**
 * 클라우드 슬롯으로 하고 있으면 시작할 때 서버에서 최신 세이브를 받아 오고,
 * 슬롯을 바꾸면 게임을 새로 띄운다(GameProvider를 다시 만든다).
 * 저장이 막히면(연결 끊김·다른 곳 접속·충돌) 화면을 덮어 진행을 멈춘다 — 서버에 안 올라간 진행이 쌓이지 않게.
 */
export default function CloudGate({ children }) {
  const [sess, setSess] = useState(session)
  const [boot, setBoot] = useState(() => (sess?.token && sess?.slot ? 'loading' : 'ready'))
  const [bootError, setBootError] = useState(null)
  const [mountKey, setMountKey] = useState(0)

  useEffect(() => onSession(() => setSess(session())), [])

  const load = async () => {
    const s = session()
    if (!s?.token || !s?.slot) { setBoot('ready'); return }
    setBoot('loading'); setBootError(null)
    try {
      await openSlot(s.slot)
      resetSync()
      setMountKey((k) => k + 1)
      setBoot('ready')
    } catch (e) {
      setBootError(e)
      setBoot('error')
    }
  }
  useEffect(() => { if (boot === 'loading') load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const key = `${sess?.token && sess?.slot ? `slot${sess.slot}` : 'guest'}-${mountKey}`

  if (boot === 'loading') return <div className="cloud-cover"><div className="card">☁️ 클라우드 세이브를 불러오는 중…</div></div>
  if (boot === 'error') {
    const kicked = bootError?.kind === 'kicked'
    return (
      <div className="cloud-cover">
        <div className="card cloud-box">
          <h3>{kicked ? '다른 곳에서 로그인했습니다' : '클라우드 세이브를 불러오지 못했습니다'}</h3>
          <p className="muted">{kicked ? '마지막으로 로그인한 한 곳에서만 이어서 할 수 있습니다. 여기서 하려면 다시 로그인하세요.' : bootError?.message}</p>
          <div className="row gap">
            {!kicked && <button className="btn" onClick={load}>다시 시도</button>}
            {kicked && <button className="btn" onClick={() => { setSession(null); location.assign(`${import.meta.env.BASE_URL}account`) }}>다시 로그인</button>}
            <button className="btn ghost" onClick={() => { leaveSlot(); setBoot('ready') }}>게스트 세이브로 하기</button>
          </div>
        </div>
      </div>
    )
  }
  return (
    <GameProvider key={key}>
      {children}
      <SyncCover reload={load} />
    </GameProvider>
  )
}

/** 자동 저장 상태에 따라 진행을 막는 덮개 */
function SyncCover({ reload }) {
  const [st, setSt] = useState(syncState)
  useEffect(() => onSync(setSt), [])
  if (st.status === 'offline') {
    return (
      <div className="cloud-cover">
        <div className="card cloud-box">
          <h3>📡 연결이 끊겼습니다</h3>
          <p className="muted">로그인한 게임은 서버에 저장돼야 이어서 진행할 수 있습니다. 연결되면 자동으로 저장하고 이 화면이 사라집니다.</p>
          <p className="small muted">{st.message}</p>
          <button className="btn" onClick={flush}>지금 다시 시도</button>
        </div>
      </div>
    )
  }
  if (st.status === 'kicked') {
    return (
      <div className="cloud-cover">
        <div className="card cloud-box">
          <h3>다른 곳에서 로그인했습니다</h3>
          <p className="muted">마지막으로 로그인한 한 곳에서만 저장됩니다. 여기서 이어서 하려면 다시 로그인하세요. (여기서 마지막으로 한 진행은 저장되지 않았을 수 있습니다)</p>
          <div className="row gap">
            <button className="btn" onClick={() => { setSession(null); resetSync(); location.assign(`${import.meta.env.BASE_URL}account`) }}>다시 로그인</button>
          </div>
        </div>
      </div>
    )
  }
  if (st.status === 'conflict') {
    return (
      <div className="cloud-cover">
        <div className="card cloud-box">
          <h3>다른 곳에서 먼저 저장한 세이브가 있습니다</h3>
          <p className="muted">같은 슬롯을 다른 기기(또는 다른 탭)에서 진행했습니다. 어느 쪽으로 이어서 할까요? 여기 진행으로 덮어쓰면 서버에 있던 세이브는 휴지통에 7일 동안 보관됩니다. 서버 세이브를 불러오면 여기서 저장되지 않은 진행은 사라집니다.</p>
          <div className="row gap">
            <button className="btn" onClick={() => { resetSync(); reload() }}>서버 세이브 불러오기</button>
            <button className="btn ghost" onClick={forceMine}>지금 여기 진행으로 덮어쓰기</button>
          </div>
        </div>
      </div>
    )
  }
  return null
}
