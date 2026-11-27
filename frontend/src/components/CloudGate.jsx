import { useEffect, useState } from 'react'
import { GameProvider } from '../store.jsx'
import { ago, flush, forceMine, onSession, onSync, onToast, openSlot, resetSync, session, setSession, syncState, toast } from '../game/cloud.js'

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

  const key = `${sess?.token && sess?.slot ? `slot${sess.slot}-${sess.gen || 0}` : 'guest'}-${mountKey}` // 슬롯을 다시 받으면(gen) 게임을 새로 띄운다

  if (boot === 'loading') return <div className="cloud-cover"><div className="card">☁️ 계정에 저장된 게임을 불러오는 중…</div></div>
  if (boot === 'error') {
    const kicked = bootError?.kind === 'kicked'
    return (
      <div className="cloud-cover">
        <div className="card cloud-box">
          <h3>{kicked ? '다른 곳에서 로그인해서 여기는 로그아웃됐어요' : '계정에 저장된 게임을 불러오지 못했어요'}</h3>
          <p className="muted">{kicked ? '계정 게임은 마지막으로 로그인한 한 곳에서만 할 수 있어요. 여기서 하려면 다시 로그인하세요. 저장된 게임은 그대로 있어요.' : `${bootError?.message} 인터넷 연결을 확인하고 다시 시도하세요.`}</p>
          <div className="row gap">
            {!kicked && <button className="btn" onClick={load}>다시 시도</button>}
            {kicked && <button className="btn" onClick={() => { setSession(null); location.assign(`${import.meta.env.BASE_URL}account`) }}>다시 로그인</button>}
            <button className="btn ghost" onClick={() => { setSession(null); setBoot('ready'); setTimeout(() => toast('💾 로그아웃하고 이 브라우저 게임으로 시작했어요.'), 50) }}>로그인 없이 이 브라우저 게임 하기</button>
          </div>
        </div>
      </div>
    )
  }
  return (
    <>
      <GameProvider key={key}>
        {children}
        <SyncCover reload={load} />
      </GameProvider>
      <Toast />
    </>
  )
}

/** 잠깐 떴다 사라지는 안내 (예: '1번 칸에 새 게임을 만들었어요') */
function Toast() {
  const [text, setText] = useState('')
  useEffect(() => {
    let t
    const off = onToast((m) => { setText(m); clearTimeout(t); t = setTimeout(() => setText(''), 6000) })
    return () => { off(); clearTimeout(t) }
  }, [])
  if (!text) return null
  return <div className="toast" role="status" onClick={() => setText('')}>{text}</div>
}

/** 자동 저장이 막히면 진행을 멈추는 덮개 */
function SyncCover({ reload }) {
  const [st, setSt] = useState(syncState)
  useEffect(() => onSync(setSt), [])
  if (st.status === 'offline') {
    return (
      <div className="cloud-cover">
        <div className="card cloud-box">
          <h3>📡 인터넷 연결이 끊겼어요</h3>
          <p>계정에 저장하는 게임이라, 저장이 될 때까지 잠깐 멈춥니다. 연결이 돌아오면 <b>자동으로 저장하고 이 창이 사라져요</b>.</p>
          <p className="small muted">{st.at ? `마지막으로 저장된 때: ${ago(st.at)} — 그때까지의 진행은 안전해요.` : ''} ({st.message})</p>
          <button className="btn" onClick={flush}>지금 다시 시도</button>
        </div>
      </div>
    )
  }
  if (st.status === 'kicked') {
    return (
      <div className="cloud-cover">
        <div className="card cloud-box">
          <h3>다른 곳에서 로그인해서 여기는 로그아웃됐어요</h3>
          <p>계정 게임은 마지막으로 로그인한 한 곳(기기·브라우저)에서만 할 수 있어요. 여기서 계속하려면 다시 로그인하세요.</p>
          <p className="small muted">여기서 방금 한 진행 중 일부는 저장되지 않았을 수 있어요.</p>
          <div className="row gap">
            <button className="btn" onClick={() => { setSession(null); resetSync(); location.assign(`${import.meta.env.BASE_URL}account`) }}>다시 로그인하기</button>
          </div>
        </div>
      </div>
    )
  }
  if (st.status === 'conflict') {
    return (
      <div className="cloud-cover">
        <div className="card cloud-box">
          <h3>이 게임을 다른 곳에서도 진행했어요</h3>
          <p>같은 계정 게임을 다른 기기(또는 다른 탭)에서 먼저 저장했어요. 어느 쪽으로 이어서 할지 골라 주세요.</p>
          <ul className="small">
            <li><b>다른 곳 진행 불러오기</b> — 여기서 저장 안 된 진행은 사라져요.</li>
            <li><b>여기 진행으로 계속하기</b> — 다른 곳 진행은 '지난 게임'에 7일 동안 보관돼요.</li>
          </ul>
          <div className="row gap">
            <button className="btn" onClick={() => { resetSync(); reload() }}>다른 곳 진행 불러오기</button>
            <button className="btn ghost" onClick={forceMine}>여기 진행으로 계속하기</button>
          </div>
        </div>
      </div>
    )
  }
  return null
}
