// 평점 배지: 8.0+ 파랑, 7.0+ 초록, 6.0+ 노랑, 그 아래 빨강 (축구 중계·포털 기록 화면과 같은 구분)
export const ratingTone = (r) => (r >= 8 ? 'great' : r >= 7 ? 'good' : r >= 6 ? 'ok' : 'bad')

export default function Rating({ value, big = false }) {
  if (value === undefined || value === null || Number.isNaN(value)) return <span className="rt none">-</span>
  return <span className={`rt ${ratingTone(value)} ${big ? 'big' : ''}`}>{Number(value).toFixed(1)}</span>
}

/** 컨디션 막대 (0~100) */
export function CondBar({ value }) {
  const v = Math.round(value ?? 100)
  return (
    <span className={`cond ${v >= 80 ? 'hi' : v >= 60 ? 'mid' : 'lo'}`} title={`컨디션 ${v}%`}>
      <i style={{ width: `${v}%` }} />
    </span>
  )
}
