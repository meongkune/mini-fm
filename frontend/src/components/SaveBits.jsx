import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useGame } from '../store.jsx'
import { applyGame, receiveGame, toast } from '../game/transfer.js'

/** 저장·옮기기 화면으로 가는 작은 표시 */
export function SaveLink({ compact = false }) {
  return (
    <Link to="/save" className={`cloud-badge s-guest${compact ? ' compact' : ''}`}
      title="게임은 이 브라우저에 자동 저장돼요. 다른 기기로 옮기려면 눌러 주세요." aria-label="저장·기기 옮기기">
      💾<span>{compact ? '옮기기' : '자동 저장 · 기기 옮기기'}</span>
    </Link>
  )
}

/** 팀 고르기 화면 위 한 줄: 저장은 어떻게 되는지 */
export function SaveNote() {
  return (
    <p className="save-note">
      💾 로그인 없이 바로 할 수 있어요. 게임은 <b>이 브라우저</b>에 자동 저장되고, 다른 기기로는 <Link to="/save">코드로 옮길 수</Link> 있어요.
    </p>
  )
}

/** 새 게임 확인 문구 */
export const newGameConfirm = (teamName) => `새 게임을 시작할까요?\n\n하던 게임(${teamName})은 지워지고 되돌릴 수 없어요.`

/** 다른 기기에서 받은 코드를 넣어 게임 가져오기 */
export function ImportCode({ onDone, autoFocus = false }) {
  const { myTeam } = useGame()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const ok = code.toLowerCase().replace(/[^a-z]/g, '').length === 9

  const submit = async (e) => {
    e.preventDefault()
    if (!ok || busy) return
    if (myTeam && !confirm(`다른 기기의 게임을 가져올까요?\n\n이 브라우저에서 하던 게임(${myTeam.name})은 가져온 게임으로 바뀌고 되돌릴 수 없어요.`)) return
    setBusy(true); setMsg('')
    try {
      const got = await receiveGame(code)
      onDone?.()
      applyGame(got)
      toast('✅ 다른 기기에서 하던 게임을 가져왔어요. 이제 이 브라우저에 자동 저장돼요.')
      navigate('/')
    } catch (err) {
      setMsg(err.message)
      setBusy(false)
    }
  }
  return (
    <form className="import-code" onSubmit={submit}>
      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="abc-def-ghk" aria-label="옮기기 코드"
        autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={14} autoFocus={autoFocus} />
      <button className="btn" disabled={!ok || busy}>{busy ? '가져오는 중…' : '가져오기'}</button>
      {msg && <p className="cloud-msg">{msg}</p>}
    </form>
  )
}
