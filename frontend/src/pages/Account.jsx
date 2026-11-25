import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { GUEST_KEY, emptySave, useGame } from '../store.jsx'
import {
  GOOGLE_CLIENT_ID, SLOTS_MAX, ago, deleteAccount, deleteSlot, leaveSlot, listSlots, loadGoogle, login, logout,
  onSession, onSync, openSlot, restoreTrash, session, startSlot, summaryOf, syncState, toast,
} from '../game/cloud.js'

// 이 화면의 말: 슬롯 → '칸', 게스트 세이브 → '이 기기에 저장된 게임', 클라우드 → '계정'
const daysLeft = (t) => Math.max(0, Math.ceil((t + 7 * 86400000 - Date.now()) / 86400000))
const progress = (s) => (s.total ? `${s.round}/${s.total}라운드` : `${s.round}라운드`)
const title = (s) => (s?.team ? s.team : '팀을 아직 안 고른 새 게임')
const detail = (s) => (s?.team ? [s.leagueName, `${s.season || 1}번째 시즌`, progress(s)].filter(Boolean).join(' · ') : '')

function guestSave() {
  try { const s = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null'); return s?.teamId ? s : null } catch { return null }
}

/** 게임 저장·불러오기: 구글 로그인, 계정에 3칸, 지운 게임 */
export default function Account() {
  const [sess, setSess] = useState(session)
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [sync, setSync] = useState(syncState)
  const { data, save, myTeam } = useGame()
  const navigate = useNavigate()
  useEffect(() => onSession(() => setSess(session())), [])
  useEffect(() => onSync(setSync), [])

  const run = async (f) => {
    setBusy(true); setMsg('')
    try { await f() } catch (e) {
      setMsg(e.kind === 'kicked' ? '다른 기기(또는 다른 브라우저)에서 로그인해서 여기는 로그아웃됐어요. 여기서 하려면 다시 로그인하세요.' : e.message)
      if (e.kind === 'kicked') await logout()
    }
    setBusy(false)
  }
  const refresh = () => run(async () => setList(await listSlots()))
  useEffect(() => { if (sess?.token) refresh() }, [sess?.token]) // eslint-disable-line react-hooks/exhaustive-deps

  const guest = guestSave()
  // 이 기기 게임 요약: 지금 불러온 리그와 같으면 구단 이름·리그·라운드 수까지
  const guestSummary = () => {
    const same = !guest.league || guest.league === data?.leagueId
    const team = same ? data?.teams?.find((t) => t.id === guest.teamId) : null
    return summaryOf(guest, { team: team?.name || guest.teamId, leagueName: same ? data?.leagueInfo?.name || '' : '', total: same ? data?.schedule?.length || 0 : 0 })
  }

  if (!sess?.token) {
    return <LoggedOut guest={guest && guestSummary()} msg={msg} setMsg={setMsg}
      onLogin={(j) => { setList(j); toast('✅ 로그인했어요. 이제 게임을 저장할 칸을 고르세요.') }} />
  }

  // ── 버튼 동작: 끝나면 바로 그 게임 화면으로 ──
  const newGame = (n) => run(async () => {
    await startSlot(n, emptySave(), summaryOf(emptySave()))
    toast(`✅ 계정 ${n}번 칸에 새 게임을 만들었어요. 맡을 팀을 고르면 그때부터 자동으로 저장됩니다.`)
    navigate('/')
  })
  const moveGuest = (n) => run(async () => {
    const sum = guestSummary()
    await startSlot(n, guest, sum)
    toast(`✅ ${sum.team} 게임을 계정 ${n}번 칸에 저장했어요. 이제부터 진행할 때마다 자동으로 저장됩니다.`)
    navigate('/')
  })
  const play = (n, s) => run(async () => {
    await openSlot(n)
    toast(`▶️ 계정 ${n}번 칸 게임(${title(s.summary)})을 불러왔어요.`)
    navigate('/')
  })
  const remove = (n, s, current) => {
    if (!confirm(`${n}번 칸의 게임(${title(s.summary)})을 지울까요?\n\n지운 게임은 아래 '지운 게임'에 7일 동안 남아 있어서 되살릴 수 있어요.`)) return
    run(async () => {
      await deleteSlot(n)
      if (current) { leaveSlot(); toast('🗑️ 지웠어요. 지금은 이 기기에 저장된 게임으로 돌아왔어요.') } else toast('🗑️ 지웠어요. 7일 안에 되살릴 수 있어요.')
      setList(await listSlots())
    })
  }
  const restore = (t, n) => run(async () => {
    await restoreTrash(t.id, n)
    if (sess.slot === n) await openSlot(n)
    toast(`♻️ ${title(t.summary)} 게임을 ${n}번 칸에 되살렸어요.`)
    setList(await listSlots())
  })

  const bySlot = Object.fromEntries((list?.slots || []).map((s) => [s.slot, s]))
  const empties = Array.from({ length: SLOTS_MAX }, (_, i) => i + 1).filter((n) => !bySlot[n])
  const firstEmpty = empties[0]
  const fresh = list && list.slots.length === 0 // 계정에 저장된 게임이 아직 없음
  const saveText = { idle: sync.at ? `✅ 저장됨 (${ago(sync.at)})` : '✅ 저장됨', pending: '저장하는 중…', saving: '저장하는 중…', offline: '⚠️ 인터넷이 끊겨 저장을 못 하고 있어요', kicked: '⚠️ 다른 곳에서 로그인했어요', conflict: '⚠️ 다른 곳에서 먼저 저장했어요' }[sync.status]

  return (
    <div className="account">
      <div className="card now-card">
        <span className="eyebrow">지금 하는 게임</span>
        {sess.slot ? (
          <>
            <h2>☁️ 계정 {sess.slot}번 칸 · {myTeam ? myTeam.name : '팀 고르는 중'}</h2>
            <p className="now-save">{saveText}</p>
            <p className="muted small">따로 저장 버튼을 누를 필요 없어요. 경기·이적 같은 진행을 할 때마다 계정에 자동으로 저장되고, 다른 기기에서 같은 구글 계정으로 로그인하면 거기서 이어서 할 수 있어요.</p>
          </>
        ) : (
          <>
            <h2>💾 이 기기에만 저장된 게임{guest && myTeam ? ` · ${myTeam.name}` : ''}</h2>
            <p className="muted small">지금 게임은 이 브라우저에만 저장되고 있어요. 다른 기기에서 이어서 하거나 잃어버리지 않으려면 아래에서 <b>계정 칸</b>을 고르세요.</p>
          </>
        )}
        {(sess.slot || save?.teamId) && <button className="btn small" onClick={() => navigate('/')}>게임으로 돌아가기 ▶</button>}
        {msg && <p className="cloud-msg">{msg}</p>}
      </div>

      {fresh && !sess.slot && firstEmpty && (
        <div className="card start-card">
          <h3>👋 처음이시네요! 어떻게 시작할까요?</h3>
          <div className="start-choices">
            {guest && (
              <button className="start-choice main" disabled={busy} onClick={() => moveGuest(firstEmpty)}>
                <strong>📤 하던 게임을 계정에 저장하기</strong>
                <span>{title(guestSummary())} · {progress(guestSummary())} — 이 기기에서 하던 게임을 그대로 이어서 해요.</span>
              </button>
            )}
            <button className={`start-choice${guest ? '' : ' main'}`} disabled={busy} onClick={() => newGame(firstEmpty)}>
              <strong>🆕 새 게임 시작하기</strong>
              <span>맡을 팀을 고르는 화면으로 바로 가요.{guest ? ' 이 기기에서 하던 게임은 지워지지 않아요.' : ''}</span>
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h3>내 계정에 저장된 게임 <small className="muted">최대 {SLOTS_MAX}개</small></h3>
        {!list && <p className="muted">불러오는 중…</p>}
        {list && Array.from({ length: SLOTS_MAX }, (_, i) => i + 1).map((n) => {
          const s = bySlot[n]
          const current = sess.slot === n
          return (
            <div key={n} className={`slot-row${current ? ' on' : ''}${s ? '' : ' empty'}`}>
              <div className="slot-no" title={`${n}번 칸`}>{n}</div>
              <div className="slot-info">
                {s ? (
                  <>
                    <strong>{title(s.summary)}{current && <span className="pill">지금 하는 중</span>}</strong>
                    <small className="muted">{[detail(s.summary), `마지막 저장 ${ago(s.updated_at)}`].filter(Boolean).join(' · ')}</small>
                  </>
                ) : <span className="muted">비어 있음</span>}
              </div>
              <div className="slot-actions">
                {s && current && <button className="btn small" onClick={() => navigate('/')}>게임으로 ▶</button>}
                {s && !current && <button className="btn small" disabled={busy} onClick={() => play(n, s)}>이 게임 하기 ▶</button>}
                {!s && <button className="btn small" disabled={busy} onClick={() => newGame(n)}>새 게임 시작</button>}
                {!s && guest && !sess.slot && <button className="btn small ghost" disabled={busy} title="이 브라우저에서 하던 게임을 이 칸에 저장합니다. 이 기기의 게임도 그대로 남아요." onClick={() => moveGuest(n)}>하던 게임 저장</button>}
                {s && <button className="btn small ghost danger" disabled={busy} onClick={() => remove(n, s, current)}>지우기</button>}
              </div>
            </div>
          )
        })}
      </div>

      {list?.trash?.length > 0 && (
        <div className="card">
          <h3>🗑️ 지운 게임 <small className="muted">7일 동안 되살릴 수 있어요</small></h3>
          {list.trash.map((t) => (
            <div key={t.id} className="slot-row">
              <div className="slot-no">{t.slot}</div>
              <div className="slot-info">
                <strong>{title(t.summary)}</strong>
                <small className="muted">{[detail(t.summary), `${ago(t.deleted_at)} 지움`, `${daysLeft(t.deleted_at)}일 뒤 완전히 삭제`].filter(Boolean).join(' · ')}</small>
              </div>
              <div className="slot-actions">
                <RestoreButton t={t} occupied={bySlot} busy={busy} onRestore={(n) => restore(t, n)} />
              </div>
            </div>
          ))}
        </div>
      )}

      <details className="card faq">
        <summary>❓ 저장이 어떻게 되는지 궁금하면</summary>
        <dl>
          <dt>저장 버튼은 어디 있나요?</dt>
          <dd>없어요. 계정 칸에 있는 게임은 진행할 때마다 자동으로 저장돼요. 화면 {sess.slot ? '왼쪽 아래(폰은 오른쪽 위) ☁️ 표시' : '위 표시'}에 '저장됨'이 보이면 끝난 거예요.</dd>
          <dt>다른 기기에서 이어서 하려면?</dt>
          <dd>그 기기에서 같은 구글 계정으로 로그인하고, 이 화면에서 그 게임의 '이 게임 하기'를 누르면 돼요. 마지막으로 로그인한 한 곳에서만 할 수 있어서, 그러면 원래 기기는 자동으로 로그아웃돼요.</dd>
          <dt>이 기기에 저장된 게임은 어떻게 되나요?</dt>
          <dd>계정에 저장해도 이 기기의 게임은 지워지지 않고 따로 남아요. 아래 '이 기기 게임으로 돌아가기'로 언제든 바꿔서 할 수 있어요. 다만 브라우저 기록을 지우면 이 기기 게임은 사라질 수 있어요.</dd>
          <dt>인터넷이 끊기면?</dt>
          <dd>계정 칸 게임은 저장이 돼야 진행돼요. 끊기면 화면이 잠깐 멈추고, 연결되면 자동으로 저장한 뒤 다시 할 수 있어요.</dd>
        </dl>
      </details>

      <div className="card account-foot">
        {sess.slot && <button className="btn ghost" disabled={busy} onClick={() => { leaveSlot(); toast('💾 이 기기에 저장된 게임으로 바꿨어요. 계정 칸의 게임은 그대로 남아 있어요.'); navigate('/') }}>이 기기 게임으로 돌아가기</button>}
        <button className="btn ghost" disabled={busy} onClick={() => run(async () => { await logout(); toast('로그아웃했어요. 계정에 저장된 게임은 다시 로그인하면 이어서 할 수 있어요.') })}>로그아웃</button>
        <span className="grow" />
        <Link to="/privacy" className="small">개인정보 처리방침</Link>
        <button className="linkish small danger" disabled={busy} onClick={() => { if (confirm('계정을 삭제할까요?\n\n계정에 저장된 게임과 지운 게임이 모두 사라지고 되돌릴 수 없어요. (이 기기에 저장된 게임은 남아요)')) run(async () => { await deleteAccount(); toast('계정을 삭제했어요.') }) }}>계정 삭제</button>
      </div>
    </div>
  )
}

function RestoreButton({ t, occupied, busy, onRestore }) {
  const [slot, setSlot] = useState(t.slot)
  return (
    <>
      <select value={slot} onChange={(e) => setSlot(Number(e.target.value))} aria-label="되살릴 칸">
        {Array.from({ length: SLOTS_MAX }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}번 칸에{occupied[n] ? ' (게임 있음)' : ''}</option>)}
      </select>
      <button className="btn small" disabled={busy} onClick={() => { if (!occupied[slot] || confirm(`${slot}번 칸에 있던 게임은 '지운 게임'으로 옮겨져요. 되살릴까요?`)) onRestore(slot) }}>되살리기</button>
    </>
  )
}

/** 로그인 전: 지금 어디에 저장되는지 + 로그인하면 뭐가 좋은지 + 구글 로그인 버튼 */
function LoggedOut({ guest, onLogin, msg, setMsg }) {
  const btn = useRef(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    loadGoogle().then((google) => {
      if (!alive || !btn.current) return
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async ({ credential }) => {
          setMsg('로그인하는 중…')
          try { onLogin(await login(credential)); setMsg('') } catch (e) { setMsg(e.message) }
        },
        ux_mode: 'popup',
        auto_select: false,
      })
      google.accounts.id.renderButton(btn.current, { theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'pill', locale: 'ko' })
      setReady(true)
    }).catch((e) => setMsg(e.message))
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="account">
      <div className="card now-card">
        <span className="eyebrow">지금 하는 게임</span>
        <h2>💾 {guest ? `${guest.team} · ${progress(guest)}` : '아직 시작한 게임이 없어요'}</h2>
        <p className="muted small">{guest ? '이 게임은 이 기기(이 브라우저)에만 자동 저장되고 있어요.' : '게임을 시작하면 이 기기(이 브라우저)에 자동으로 저장돼요.'} 로그인하지 않아도 계속 할 수 있어요.</p>
      </div>

      <div className="card">
        <h3>구글로 로그인하면</h3>
        <div className="compare">
          <div>
            <strong>로그인 안 하면</strong>
            <ul className="small">
              <li>이 기기·이 브라우저에서만 할 수 있어요</li>
              <li>브라우저 기록을 지우면 게임이 사라질 수 있어요</li>
              <li>게임은 1개만 저장돼요</li>
            </ul>
          </div>
          <div className="good">
            <strong>☁️ 로그인하면</strong>
            <ul className="small">
              <li>폰·PC 어디서든 이어서 할 수 있어요</li>
              <li>게임이 계정에 저장돼서 잃어버리지 않아요</li>
              <li>게임을 3개까지 따로 저장할 수 있어요</li>
            </ul>
          </div>
        </div>
        <div ref={btn} className="gsi-btn" />
        {!ready && !msg && <p className="muted small">로그인 버튼을 불러오는 중…</p>}
        {msg && <p className="cloud-msg">{msg}</p>}
        <p className="small muted">
          새 비밀번호를 만들 필요 없어요. 이메일·이름·사진은 저장하지 않고, 구글 계정을 알아볼 수 없게 바꾼 번호와 게임만 저장해요.
          {guest && ' 로그인한 뒤 하던 게임을 계정에 저장할 수 있어요.'} · <Link to="/privacy">개인정보 처리방침</Link>
        </p>
      </div>
    </div>
  )
}
