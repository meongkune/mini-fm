// 면담: 직접 말하기 입력칸
import { useState } from 'react'

const EXAMPLES = ['다음 경기 선발로 기회 줄게', '경쟁에서 이겨서 증명해봐', '꼬우면 이적해라', '요즘 잘하고 있다, 팀의 핵심이야']

export default function SayBox({ onSay, disabled, placeholder = '선수에게 할 말을 직접 입력하세요' }) {
  const [text, setText] = useState('')
  const [res, setRes] = useState(null)
  const send = () => {
    const r = onSay(text)
    if (r) { setRes(r); setText('') }
  }
  return (
    <div className="saybox">
      <div className="say-row">
        <input value={text} maxLength={120} disabled={disabled} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && text.trim() && send()} />
        <button className="btn small" disabled={disabled || !text.trim()} onClick={send}>말하기</button>
      </div>
      {!res && <div className="say-ex">{EXAMPLES.map((x) => <button key={x} className="chip" disabled={disabled} onClick={() => setText(x)}>{x}</button>)}</div>}
      {res?.blocked && <p className="small muted">{res.blocked}</p>}
      {res && !res.blocked && (
        <div className={`say-res ${res.dMorale >= 0 ? 'ok' : 'bad'}`}>
          <span className="small muted">감지된 말투: <b>{res.toneText}</b> · 사기 {res.dMorale >= 0 ? '+' : ''}{res.dMorale}</span>
          <p>{res.reply}</p>
          {res.extra.length > 0 && <div className="say-tags">{res.extra.map((e) => <span key={e} className="pill bad">{e}</span>)}</div>}
        </div>
      )}
    </div>
  )
}
