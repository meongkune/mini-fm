import { Link } from 'react-router-dom'

export default function NeedTeam() {
  return (
    <div className="card">
      <p>먼저 홈에서 맡을 팀을 선택하세요.</p>
      <Link className="btn" to="/">팀 선택하러 가기</Link>
    </div>
  )
}
