// 금액 입력칸 (€M 단위): 입력하는 글자를 그대로 두고(앞의 0이 안 지워지는 문제 방지), 옆에 유로·원화 환산을 바로 보여 준다
import { useEffect, useState } from 'react'
import { wonText } from '../game/finance.js'

const euro = (a) => `€${a >= 10 ? a.toFixed(a % 1 ? 1 : 0) : a.toFixed(1)}M`

/** 유로·원화를 함께: €3.5M · 52.6억원 */
export const bothText = (v) => (v > 0 ? `${euro(v)} · ${wonText(v)}원` : '-')

export default function MoneyInput({ value, onChange, min = 0, className = '', placeholder = '0', live = true }) {
  const [text, setText] = useState(value ? String(value) : '')
  // 밖에서 값이 바뀌면(역제안 반영 등) 따라간다 — 지금 입력 중인 값과 같으면 그대로 둔다
  useEffect(() => { if (Number(text) !== value) setText(value ? String(value) : '') }, [value])
  const n = Number(text)
  const ok = text !== '' && Number.isFinite(n) && n >= min
  return (
    <span className={`money-input ${className}`}>
      <span className="mi-box">
        <i>€</i>
        <input type="text" inputMode="decimal" value={text} placeholder={placeholder}
          onChange={(e) => {
            // 숫자와 점 하나만, 앞에 붙은 0은 지운다 (0.5 같은 소수는 그대로)
            let t = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').replace(/^0+(?=\d)/, '')
            setText(t)
            const v = Math.round(Number(t) * 10) / 10
            if (t !== '' && Number.isFinite(v) && v >= min) onChange(v)
          }}
          onBlur={() => { if (!ok) setText(value ? String(value) : '') }} />
        <i>M</i>
      </span>
      {live && <small className="mi-conv">{ok ? `= ${bothText(Math.round(n * 10) / 10)}` : '금액을 입력하세요'}</small>}
    </span>
  )
}
