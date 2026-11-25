import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { onSession, onSync, session, syncState } from '../game/cloud.js'

const LABEL = { idle: '저장됨', pending: '저장 대기', saving: '저장 중…', offline: '연결 끊김', kicked: '접속 끊김', conflict: '충돌' }

/** 계정 화면으로 가는 작은 표시: 게스트 / 로그인(슬롯 없음) / 슬롯 n · 저장 상태 */
export function CloudBadge({ compact = false }) {
  const [sess, setSess] = useState(session)
  const [st, setSt] = useState(syncState)
  useEffect(() => onSession(() => setSess(session())), [])
  useEffect(() => onSync(setSt), [])
  const text = !sess?.token ? '게스트 · 로그인' : !sess.slot ? '로그인됨 · 슬롯 고르기' : `슬롯 ${sess.slot} · ${LABEL[st.status] || ''}`
  return (
    <Link to="/account" className={`cloud-badge s-${sess?.slot ? st.status : 'guest'}${compact ? ' compact' : ''}`} title={`계정·클라우드 저장 — ${text}`} aria-label={`계정·클라우드 저장: ${text}`}>
      ☁️{!compact && <span>{text}</span>}
    </Link>
  )
}
