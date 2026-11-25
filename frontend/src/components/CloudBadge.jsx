import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ago, onSession, onSync, session, syncState } from '../game/cloud.js'

const LABEL = { idle: '저장됨 ✓', pending: '저장하는 중…', saving: '저장하는 중…', offline: '인터넷 끊김', kicked: '로그아웃됨', conflict: '확인 필요' }

/** 저장 화면으로 가는 작은 표시: 이 기기에만 저장 / 로그인(칸 안 고름) / 계정 n번 칸 · 저장 상태 */
export function CloudBadge({ compact = false }) {
  const [sess, setSess] = useState(session)
  const [st, setSt] = useState(syncState)
  useEffect(() => onSession(() => setSess(session())), [])
  useEffect(() => onSync(setSt), [])
  const slot = sess?.token && sess.slot
  const icon = slot ? (st.status === 'idle' ? '☁️' : st.status === 'saving' || st.status === 'pending' ? '⏳' : '⚠️') : '💾'
  const text = !sess?.token ? '이 기기에만 저장 · 로그인' : !sess.slot ? '저장할 칸 고르기' : `계정 ${sess.slot}번 칸 · ${LABEL[st.status] || ''}`
  const short = !sess?.token ? '로그인' : !sess.slot ? '칸 고르기' : { idle: '저장됨', pending: '저장 중', saving: '저장 중', offline: '끊김', kicked: '로그아웃됨', conflict: '확인' }[st.status]
  const tip = !sess?.token
    ? '지금 게임은 이 브라우저에만 저장돼요. 눌러서 구글로 로그인하면 다른 기기에서도 이어서 할 수 있어요.'
    : !sess.slot ? '로그인했지만 지금 게임은 이 브라우저에만 저장돼요. 눌러서 계정에 저장할 칸을 고르세요.'
      : `계정 ${sess.slot}번 칸에 자동 저장 중 — ${LABEL[st.status] || ''}${st.status === 'idle' && st.at ? ` (${ago(st.at)})` : ''}`
  return (
    <Link to="/account" className={`cloud-badge s-${slot ? st.status : sess?.token ? 'pick' : 'guest'}${compact ? ' compact' : ''}`} title={tip} aria-label={`게임 저장: ${text}`}>
      {icon}<span>{compact ? short : text}</span>
    </Link>
  )
}

/** 팀 고르기 화면 위 한 줄: 이 게임이 어디에 저장되는지 */
export function SaveNote() {
  const [sess, setSess] = useState(session)
  useEffect(() => onSession(() => setSess(session())), [])
  if (sess?.token && sess.slot) {
    return <p className="save-note">☁️ <b>계정 {sess.slot}번 칸</b>에 저장되는 새 게임이에요. 팀을 고르면 바로 저장되고, 그다음부터는 진행할 때마다 자동으로 저장돼요.</p>
  }
  return (
    <p className="save-note">
      💾 이 게임은 <b>이 기기(이 브라우저)에만</b> 자동 저장돼요.{' '}
      {sess?.token ? <Link to="/account">계정에 저장할 칸 고르기 →</Link> : <><Link to="/account">구글로 로그인</Link>하면 다른 기기에서도 이어서 할 수 있어요.</>}
    </p>
  )
}
