import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useGame } from '../store.jsx'
import { sendGame } from '../game/transfer.js'
import { ImportCode } from '../components/SaveBits.jsx'

const until = (t) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** 저장·기기 옮기기: 로그인 없이 이 브라우저에 저장, 다른 기기로는 코드로 옮긴다 */
export default function SaveTransfer() {
  const { save, myTeam, totalRounds } = useGame()
  const navigate = useNavigate()
  const [sent, setSent] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [copied, setCopied] = useState(false)

  const make = async () => {
    setBusy(true); setMsg(''); setCopied(false)
    try { setSent(await sendGame(save)) } catch (e) { setMsg(e.message) }
    setBusy(false)
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(sent.code); setCopied(true) } catch { /* 직접 적으면 된다 */ }
  }

  return (
    <div className="account">
      <div className="card now-card">
        <span className="eyebrow">지금 하는 게임</span>
        <h2>💾 {myTeam ? `${myTeam.name} · ${save.seasonNo || 1}번째 시즌 · ${Math.min(save.round + 1, totalRounds)}/${totalRounds}라운드` : '아직 시작한 게임이 없어요'}</h2>
        <p className="muted small">로그인 없이 이 브라우저에 <b>자동 저장</b>되고 있어요. 따로 저장 버튼을 누를 필요 없어요.</p>
        {myTeam && <button className="btn small" onClick={() => navigate('/')}>게임으로 돌아가기 ▶</button>}
      </div>

      {myTeam && (
        <div className="card">
          <h3>📤 다른 기기로 옮기기</h3>
          <p className="muted small">코드를 만들어 다른 기기(폰·PC·다른 브라우저)에서 입력하면 이 게임이 그대로 옮겨져요.</p>
          {!sent && <button className="btn" disabled={busy} onClick={make}>{busy ? '만드는 중…' : '옮기기 코드 만들기'}</button>}
          {sent && (
            <div className="code-box">
              <div className="code-big" aria-label="옮기기 코드">{sent.code}</div>
              <div className="row gap">
                <button className="btn small" onClick={copy}>{copied ? '✅ 복사했어요' : '코드 복사'}</button>
                <button className="btn small ghost" disabled={busy} onClick={make}>새 코드 만들기</button>
              </div>
              <p className="small muted">
                다른 기기에서 이 사이트를 열고 <b>시작 화면의 '다른 기기에서 가져오기'</b>나 이 화면 아래에 코드를 넣으세요.
                {` ${until(sent.expires_at)}까지`} 한 번만 쓸 수 있어요. 지금 상태 그대로 옮겨지니, 더 진행했다면 코드를 새로 만들어 주세요. 이 브라우저의 게임은 그대로 남아요.
              </p>
            </div>
          )}
          {msg && <p className="cloud-msg">{msg}</p>}
        </div>
      )}

      <div className="card">
        <h3>📥 다른 기기에서 가져오기</h3>
        <p className="muted small">다른 기기에서 만든 옮기기 코드를 넣으세요.{myTeam ? ' 이 브라우저에서 하던 게임은 가져온 게임으로 바뀌어요.' : ''}</p>
        <ImportCode />
      </div>

      <details className="card faq">
        <summary>❓ 저장은 어떻게 되나요?</summary>
        <dl>
          <dt>저장 버튼은 어디 있나요?</dt>
          <dd>없어요. 진행할 때마다 이 브라우저에 자동으로 저장돼요. 창을 닫았다 열어도 이어서 할 수 있어요.</dd>
          <dt>게임이 사라질 수도 있나요?</dt>
          <dd>브라우저 기록(사이트 데이터)을 지우거나 시크릿 창에서 하면 사라져요. 오래 한 게임은 가끔 옮기기 코드를 만들어 다른 기기에 옮겨 두면 안전해요.</dd>
          <dt>폰과 PC에서 같이 할 수 있나요?</dt>
          <dd>기기마다 게임이 따로 저장돼요. 이어서 하고 싶은 기기로 코드를 써서 옮기면 돼요.</dd>
          <dt>새 게임을 시작하면?</dt>
          <dd>하던 게임은 지워지고 되돌릴 수 없어요. 남겨 두고 싶으면 먼저 다른 기기로 옮겨 두세요.</dd>
        </dl>
      </details>

      <p className="small muted center"><Link to="/privacy">개인정보 처리방침</Link></p>
    </div>
  )
}
