// 선수 얼굴: 중계 그래픽처럼 모두 같은 틀 — 구단 색 원 + 배경을 지운 머리~가슴 사진.
// 통일 사진이 없는 선수는 같은 원 안에 구단 색 실루엣.
export default function Avatar({ player, color = '#7c5cff', size = 48, number = true }) {
  const style = { '--c': color, width: size, height: size }
  return (
    <span className={`avatar ${player.face ? 'has-face' : 'no-face'}`} style={style}>
      {player.face
        ? <img src={player.face} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
        : (
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="38" r="17" className="sil" />
            <path d="M18 100c2-22 15-34 32-34s30 12 32 34z" className="sil" />
          </svg>
        )}
      {number && player.number ? <i>{player.number}</i> : null}
    </span>
  )
}
