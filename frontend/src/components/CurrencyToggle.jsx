// 금액 표시 단위: 유로 · 원화 · 둘 다 (환율은 매일 유럽중앙은행 기준)
import { useGame } from '../store.jsx'

export default function CurrencyToggle() {
  const { fx, changeFx } = useGame()
  return (
    <div className="fx-toggle">
      <div className="seg small">
        {[['eur', '€ 유로'], ['krw', '₩ 원화'], ['both', '둘 다']].map(([k, l]) => (
          <button key={k} className={fx.mode === k ? 'on' : ''} onClick={() => changeFx({ mode: k })}>{l}</button>
        ))}
      </div>
      <small className="muted">1€ = {Math.round(fx.rate).toLocaleString()}원{fx.rateDate ? ` (${fx.rateDate.slice(5).replace('-', '/')} 기준)` : ' (기본값)'}</small>
    </div>
  )
}
