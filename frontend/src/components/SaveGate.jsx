import { useEffect, useState } from 'react'
import { GameProvider } from '../store.jsx'
import { onReloadGame, onToast } from '../game/transfer.js'

/** 게임을 감싼다: 다른 기기에서 게임을 가져오면 GameProvider를 새로 만들어 그 게임을 띄운다 */
export default function SaveGate({ children }) {
  const [gen, setGen] = useState(0)
  useEffect(() => onReloadGame(() => setGen((g) => g + 1)), [])
  return (
    <>
      <GameProvider key={gen}>{children}</GameProvider>
      <Toast />
    </>
  )
}

/** 잠깐 떴다 사라지는 안내 (예: '게임을 가져왔어요') */
function Toast() {
  const [text, setText] = useState('')
  useEffect(() => {
    let t
    const off = onToast((m) => { setText(m); clearTimeout(t); t = setTimeout(() => setText(''), 6000) })
    return () => { off(); clearTimeout(t) }
  }, [])
  if (!text) return null
  return <div className="toast" role="status" onClick={() => setText('')}>{text}</div>
}
