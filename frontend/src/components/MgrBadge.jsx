// 감독 배지: 팀 색 원 안에 이름 첫 글자
export default function MgrBadge({ name = '', color = '#7c5cff', size = 40 }) {
  const ch = (name.trim()[0] || '감').toUpperCase()
  return (
    <span className="mgr-badge" style={{ width: size, height: size, fontSize: size * 0.45, '--c': color }} aria-hidden>
      {ch}
    </span>
  )
}
