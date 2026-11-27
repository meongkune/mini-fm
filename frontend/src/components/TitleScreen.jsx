import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useGame } from '../store.jsx'
import { Crest } from './Badges.jsx'
import { ImportCode, newGameConfirm } from './SaveBits.jsx'

// 페이지를 새로 열 때마다 한 번 보여 준다 (게임을 새로 띄워도 다시 나오지 않게 모듈 변수로)
let seen = false
export const titleSeen = () => seen
export const markSeen = () => { seen = true }

/** 시작 화면: 이어하기 / 새 게임 / 바로 시작 / 다른 기기에서 가져오기 */
export default function TitleScreen({ onClose }) {
  const { data, save, myTeam, totalRounds, quitTeam } = useGame()
  const [importing, setImporting] = useState(false)

  const go = () => { markSeen(); onClose() }
  const startNew = () => {
    if (!confirm(newGameConfirm(myTeam.name))) return
    quitTeam()
    go()
  }

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
                  <span className="tb-sub">{save.seasonNo || 1}번째 시즌 · {Math.min(save.round + 1, totalRounds)}/{totalRounds}라운드</span>
                </button>
                <button className="title-btn" onClick={startNew}>
                  <span className="tb-head">🆕 새 게임</span>
                  <span className="tb-sub">하던 게임은 지워져요</span>
                </button>
              </>
            ) : (
              <button className="title-btn main" onClick={go}>
                <span className="tb-head">▶ 바로 시작</span>
                <span className="tb-sub">맡을 팀을 고르면 시작해요</span>
              </button>
            )}

            <p className="title-note">💾 로그인 없이 이 브라우저에 자동 저장돼요</p>

            {!importing ? (
              <button className="linkish title-import" onClick={() => setImporting(true)}>📥 다른 기기에서 하던 게임 가져오기</button>
            ) : (
              <div className="title-login">
                <p className="small">다른 기기의 <b>저장·기기 옮기기</b> 화면에서 만든 코드를 넣으세요.</p>
                <ImportCode autoFocus onDone={markSeen} />
              </div>
            )}
          </div>
        )}
        <p className="title-foot small"><Link to="/privacy" onClick={markSeen}>개인정보 처리방침</Link></p>
      </div>
    </div>
  )
}
