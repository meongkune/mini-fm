// FA 시장: K리그 한국 선수 + 방출·계약 만료 선수. 연봉·기간을 제시하면 선수가 판단한다
import { useEffect, useMemo, useState } from 'react'
import { loadSeasonFile } from '../api.js'
import { Flag } from '../components/Badges.jsx'
import { ROSTER_MAX, eur } from '../game/finance.js'
import { potentialStars } from '../game/trade.js'
import { playerOvr, useGame } from '../store.jsx'

const POS = ['전체', 'GK', 'DF', 'MF', 'FW']
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n)

export default function FreeAgents() {
  const { myTeam, save, teams, wageFor, offerFA } = useGame()
  const [korea, setKorea] = useState(null)
  const [pos, setPos] = useState('전체')
  const [src, setSrc] = useState('korea')
  const [q, setQ] = useState('')
  const [pick, setPick] = useState(null)
  useEffect(() => { loadSeasonFile('fa/korea.json').then((d) => setKorea(d.players)).catch(() => setKorea([])) }, [])

  // 이미 어느 구단에 있는 선수는 제외
  const taken = useMemo(() => new Set(teams.flatMap((t) => t.players.map((p) => p.id))), [teams])
  const pool = useMemo(() => {
    const base = src === 'korea' ? (korea || []) : (save.released || [])
    return base.filter((p) => !taken.has(p.id) && (pos === '전체' || p.pos === pos) && (!q || `${p.name} ${p.nameEn || ''} ${p.lastClub || ''}`.toLowerCase().includes(q.toLowerCase())))
      .sort((a, b) => playerOvr(b) - playerOvr(a)).slice(0, 80)
  }, [korea, save.released, taken, pos, q, src])

  if (!myTeam) return null
  return (
    <>
      <div className="row between" style={{ marginBottom: 8 }}>
        <div className="seg small inline">
          <button className={src === 'korea' ? 'on' : ''} onClick={() => setSrc('korea')}>🇰🇷 한국 선수 {korea ? korea.length : ''}</button>
          <button className={src === 'released' ? 'on' : ''} onClick={() => setSrc('released')}>방출·만료 {(save.released || []).filter((p) => !taken.has(p.id)).length}</button>
        </div>
        <span className="muted small">로스터 {myTeam.players.length}/{ROSTER_MAX}</span>
      </div>
      <div className="filters">
        <input className="search" placeholder="이름·소속 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <span />
      </div>
      <div className="chips-scroll">
        {POS.map((x) => <button key={x} className={`chip ${pos === x ? 'on' : ''}`} onClick={() => setPos(x)}>{x}</button>)}
      </div>
      {src === 'korea' && <p className="small muted" style={{ margin: '0 0 8px' }}>위키데이터에 등록된 K리그1·2 한국 선수입니다. 이적료 없이 연봉·계약금만으로 데려올 수 있습니다 (능력치는 게임용 생성값).</p>}
      {!korea && src === 'korea' ? <div className="card muted">명단을 불러오는 중…</div> : (
        <div className="card flush">
          <ul className="mk">
            {pool.map((p) => (
              <li key={p.id}>
                <button className="mk-row" onClick={() => setPick(p)}>
                  <span className="lu-pos">{p.role || p.pos}</span>
                  <span className="mk-name"><strong><Flag nation={p.nation} size={14} /> {p.name}</strong><small>{p.age}세 · {p.lastClub || (p.from ? `전 소속 ${p.from}` : 'FA')}{p.posGuess ? ' · 포지션 추정' : ''}</small></span>
                  <span className="mk-pot">{stars(potentialStars(p))}</span>
                  <span className="mk-ovr">{playerOvr(p)}</span>
                  <span className="mk-val">{eur(wageFor(p) * 1.1)}/년</span>
                </button>
              </li>
            ))}
            {pool.length === 0 && <li className="muted small" style={{ padding: 12 }}>조건에 맞는 선수가 없습니다.</li>}
          </ul>
        </div>
      )}
      {pick && <OfferSheet player={pick} ask={wageFor(pick) * 1.1} onClose={() => setPick(null)} offerFA={offerFA} />}
    </>
  )
}

function OfferSheet({ player, ask, onClose, offerFA }) {
  const [pct, setPct] = useState(100)
  const [years, setYears] = useState(player.age >= 32 ? 1 : 3)
  const [res, setRes] = useState(null)
  const wage = Math.round(ask * pct) / 100
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><h3>{player.name} 영입 제안</h3><button className="btn ghost small" onClick={onClose}>닫기</button></div>
        <p className="small muted" style={{ marginTop: 0 }}>{player.nameEn && player.nameEn !== player.name ? `${player.nameEn} · ` : ''}{player.age}세 · {player.role || player.pos} · OVR {playerOvr(player)} · {player.lastClub || 'FA'}</p>
        <label className="offer-slider"><span>연봉 {eur(wage)}/년 <em className="muted">(요구 수준의 {pct}%)</em></span>
          <input type="range" min={60} max={180} step={5} value={pct} onChange={(e) => { setPct(Number(e.target.value)); setRes(null) }} />
        </label>
        <div className="row">
          <span className="small">계약 기간</span>
          <select value={years} onChange={(e) => { setYears(Number(e.target.value)); setRes(null) }}>
            {[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{y}년</option>)}
          </select>
          <span className="small muted">계약금 {eur(Math.round(wage * 0.5 * 10) / 10)}</span>
        </div>
        {res && <p className={`notice ${res.ok ? 'ok' : 'bad'}`}>{res.ok ? '✍️ ' : ''}{res.reason}</p>}
        {!res?.ok && <button className="btn wide" onClick={() => setRes(offerFA(player, years, wage))}>제안하기</button>}
        {res?.ok && <button className="btn wide" onClick={onClose}>확인</button>}
      </div>
    </div>
  )
}
