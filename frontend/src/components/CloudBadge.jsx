import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ago, onSession, onSync, session, syncState } from '../game/cloud.js'

const LABEL = { idle: '저장됨 ✓', pending: '저장하는 중…', saving: '저장하는 중…', offline: '인터넷 끊김', kicked: '로그아웃됨', conflict: '확인 필요' }
const SHORT = { idle: '저장됨', pending: '저장 중', saving: '저장 중', offline: '끊김', kicked: '로그아웃됨', conflict: '확인' }

/** 저장 화면으로 가는 작은 표시: 이 브라우저에 저장 / 계정에 저장 · 상태 */
export function CloudBadge({ compact = false }) {
  const [sess, setSess] = useState(session)
  const [st, setSt] = useState(syncState)
  useEffect(() => onSession(() => setSess(session())), [])
  useEffect(() => onSync(setSt), [])
  const cloud = sess?.token && sess.slot
  const icon = cloud ? (st.status === 'idle' ? '☁️' : st.status === 'saving' || st.status === 'pending' ? '⏳' : '⚠️') : '💾'
  const text = cloud ? `계정에 저장 · ${LABEL[st.status] || ''}` : '이 브라우저에 저장 · 로그인'
  const short = cloud ? SHORT[st.status] : '로그인'
  const tip = cloud
    ? `구글 계정에 자동 저장 중 — ${LABEL[st.status] || ''}${st.status === 'idle' && st.at ? ` (${ago(st.at)})` : ''}`
    : '지금 게임은 이 브라우저에만 자동 저장돼요. 눌러서 구글로 로그인하면 폰·PC 어디서든 이어서 할 수 있어요.'
  return (
    <Link to="/account" className={`cloud-badge s-${cloud ? st.status : 'guest'}${compact ? ' compact' : ''}`} title={tip} aria-label={`게임 저장: ${text}`}>
      {icon}<span>{compact ? short : text}</span>
    </Link>
  )
}

/** 팀 고르기 화면 위 한 줄: 이 게임이 어디에 저장되는지 */
export function SaveNote() {
  const [sess, setSess] = useState(session)
  useEffect(() => onSession(() => setSess(session())), [])
  if (sess?.token && sess.slot) {
    return <p className="save-note">☁️ 이 게임은 <b>구글 계정</b>에 저장돼요. 팀을 고르면 바로 저장되고, 그다음부터는 진행할 때마다 자동으로 저장돼요.</p>
  }
  return (
    <p className="save-note">
      💾 로그인 없이 바로 할 수 있어요. 게임은 <b>이 브라우저</b>에 자동 저장돼요.{' '}
      <Link to="/account">구글로 로그인</Link>하면 폰·PC 어디서든 이어서 할 수 있어요.
    </p>
  )
}
