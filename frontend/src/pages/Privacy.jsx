import { Link } from 'react-router-dom'

/** 개인정보 처리방침 (구글 로그인 앱 게시에 필요) */
export default function Privacy() {
  return (
    <div className="card privacy">
      <h2>개인정보 처리방침</h2>
      <p className="muted small">시행일: 2026년 11월 25일 · Mini FM (무료 웹 축구 감독 게임)</p>

      <h3>1. 수집하는 정보</h3>
      <ul>
        <li><b>로그인하지 않으면</b> 계정 정보를 받지 않고, 세이브도 서버로 보내지 않습니다. 세이브는 이용자의 브라우저(localStorage)에만 저장됩니다.</li>
        <li><b>구글로 로그인하면</b> 구글이 보내 준 로그인 증표에서 <b>계정 고유 번호</b>만 꺼내, 되돌릴 수 없는 방식(비밀값을 섞은 SHA-256 해시)으로 바꾼 값을 계정 번호로 저장합니다. 이메일 주소·이름·프로필 사진은 저장하지 않습니다.</li>
        <li>클라우드 세이브: 이용자가 저장한 게임 진행 내용(구단·선수·경기 기록 등 게임 데이터)과 저장 시각.</li>
        <li>접속 확인용 무작위 접속 번호(해시해서 저장) — 마지막으로 로그인한 한 기기만 인정하기 위해 씁니다.</li>
        <li>선수·구단과 나누는 AI 대화(로그인 여부와 상관없이)는 답을 만들기 위해 이 게임의 서버를 거쳐 Google Gemini API로 보내지며, 이 게임의 서버에는 저장하지 않습니다. 무료 Gemini API로 보낸 내용은 Google 약관에 따라 Google 서비스 개선에 쓰일 수 있으니 대화에 개인정보를 적지 마세요.</li>
      </ul>

      <h3>2. 이용 목적</h3>
      <p>클라우드 세이브 저장·불러오기, 다른 기기에서 이어하기, 동시에 두 곳에서 덮어쓰는 것을 막기 위한 확인에만 씁니다. 광고·분석에 쓰지 않고, 아래 4번의 처리를 맡기는 곳 말고는 다른 곳에 넘기지 않습니다.</p>

      <h3>3. 보관 기간과 삭제</h3>
      <ul>
        <li>세이브는 이용자가 지울 때까지 보관합니다. 지운 세이브는 휴지통에 7일 동안 남았다가 완전히 삭제됩니다.</li>
        <li><Link to="/account">계정·클라우드 저장</Link> 화면의 <b>계정 삭제</b>를 누르면 서버의 계정 번호·세이브·휴지통이 즉시 모두 삭제됩니다.</li>
      </ul>

      <h3>4. 처리를 맡기는 곳</h3>
      <ul>
        <li>Cloudflare (Workers·D1): 서버와 세이브 저장소</li>
        <li>Google (로그인, Gemini API): 로그인 확인과 AI 대화 답변</li>
        <li>GitHub Pages: 게임 화면 파일 제공</li>
      </ul>

      <h3>5. 문의</h3>
      <p>개인정보 관련 문의·삭제 요청은 <a href="https://github.com/meongkune/mini-fm/issues" target="_blank" rel="noreferrer">GitHub 이슈</a>로 남겨 주세요.</p>
    </div>
  )
}
