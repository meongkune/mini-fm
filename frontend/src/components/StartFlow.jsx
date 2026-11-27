import { useEffect, useRef, useState } from 'react'
import { GUEST_KEY, emptySave, useGame } from '../store.jsx'
import {
  GOOGLE_CLIENT_ID, ago, cloudActive, listSlots, loadGoogle, login, openSlot, session, resetSync, startSlot, summaryOf, toast,
} from '../game/cloud.js'

// 계정에는 게임을 하나만 저장한다 (서버는 칸을 여러 개 받을 수 있지만 1번만 쓴다)
export const ACCOUNT_SLOT = 1

// ── 게임 요약 글 ──
export const progress = (s) => (s.total ? `${s.round}/${s.total}라운드` : `${s.round}라운드`)
export const gameTitle = (s) => (s?.team ? s.team : '팀을 아직 안 고른 새 게임')
export const gameDetail = (s) => (s?.team ? [s.leagueName, `${s.season || 1}번째 시즌`, progress(s)].filter(Boolean).join(' · ') : '')

/** 이 브라우저에 저장된 게임 (로그인 안 했을 때 하는 게임) */
export function browserSave() {
  try { const s = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null'); return s?.teamId ? s : null } catch { return null }
}
/** 게임 요약: 지금 불러온 리그와 같으면 구단 이름·리그·라운드 수까지 */
export function summarize(save, data) {
  const same = !save.league || save.league === data?.leagueId
  const team = same ? data?.teams?.find((t) => t.id === save.teamId) : null
  return summaryOf(save, { team: team?.name || save.teamId || '', leagueName: same ? data?.leagueInfo?.name || '' : '', total: same ? data?.schedule?.length || 0 : 0 })
}

/** 새 게임: 로그인했으면 계정의 하던 게임을 '지난 게임'(7일 보관)으로 보내고, 아니면 이 브라우저 게임을 비운다 */
export function useNewGame() {
  const { save, quitTeam } = useGame()
  return async () => {
    if (cloudActive()) {
      resetSync()
      const fresh = { ...emptySave(), league: save.league, season: save.season }
      await startSlot(ACCOUNT_SLOT, fresh, summaryOf(fresh), true)
      toast('🆕 새 게임을 시작해요. 하던 게임은 \'지난 게임\'에 7일 동안 보관돼요.')
    } else quitTeam()
  }
}
/** 새 게임 확인 문구 */
export function newGameConfirm(teamName) {
  return cloudActive()
    ? `새 게임을 시작할까요?\n\n하던 게임(${teamName})은 '지난 게임'에 7일 동안 보관돼서 그동안은 되돌릴 수 있어요.`
    : `새 게임을 시작할까요?\n\n하던 게임(${teamName})은 지워지고 되돌릴 수 없어요. 남겨 두려면 먼저 구글로 로그인해서 계정에 저장하세요.`
}

/**
 * 로그인한 다음 어느 게임으로 할지 정한다.
 * - 계정에 게임이 있고 이 브라우저에도 있으면 → 고르게 한다
 * - 한쪽에만 있으면 → 그 게임으로 (브라우저 게임은 계정에 올린다)
 * - 둘 다 없으면 → 새 게임 (팀 고르기)
 */
export function useLoginSettle() {
  const { data } = useGame()
  const dataRef = useRef(data)
  dataRef.current = data
  const [choice, setChoice] = useState(null)

  const settle = async (list) => {
    const acc = (list?.slots || []).find((s) => s.slot === ACCOUNT_SLOT)
    const b = browserSave()
    const bSum = b && summarize(b, dataRef.current)
    if (acc && b) { setChoice({ acc, b, bSum }); return false }
    if (acc) {
      await openSlot(ACCOUNT_SLOT)
      toast(`☁️ 로그인했어요. 계정에 저장된 게임(${gameTitle(acc.summary)})을 불러왔어요.`)
    } else if (b) {
      await startSlot(ACCOUNT_SLOT, b, bSum)
      toast(`☁️ 로그인했어요. 하던 게임(${bSum.team})을 계정에 저장했어요. 이제 폰·PC 어디서든 이어서 할 수 있어요.`)
    } else {
      await startSlot(ACCOUNT_SLOT, emptySave(), summaryOf(emptySave()))
      toast('☁️ 로그인했어요. 맡을 팀을 고르면 그 게임이 계정에 저장돼요.')
    }
    return true
  }
  const pick = async (which) => {
    const c = choice
    if (which === 'account') {
      await openSlot(ACCOUNT_SLOT)
      toast(`☁️ 계정 게임(${gameTitle(c.acc.summary)})을 불러왔어요. 이 브라우저 게임은 그대로 남아서 로그아웃하면 다시 할 수 있어요.`)
    } else {
      await startSlot(ACCOUNT_SLOT, c.b, c.bSum, true)
      toast(`☁️ ${c.bSum.team} 게임을 계정에 저장했어요. 계정에 있던 게임은 '지난 게임'에 7일 동안 보관돼요.`)
    }
    setChoice(null)
  }
  return { settle, choice, pick }
}

/** 로그인 뒤 '어느 게임으로 할까요?' 창 */
export function ChoiceBox({ choice, pick, busy }) {
  if (!choice) return null
  const { acc, bSum } = choice
  return (
    <div className="cloud-cover">
      <div className="card cloud-box">
        <h3>어느 게임으로 할까요?</h3>
        <p className="muted small">계정과 이 브라우저에 서로 다른 게임이 저장돼 있어요.</p>
        <div className="start-choices one">
          <button className="start-choice main" disabled={busy} onClick={() => pick('account')}>
            <strong>☁️ 계정에 저장된 게임 · {gameTitle(acc.summary)}</strong>
            <span>{[gameDetail(acc.summary), `마지막 저장 ${ago(acc.updated_at)}`].filter(Boolean).join(' · ')}</span>
            <span className="muted">이 브라우저 게임은 그대로 남아요.</span>
          </button>
          <button className="start-choice" disabled={busy} onClick={() => pick('browser')}>
            <strong>💾 이 브라우저 게임 · {gameTitle(bSum)}</strong>
            <span>{gameDetail(bSum)}</span>
            <span className="muted">이 게임을 계정에 저장해요. 계정에 있던 게임은 '지난 게임'에 7일 동안 보관돼요.</span>
          </button>
        </div>
      </div>
    </div>
  )
}

/** 구글 로그인 버튼 + 로그인 뒤 처리(게임 정하기). onBegin: 로그인 시작, onDone: 게임이 정해진 뒤 */
export function GoogleLogin({ onBegin, onDone }) {
  const btn = useRef(null)
  const [ready, setReady] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const { settle, choice, pick } = useLoginSettle()
  const settleRef = useRef(settle)
  settleRef.current = settle
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    let alive = true
    loadGoogle().then((google) => {
      if (!alive || !btn.current) return
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async ({ credential }) => {
          setMsg('로그인하는 중…')
          onBegin?.()
          try {
            const list = await login(credential)
            if (await settleRef.current(list)) doneRef.current?.()
            setMsg('')
          } catch (e) { setMsg(e.message) }
        },
        ux_mode: 'popup',
        auto_select: false,
      })
      google.accounts.id.renderButton(btn.current, { theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'pill', locale: 'ko' })
      setReady(true)
    }).catch((e) => setMsg(e.message))
    // 로그인은 했는데 게임을 아직 안 정했으면(고르는 창에서 새로고침 등) 이어서 정한다
    const s = session()
    if (s?.token && !s.slot) {
      setMsg('계정 확인 중…')
      listSlots().then((list) => settleRef.current(list)).then((ok) => { setMsg(''); if (ok) doneRef.current?.() }).catch((e) => setMsg(e.message))
    }
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onPick = async (which) => {
    setBusy(true)
    try { await pick(which); doneRef.current?.() } catch (e) { setMsg(e.message) }
    setBusy(false)
  }
  return (
    <>
      <div ref={btn} className="gsi-btn" />
      {!ready && !msg && <p className="muted small">로그인 버튼을 불러오는 중…</p>}
      {msg && <p className="cloud-msg">{msg}</p>}
      <ChoiceBox choice={choice} pick={onPick} busy={busy} />
    </>
  )
}
