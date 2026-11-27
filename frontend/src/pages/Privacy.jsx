import { Link } from 'react-router-dom'

/** 개인정보 처리방침 */
export default function Privacy() {
  return (
    <div className="card privacy">
      <h2>개인정보 처리방침</h2>
      <p className="muted small">시행일: 2026년 11월 27일 · Mini FM (무료 웹 축구 감독 게임)</p>

      <h3>1. 수집하는 정보</h3>
      <ul>
        <li><b>회원가입·로그인이 없습니다.</b> 이름·이메일·전화번호 같은 개인정보를 받지 않습니다.</li>
        <li>게임 진행 내용은 이용자의 브라우저(localStorage)에만 저장되고, 서버로 보내지 않습니다. 브라우저마다 만드는 무작위 플레이어 번호도 브라우저에만 있습니다.</li>
        <li><b>기록 옮기기</b>를 쓸 때만, 옮길 게임 데이터(구단·선수·경기 기록 등)와 무작위 플레이어 번호를 서버에 잠깐 맡깁니다. 받는 기기에서 코드를 한 번 쓰면 바로 지우고, 쓰지 않으면 24시간 뒤 지웁니다.</li>
        <li>선수·구단과 나누는 AI 대화는 답을 만들기 위해 이 게임의 서버를 거쳐 Google Gemini API로 보내며, 이 게임의 서버에는 저장하지 않습니다. 무료 Gemini API로 보낸 내용은 Google 약관에 따라 Google 서비스 개선에 쓰일 수 있으니 대화에 개인정보를 적지 마세요.</li>
      </ul>

      <h3>2. 이용 목적</h3>
      <p>기록 옮기기(다른 기기로 게임 옮기기)와 AI 대화 답변에만 씁니다. 광고·분석에 쓰지 않고, 아래 3번의 처리를 맡기는 곳 말고는 다른 곳에 넘기지 않습니다.</p>

      <h3>3. 처리를 맡기는 곳</h3>
      <ul>
        <li>Cloudflare (Workers·D1): 서버와 기록 옮기기 임시 보관</li>
        <li>Google (Gemini API): AI 대화 답변</li>
        <li>GitHub Pages: 게임 화면 파일 제공</li>
      </ul>

      <h3>4. 지우는 방법</h3>
      <p>브라우저의 사이트 데이터를 지우면 이 기기의 게임과 플레이어 번호가 모두 지워집니다. 서버에 맡긴 기록 옮기기 데이터는 24시간 안에 자동으로 지워집니다.</p>

      <h3>5. 문의</h3>
      <p>문의는 <a href="https://github.com/meongkune/mini-fm/issues" target="_blank" rel="noreferrer">GitHub 이슈</a>로 남겨 주세요.</p>
      <p className="small"><Link to="/save">저장·기기 옮기기</Link></p>
    </div>
  )
}
