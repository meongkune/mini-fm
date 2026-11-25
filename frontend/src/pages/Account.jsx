import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { GUEST_KEY, emptySave, useGame } from '../store.jsx'
import {
  GOOGLE_CLIENT_ID, SLOTS_MAX, deleteAccount, deleteSlot, leaveSlot, listSlots, loadGoogle, login, logout,
  onSession, onSync, openSlot, restoreTrash, session, startSlot, summaryOf, syncState,
} from '../game/cloud.js'

const when = (t) => (t ? new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
const daysLeft = (t) => Math.max(0, Math.ceil((t + 7 * 86400000 - Date.now()) / 86400000))
const describe = (s) => (s?.team
  ? `${s.team} · ${s.season || 1}번째 시즌 · ${s.total ? `${s.round}/${s.total}라운드 진행` : `${s.round}라운드 진행`}`
  : '맡은 팀 없음 (팀 고르기 전)')

function guestSave() {
  try { const s = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null'); return s?.teamId ? s : null } catch { return null }
}

/** 계정·클라우드 저장: 구글 로그인, 세이브 슬롯 3개, 휴지통 */
export default function Account() {
  const [sess, setSess] = useState(session)
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [sync, setSync] = useState(syncState)
  const { data } = useGame()
  useEffect(() => onSession(() => setSess(session())), [])
  useEffect(() => onSync(setSync), [])

  const run = async (f) => {
    setBusy(true); setMsg('')
    try { await f() } catch (e) { setMsg(e.kind === 'kicked' ? '다른 곳에서 로그인해서 이 기기의 접속이 끊겼습니다. 다시 로그인하세요.' : e.message) ; if (e.kind === 'kicked') await logout() }
    setBusy(false)
  }
  const refresh = () => run(async () => setList(await listSlots()))
  useEffect(() => { if (sess?.token) refresh() }, [sess?.token]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!sess?.token) return <LoggedOut onLogin={(j) => setList(j)} msg={msg} setMsg={setMsg} />

  const guest = guestSave()
  // 게스트 세이브 요약: 지금 불러온 리그와 같으면 구단 이름까지
  const guestSummary = () => {
    const same = !guest.league || guest.league === data?.leagueId
    const team = same ? data?.teams?.find((t) => t.id === guest.teamId) : null
    return summaryOf(guest, { team: team?.name || guest.teamId, leagueName: same ? data?.leagueInfo?.name || '' : '', total: same ? data?.schedule?.length || 0 : 0 })
  }
  const bySlot = Object.fromEntries((list?.slots || []).map((s) => [s.slot, s]))
  return (
    <div className="account">
      <div className="card">
        <h2>☁️ 클라우드 저장</h2>
        <p className="muted small">
          {sess.slot ? <>지금 <b>슬롯 {sess.slot}</b>로 하는 중 — 진행할 때마다 서버에 저장됩니다{sync.status === 'idle' && sync.at ? ` (마지막 저장 ${when(sync.at)})` : sync.status === 'saving' || sync.status === 'pending' ? ' (저장 중…)' : ''}.</> : <>지금은 <b>게스트 세이브</b>(이 브라우저에만 저장)로 하는 중입니다. 아래 슬롯을 고르면 서버에 저장됩니다.</>}
        </p>
        {msg && <p className="cloud-msg">{msg}</p>}
      </div>

      <div className="card">
        <h3>세이브 슬롯</h3>
        {!list && <p className="muted">불러오는 중…</p>}
        {list && Array.from({ length: SLOTS_MAX }, (_, i) => i + 1).map((n) => {
          const s = bySlot[n]
          const current = sess.slot === n
          return (
            <div key={n} className={`slot-row${current ? ' on' : ''}`}>
              <div className="slot-no">{n}</div>
              <div className="slot-info">
                {s ? <><strong>{describe(s.summary)}</strong><small className="muted">{s.summary?.leagueName ? `${s.summary.leagueName} · ` : ''}저장 {when(s.updated_at)}</small></> : <span className="muted">빈 슬롯</span>}
              </div>
              <div className="slot-actions">
                {s && current && <span className="pill">하는 중</span>}
                {s && !current && <button className="btn small" disabled={busy} onClick={() => run(async () => { await openSlot(n) })}>이어하기</button>}
                {!s && <button className="btn small" disabled={busy} onClick={() => run(async () => { await startSlot(n, emptySave(), summaryOf(emptySave())) })}>새 게임</button>}
                {!s && guest && <button className="btn small ghost" disabled={busy} title="이 브라우저의 게스트 세이브를 이 슬롯에 올립니다 (게스트 세이브는 그대로 남습니다)" onClick={() => run(async () => { await startSlot(n, guest, guestSummary()); await refresh() })}>게스트 진행 올리기</button>}
                {s && <button className="btn small ghost danger" disabled={busy} onClick={() => { if (confirm(`슬롯 ${n}을(를) 지울까요? 휴지통에 7일 동안 남아 되살릴 수 있습니다.`)) run(async () => { await deleteSlot(n); if (current) leaveSlot(); setList(await listSlots()) }) }}>삭제</button>}
              </div>
            </div>
          )
        })}
      </div>

      {list?.trash?.length > 0 && (
        <div className="card">
          <h3>🗑️ 휴지통 <small className="muted">지우거나 덮어쓴 세이브 · 7일 뒤 완전히 삭제</small></h3>
          {list.trash.map((t) => (
            <div key={t.id} className="slot-row">
              <div className="slot-no">{t.slot}</div>
              <div className="slot-info"><strong>{describe(t.summary)}</strong><small className="muted">{when(t.deleted_at)}에 지움 · {daysLeft(t.deleted_at)}일 남음</small></div>
              <div className="slot-actions">
                <RestoreButton t={t} occupied={bySlot} busy={busy} onRestore={(slot) => run(async () => { await restoreTrash(t.id, slot); if (sess.slot === slot) await openSlot(slot); setList(await listSlots()) })} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card account-foot">
        {sess.slot && <button className="btn ghost" disabled={busy} onClick={() => leaveSlot()}>게스트 세이브로 하기</button>}
        <button className="btn ghost" disabled={busy} onClick={() => run(logout)}>로그아웃</button>
        <span className="grow" />
        <Link to="/privacy" className="small">개인정보 처리방침</Link>
        <button className="linkish small danger" disabled={busy} onClick={() => { if (confirm('계정을 삭제할까요? 서버에 있는 세이브 슬롯과 휴지통이 모두 지워지고 되돌릴 수 없습니다. (이 브라우저의 게스트 세이브는 남습니다)')) run(deleteAccount) }}>계정 삭제</button>
      </div>
    </div>
  )
}

function RestoreButton({ t, occupied, busy, onRestore }) {
  const [slot, setSlot] = useState(t.slot)
  return (
    <>
      <select value={slot} onChange={(e) => setSlot(Number(e.target.value))} aria-label="되살릴 슬롯">
        {Array.from({ length: SLOTS_MAX }, (_, i) => i + 1).map((n) => <option key={n} value={n}>슬롯 {n}{occupied[n] ? ' (사용 중)' : ''}</option>)}
      </select>
      <button className="btn small" disabled={busy} onClick={() => { if (!occupied[slot] || confirm(`슬롯 ${slot}에 있는 세이브는 휴지통으로 갑니다. 되살릴까요?`)) onRestore(slot) }}>되살리기</button>
    </>
  )
}

/** 로그인 전: 설명 + 구글 로그인 버튼 */
function LoggedOut({ onLogin, msg, setMsg }) {
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
      <div className="card">
        <h2>☁️ 클라우드 저장</h2>
        <p>구글 계정으로 로그인하면 세이브를 <b>서버에 3개까지</b> 저장하고, 다른 기기에서도 이어서 할 수 있습니다.</p>
        <ul className="small muted">
          <li>로그인하지 않아도 지금처럼 이 브라우저에 저장해서 할 수 있습니다 (게스트).</li>
          <li>서버에는 구글 계정을 알아볼 수 없게 바꾼 번호와 세이브만 저장합니다. 이메일·이름·사진은 저장하지 않습니다.</li>
          <li>마지막으로 로그인한 한 곳에서만 이어서 할 수 있습니다. 로그인한 게임은 인터넷이 연결돼 있어야 진행됩니다.</li>
          <li>지운 세이브는 휴지통에 7일 동안 남습니다.</li>
        </ul>
        <div ref={btn} className="gsi-btn" />
        {!ready && !msg && <p className="muted small">로그인 버튼을 불러오는 중…</p>}
        {msg && <p className="cloud-msg">{msg}</p>}
        <p className="small"><Link to="/privacy">개인정보 처리방침</Link></p>
      </div>
    </div>
  )
}
