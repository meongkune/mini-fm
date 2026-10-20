// 선수 상세: 상태(컨디션·사기·폼·부상·징계), 시즌 기록, 선발 넣기/빼기, 개별 면담
import { useEffect, useState } from 'react'
import { fetchProfile } from '../game/wiki.js'
import PlayerCard from './PlayerCard.jsx'
import { Flag, nationName } from './Badges.jsx'
import Rating, { CondBar } from './Rating.jsx'
import { PLAYER_TALKS, moraleLabel } from '../game/season.js'
import { personality, personalityText } from '../game/speech.js'
import SayBox from './SayBox.jsx'
import { useGame } from '../store.jsx'

export default function PlayerSheet({ player, onClose, inLineup, onToggle }) {
  const { status, save, talkTo, myTeam, teams, sayTo } = useGame()
  const [reply, setReply] = useState('')
  const [profile, setProfile] = useState(null)
  useEffect(() => {
    if (!player) return
    let alive = true
    setProfile(null)
    fetchProfile(player).then((p) => alive && setProfile(p))
    return () => { alive = false }
  }, [player?.id])
  if (!player) return null
  const st = status[player.id] || {}
  const ps = save.pstats?.[player.id]
  const [face, mLabel, mTone] = moraleLabel(st.morale)
  const mine = myTeam?.players.some((p) => p.id === player.id)
  const talked = save.status?.[player.id]?.talkRound === save.round

  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{player.name}</h3>
          <button className="btn ghost small" onClick={onClose}>닫기</button>
        </div>
        <div className="ps-top">
          <PlayerCard player={player} size="lg" color={teams.find((t) => t.players.some((p) => p.id === player.id))?.color} />
          <div className="ps-status">
            <div className="ps-row"><span>나이 · 국적</span><b>{player.age}세 <Flag nation={player.nation} size={16} /> {nationName(player.nation)}</b></div>
            <div className="ps-row"><span>컨디션</span><b><CondBar value={st.cond} /> {Math.round(st.cond ?? 100)}%</b></div>
            <div className="ps-row"><span>사기</span><b className={`mood ${mTone}`}>{face} {mLabel}</b></div>
            <div className="ps-row"><span>최근 폼</span><b className="ps-form">{(st.fr || []).length ? st.fr.map((r, i) => <Rating key={i} value={r} />) : <span className="muted small">기록 없음</span>}</b></div>
            {st.inj > 0 && <div className="ps-row bad"><span>부상</span><b>🚑 {st.injKind || '부상'} · {st.inj}경기 결장</b></div>}
            {st.susp > 0 && <div className="ps-row bad"><span>징계</span><b>🟥 {st.suspWhy || '징계'} · {st.susp}경기 출전 정지</b></div>}
            {st.wantsOut && <div className="ps-row bad"><span>상태</span><b>✈️ 이적 요청</b></div>}
            {st.promise !== undefined && <div className="ps-row"><span>약속</span><b>다음 경기 선발</b></div>}
          </div>
        </div>

        <WikiProfile profile={profile} />

        <h4>이번 시즌</h4>
        <div className="ps-season">
          {[['경기', ps?.apps ?? 0], ['골', ps?.g ?? 0], ['도움', ps?.a ?? 0], ['평점', ps?.apps ? (ps.rsum / ps.apps).toFixed(2) : '-'], ['MOM', ps?.mom ?? 0], ['경고', ps?.yc ?? 0]].map(([l, v]) => (
            <div key={l}><b>{v}</b><span>{l}</span></div>
          ))}
        </div>

        {mine && (
          <>
            {onToggle && (
              <button className={`btn wide ${inLineup ? 'ghost' : ''}`} disabled={!inLineup && (st.inj > 0 || st.susp > 0)} onClick={onToggle}>
                {inLineup ? '선발에서 빼기' : st.inj > 0 || st.susp > 0 ? '출전 불가' : '선발에 넣기'}
              </button>
            )}
            <h4>개별 면담 <span className="muted small">{talked ? '이번 라운드 면담 완료' : '라운드당 1회 · 최근 폼에 맞는 말을 해야 효과가 있습니다'}</span></h4>
            <div className="options">
              {PLAYER_TALKS.map(([k, label, desc]) => (
                <button key={k} className="option" disabled={talked} onClick={() => setReply(talkTo(player.id, k))}>
                  <strong>{label}</strong><span className="small muted">{desc}</span>
                </button>
              ))}
            </div>
            {reply && <p className="notice">{reply}</p>}
            <h4>직접 말하기 <span className="muted small">성격: {personalityText(personality(player)).join(' · ')}</span></h4>
            <SayBox disabled={talked} onSay={(t) => sayTo(player.id, t)} />
          </>
        )}
      </div>
    </div>
  )
}

// 위키백과 프로필: 사진·한글 이름·소개·키·생년월일·출생지·실제 포지션
function WikiProfile({ profile }) {
  if (!profile) return <div className="wiki loading"><span className="spin" /> 위키백과에서 프로필을 찾는 중…</div>
  if (profile.none || profile.error) return <p className="wiki none small muted">{profile.error ? '프로필을 불러오지 못했습니다 (네트워크).' : '위키백과에 이 선수 문서가 없습니다.'}</p>
  const text = profile.koExtract || profile.extract
  return (
    <div className="wiki">
      <div className="wiki-head">
        {profile.photo && <img className="wiki-photo" src={profile.photo} alt="" loading="lazy" />}
        <div className="grow">
          {profile.koName && <strong className="wiki-name">{profile.koName}</strong>}
          <span className="muted small">{profile.en}{profile.desc ? ` · ${profile.desc}` : ''}</span>
          <div className="wiki-facts">
            {profile.height && <span>📏 {profile.height}cm</span>}
            {profile.born && <span>🎂 {profile.born}</span>}
            {profile.birthplace && <span>📍 {profile.birthplace}</span>}
            {profile.positions?.length > 0 && <span>⚽ {profile.positions.slice(0, 2).join(' · ')}</span>}
          </div>
        </div>
      </div>
      {text && <p className="wiki-text">{text.length > 320 ? `${text.slice(0, 320)}…` : text}</p>}
      <a className="wiki-src" href={profile.koUrl || profile.url} target="_blank" rel="noreferrer">출처: 위키백과 (CC BY-SA) · 사진: 위키미디어 공용 ↗</a>
    </div>
  )
}
