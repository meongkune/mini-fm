import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useGame } from '../store.jsx'
import { cloudActive, onSession } from '../game/cloud.js'
import { Crest } from './Badges.jsx'
import { GoogleLogin, newGameConfirm, useNewGame } from './StartFlow.jsx'

// 페이지를 새로 열 때마다 한 번 보여 준다 (게임을 새로 띄워도 다시 나오지 않게 모듈 변수로)
let seen = false
export const titleSeen = () => seen
export const markSeen = () => { seen = true }

/** 시작 화면: 이어하기 / 바로 시작 / 구글로 로그인 */
export default function TitleScreen({ onClose }) {
  const { data, save, myTeam, totalRounds } = useGame()
  const newGame = useNewGame()
  const [cloud, setCloud] = useState(cloudActive)
  const [busy, setBusy] = useState(false)
  useEffect(() => onSession(() => setCloud(cloudActive())), [])

  const go = () => { markSeen(); onClose() }
  const startNew = async () => {
    if (myTeam && !confirm(newGameConfirm(myTeam.name))) return
    setBusy(true); markSeen()
    try { await newGame(); onClose() } catch (e) { alert(e.message); setBusy(false) }
  }
  const where = cloud ? '☁️ 구글 계정에 저장됨' : '💾 이 브라우저에 저장됨'

  return (
    <div className="title-screen">
      <div className="title-inner">
        <div className="title-logo">⚽</div>
        <h1>Mini FM</h1>
        <p className="title-sub">브라우저에서 바로 하는 축구 감독 게임</p>
        <p className="title-free">설치·가입 없이 무료</p>

        {!data && <p className="muted">불러오는 중…</p>}
        {data && (
          <div className="title-actions">
            {myTeam ? (
              <>
                <button className="title-btn main" onClick={go} style={{ '--c': myTeam.color }}>
                  <span className="tb-head">▶ 이어하기</span>
                  <span className="tb-team"><Crest team={myTeam} size={26} /> {myTeam.name}</span>
                  <span className="tb-sub">{save.seasonNo || 1}번째 시즌 · {Math.min(save.round + 1, totalRounds)}/{totalRounds}라운드 · {where}</span>
                </button>
                <button className="title-btn" disabled={busy} onClick={startNew}>
                  <span className="tb-head">🆕 새 게임</span>
                  <span className="tb-sub">{cloud ? '하던 게임은 7일 동안 보관돼요' : '하던 게임은 지워져요'}</span>
                </button>
              </>
            ) : (
              <button className="title-btn main" onClick={go}>
                <span className="tb-head">▶ 바로 시작</span>
                <span className="tb-sub">{cloud ? '☁️ 구글 계정에 저장돼요' : '로그인 없이 · 게임은 이 브라우저에 저장돼요'}</span>
              </button>
            )}

            {cloud ? (
              <p className="title-note">☁️ 구글 계정으로 로그인돼 있어요 · <Link to="/account" onClick={markSeen}>계정·저장 관리</Link></p>
            ) : (
              <div className="title-login">
                <span className="title-or">또는</span>
                <p className="small">구글로 로그인하면 <b>폰·PC 어디서든</b> 이어서 할 수 있어요{myTeam ? ` (하던 ${myTeam.name} 게임도 그대로 옮겨져요)` : ''}.</p>
                <GoogleLogin onBegin={markSeen} onDone={onClose} />
              </div>
            )}
          </div>
        )}
        <p className="title-foot small"><Link to="/privacy" onClick={markSeen}>개인정보 처리방침</Link></p>
      </div>
    </div>
  )
}
