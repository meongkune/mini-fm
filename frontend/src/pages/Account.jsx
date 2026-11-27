import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useGame } from '../store.jsx'
import {
  ago, deleteAccount, listSlots, logout, onSession, onSync, openSlot, restoreTrash, session, startSlot, syncState, toast,
} from '../game/cloud.js'
import { ACCOUNT_SLOT, GoogleLogin, browserSave, gameDetail, gameTitle, progress, summarize } from '../components/StartFlow.jsx'

const daysLeft = (t) => Math.max(0, Math.ceil((t + 7 * 86400000 - Date.now()) / 86400000))

/** 게임 저장: 로그인하면 게임 하나가 계정에 저장된다 */
export default function Account() {
  const [sess, setSess] = useState(session)
  useEffect(() => onSession(() => setSess(session())), [])
  // 로그인했어도 어느 게임으로 할지 정하기 전에는 로그인 화면(고르는 창)을 그대로 둔다
  if (!sess?.token || !sess.slot) return <LoggedOut />
  return <LoggedIn />
}

function LoggedIn() {
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [sync, setSync] = useState(syncState)
  const { data, myTeam } = useGame()
  const navigate = useNavigate()
  useEffect(() => onSync(setSync), [])

  const run = async (f) => {
    setBusy(true); setMsg('')
    try { await f() } catch (e) {
      setMsg(e.kind === 'kicked' ? '다른 기기(또는 다른 브라우저)에서 로그인해서 여기는 로그아웃됐어요. 여기서 하려면 다시 로그인하세요.' : e.message)
      if (e.kind === 'kicked') await logout()
    }
    setBusy(false)
  }
  useEffect(() => { run(async () => setList(await listSlots())) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const b = browserSave()
  const bSum = b && summarize(b, data)
  const saveText = { idle: sync.at ? `✅ 계정에 저장됨 (${ago(sync.at)})` : '✅ 계정에 저장됨', pending: '저장하는 중…', saving: '저장하는 중…', offline: '⚠️ 인터넷이 끊겨 저장을 못 하고 있어요', kicked: '⚠️ 다른 곳에서 로그인했어요', conflict: '⚠️ 다른 곳에서 먼저 저장했어요' }[sync.status]

  const restore = (t) => {
    if (!confirm(`'${gameTitle(t.summary)}' 게임으로 되돌릴까요?\n\n지금 하는 게임(${myTeam?.name || '새 게임'})은 '지난 게임'에 7일 동안 보관돼요.`)) return
    run(async () => {
      await restoreTrash(t.id, ACCOUNT_SLOT)
      await openSlot(ACCOUNT_SLOT)
      toast(`♻️ ${gameTitle(t.summary)} 게임으로 되돌렸어요.`)
      navigate('/')
    })
  }
  const upload = () => {
    if (!confirm(`이 브라우저 게임(${bSum.team})을 계정에 저장하고 이어서 할까요?\n\n지금 계정 게임(${myTeam?.name || '새 게임'})은 '지난 게임'에 7일 동안 보관돼요.`)) return
    run(async () => {
      await startSlot(ACCOUNT_SLOT, b, bSum, true)
      toast(`☁️ ${bSum.team} 게임을 계정에 저장했어요.`)
      navigate('/')
    })
  }
  const trash = list?.trash || []

  return (
    <div className="account">
      <div className="card now-card">
        <span className="eyebrow">지금 하는 게임</span>
        <h2>☁️ {myTeam ? myTeam.name : '새 게임 (팀 고르는 중)'}</h2>
        <p className="now-save">{saveText}</p>
        <p className="muted small">구글 계정에 저장되는 게임이에요. 따로 저장 버튼을 누를 필요 없이 진행할 때마다 자동으로 저장되고, 폰·PC 어디서든 같은 구글 계정으로 로그인하면 이어서 할 수 있어요.</p>
        <button className="btn small" onClick={() => navigate('/')}>게임으로 돌아가기 ▶</button>
        {msg && <p className="cloud-msg">{msg}</p>}
      </div>

      {trash.length > 0 && (
        <div className="card">
          <h3>🗂️ 지난 게임 <small className="muted">새 게임을 시작하거나 바꾸기 전에 하던 게임 · 7일 동안 보관</small></h3>
          {trash.map((t) => (
            <div key={t.id} className="slot-row">
              <div className="slot-info">
                <strong>{gameTitle(t.summary)}</strong>
                <small className="muted">{[gameDetail(t.summary), `${ago(t.deleted_at)}까지 함`, `${daysLeft(t.deleted_at)}일 뒤 삭제`].filter(Boolean).join(' · ')}</small>
              </div>
              <div className="slot-actions">
                <button className="btn small ghost" disabled={busy} onClick={() => restore(t)}>이 게임으로 되돌리기</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {b && (
        <div className="card">
          <h3>💾 이 브라우저 게임</h3>
          <div className="slot-row">
            <div className="slot-info">
              <strong>{gameTitle(bSum)}</strong>
              <small className="muted">{gameDetail(bSum)} — 로그인하기 전에 이 브라우저에서 하던 게임이에요. 로그아웃하면 이 게임을 하게 돼요.</small>
            </div>
            <div className="slot-actions">
              <button className="btn small ghost" disabled={busy} onClick={upload}>이 게임을 계정에 저장</button>
            </div>
          </div>
        </div>
      )}

      <Faq loggedIn />

      <div className="card account-foot">
        <button className="btn ghost" disabled={busy} onClick={() => run(async () => { await logout(); toast('로그아웃했어요. 계정 게임은 다시 로그인하면 이어서 할 수 있어요.') })}>로그아웃</button>
        <span className="grow" />
        <Link to="/privacy" className="small">개인정보 처리방침</Link>
        <button className="linkish small danger" disabled={busy} onClick={() => { if (confirm('계정을 삭제할까요?\n\n계정에 저장된 게임과 지난 게임이 모두 사라지고 되돌릴 수 없어요. (이 브라우저 게임은 남아요)')) run(async () => { await deleteAccount(); toast('계정을 삭제했어요.') }) }}>계정 삭제</button>
      </div>
    </div>
  )
}

function Faq({ loggedIn }) {
  return (
    <details className="card faq">
      <summary>❓ 저장은 어떻게 되나요?</summary>
      <dl>
        <dt>저장 버튼은 어디 있나요?</dt>
        <dd>없어요. 로그인하든 안 하든 진행할 때마다 자동으로 저장돼요. 화면 구석의 {loggedIn ? '☁️ 저장됨' : '💾'} 표시로 확인할 수 있어요.</dd>
        <dt>로그인 안 해도 되나요?</dt>
        <dd>네. 로그인 없이도 끝까지 할 수 있어요. 다만 게임이 이 브라우저에만 저장돼서 다른 기기에서는 이어서 할 수 없고, 브라우저 기록을 지우면 사라질 수 있어요.</dd>
        <dt>다른 기기에서 이어서 하려면?</dt>
        <dd>그 기기에서 같은 구글 계정으로 로그인하면 돼요. 마지막으로 로그인한 한 곳에서만 할 수 있어서, 원래 기기는 자동으로 로그아웃돼요.</dd>
        <dt>새 게임을 시작하면 하던 게임은?</dt>
        <dd>로그인했으면 '지난 게임'에 7일 동안 보관돼서 되돌릴 수 있어요. 로그인 안 했으면 지워져요.</dd>
        <dt>인터넷이 끊기면?</dt>
        <dd>로그인한 게임은 저장이 돼야 진행돼요. 끊기면 화면이 잠깐 멈추고, 연결되면 자동으로 저장한 뒤 다시 할 수 있어요.</dd>
      </dl>
    </details>
  )
}

/** 로그인 전: 지금 어디에 저장되는지 + 로그인하면 뭐가 좋은지 + 구글 로그인 버튼 */
function LoggedOut() {
  const { data } = useGame()
  const navigate = useNavigate()
  const b = browserSave()
  const bSum = b && summarize(b, data)
  return (
    <div className="account">
      <div className="card now-card">
        <span className="eyebrow">지금 하는 게임</span>
        <h2>💾 {bSum ? `${bSum.team} · ${progress(bSum)}` : '아직 시작한 게임이 없어요'}</h2>
        <p className="muted small">{bSum ? '이 게임은 이 브라우저에 자동 저장되고 있어요.' : '게임을 시작하면 이 브라우저에 자동으로 저장돼요.'} 로그인하지 않아도 계속 할 수 있어요.</p>
      </div>

      <div className="card">
        <h3>구글로 로그인하면</h3>
        <div className="compare">
          <div>
            <strong>💾 로그인 안 하면</strong>
            <ul className="small">
              <li>이 기기·이 브라우저에서만 할 수 있어요</li>
              <li>브라우저 기록을 지우면 게임이 사라질 수 있어요</li>
            </ul>
          </div>
          <div className="good">
            <strong>☁️ 로그인하면</strong>
            <ul className="small">
              <li>폰·PC 어디서든 이어서 할 수 있어요</li>
              <li>게임이 계정에 저장돼서 잃어버리지 않아요</li>
              <li>새 게임을 시작해도 하던 게임을 7일 동안 보관해요</li>
            </ul>
          </div>
        </div>
        <GoogleLogin onDone={() => navigate('/')} />
        <p className="small muted">
          새 비밀번호를 만들 필요 없어요. 이메일·이름·사진은 저장하지 않고, 구글 계정을 알아볼 수 없게 바꾼 번호와 게임만 저장해요.
          {bSum && ' 로그인하면 하던 게임이 그대로 계정에 저장돼요.'} · <Link to="/privacy">개인정보 처리방침</Link>
        </p>
      </div>
      <Faq />
    </div>
  )
}
