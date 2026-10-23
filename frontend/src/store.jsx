import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { api, loadSeasonFile } from './api.js'
import { playerOvrOf } from './engine/engine.js'
import { available } from './engine/match.js'
import { assignSlots, buildSlots, fitOf, shapeNeeds } from './engine/formation.js'
import { applyCupMatch, applyRound, customTalk, engineStatus, news, playerTalk, resolveTalk } from './game/season.js'
import { cleanName, effectiveTeams } from './game/roster.js'
import { applyTalkResult } from './game/aiTalk.js'
import { checkPromises } from './game/relations.js'
import { evaluateTrade, executeTrade, windowState } from './game/trade.js'
import { boardMidCheck, newBoard, nextSeason, seasonLabel, seasonReview } from './game/career.js'
import { COMPS, CUP_LEAGUES, buildCups, cupKey, cupStatus, dueMatchday, myCupFixture, playMatchday } from './game/cup.js'
import { ROSTER_MAX, book, checkBankruptcy, contractOf, eur, faDecision, ffpReview, newFinance, prizeMoney, releaseCost, renewalAsk, settleMatch, wageBill, wageBudget, wageFor, wageShock } from './game/finance.js'
import { afterMatchOwner, decide } from './game/owner.js'
import { valueOf } from './game/trade.js'

// 시즌 진행 상황은 서버가 아니라 브라우저 localStorage에 저장한다 (서버는 stateless).
// v2: 프리미어리그 구단 데이터로 바뀌면서 이전 저장(가상 구단 ID)과 호환되지 않아 키를 올림
const STORAGE_KEY = 'mini-fm-save-v1'
const MANAGER_KEY = 'mini-fm-manager' // 감독 프로필은 세이브와 따로 (경질·팀 변경에도 유지)
try { indexedDB.deleteDatabase('mini-fm') } catch { /* 예전 VRM 감독 파일 정리 */ }
const EMPTY_SAVE = {
  league: null, // 리그 ID (예: premier-league) — null이면 index.json 기본값
  season: null, // 시즌 ID (예: 2025-26)
  teamId: null,
  formation: '4-4-2',
  mentality: 'balanced',
  pressing: 'normal',
  lineup: [], // 포메이션 자리 순서대로 선수 ID (빈 자리는 null)
  line: 'normal', // 수비 라인
  tempo: 'normal', // 템포
  round: 0,
  results: [],
  // 감독 모드
  seasonNo: 1, // 같은 시즌 데이터로 몇 번째 시즌인지
  status: {}, // 선수 상태: 컨디션·사기·폼·부상·징계
  pstats: {}, // 선수 시즌 기록: 출전·골·도움·평점·클린시트·카드·MOM
  inbox: [], // 받은 편지함
  rosters: null, // 트레이드로 바뀐 선수단 { teamId: [playerId] }
  mods: {}, // 성장·노화로 바뀐 능력치
  youth: [], // 유스 입단 선수
  history: [], // 지난 시즌 기록
  finance: null, // 구단 재정 { cash, ticket, last, ledger }
  fans: 60, // 팬 민심 0~100
  owner: {}, // 구단주 결정 상태
  contracts: {}, // 선수 계약 { until(시즌 번호), wage(€M/년) }
  signed: [], // FA로 영입한 선수
  released: [], // 방출한 선수 (다시 FA 시장에)
  board: null, // 보드 목표·신뢰도
}

function loadSave() {
  try {
    const s = { ...EMPTY_SAVE, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }
    // 예전 버그로 생긴 중복 영입·괄호 붙은 이름 정리
    if (s.rosters) s.rosters = Object.fromEntries(Object.entries(s.rosters).map(([k, ids]) => [k, [...new Set(ids)]]))
    if (s.signed) s.signed = s.signed.map((p) => ({ ...p, name: cleanName(p.name) }))
    return s
  } catch {
    return EMPTY_SAVE
  }
}

export const playerOvr = playerOvrOf

// 좁은 화면용 짧은 구단명 (예: 맨체스터 유나이티드 → 맨유)
export const short = (team) => team?.short || team?.name || ''

// 두 팀 색이 비슷하면(예: 아스널·리버풀 둘 다 빨강) 원정팀은 원정 유니폼 색을 쓴다
export function kitColors(home, away) {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [a, b] = [rgb(home.color), rgb(away.color)]
  const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  return [home.color, dist < 140 && away.alt ? away.alt : away.color]
}

// 밝은 색(흰 유니폼 등) 위에는 어두운 글자를 쓴다
export function ink(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#111827' : '#ffffff'
}

// 어두운 배경 위 막대·테두리용: 팀 색이 너무 어두우면(예: 뉴캐슬 검정) 밝은 회색으로
export function onDark(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.299 * r + 0.587 * g + 0.114 * b < 60 ? '#cbd5e1' : hex
}

export function teamOvr(team) {
  const top = [...team.players].map(playerOvr).sort((a, b) => b - a).slice(0, 11)
  return Math.round(top.reduce((s, v) => s + v, 0) / top.length)
}

/** 저장된 내 팀 전술 (경기 엔진에 넘기는 형태) */
export const myTactics = (save) => ({
  formation: save.formation, mentality: save.mentality, pressing: save.pressing, line: save.line ?? 'normal', tempo: save.tempo ?? 'normal',
  width: save.width ?? 50, passing: save.passing ?? 50, approach: save.approach || 'balanced', focus: save.focus || 'mixed', trap: !!save.trap, tackling: save.tackling || 'normal',
})

/** 이번 시즌 FFP 승점 감점 */
const penaltyOf = (save) => (save.pointsPenalty?.seasonNo === (save.seasonNo || 1) ? save.pointsPenalty : null)

const hashStr = (t) => { let h = 2166136261; for (const c of String(t)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }

export const formationNeeds = shapeNeeds

/**
 * 지금 라인업 기준 팀 OVR: 자리마다 (선수 OVR × 자리 적합도), 빈 자리는 0으로 계산
 * → 포지션이 맞지 않는 선수를 세우거나 자리를 비우면 그만큼 떨어진다
 */
export function lineupOvr(team, formation, lineup) {
  const slots = buildSlots(formation)
  const byId = Object.fromEntries(team.players.map((p) => [p.id, p]))
  let sum = 0
  slots.forEach((s, i) => { const p = byId[lineup?.[i]]; if (p) sum += playerOvr(p) * fitOf(p, s.role) })
  return Math.round(sum / slots.length)
}

/** 컨디션·출전 가능을 고려한 자동 배치 (자리 순서, 빈 자리는 null) */
export function autoSlots(team, formation, status = {}, keep = {}) {
  return assignSlots(team, formation, { status, keep, available: (id) => available(status, id) })
}

/** 고른 선수들은 그대로 두고 새 포메이션의 가장 알맞은 자리로 옮긴다 (남는 자리는 null) */
export function alignLineup(team, formation, ids) {
  const chosen = { players: ids.filter(Boolean).map((id) => team.players.find((p) => p.id === id)).filter(Boolean) }
  const out = assignSlots(chosen, formation, { useCondition: false })
  return out.slice(0, buildSlots(formation).length)
}

/** 빈 자리 중 이 선수에게 가장 알맞은 자리 인덱스 */
export function bestEmptySlot(formation, lineup, player) {
  const slots = buildSlots(formation)
  let best = -1
  let bestFit = -1
  slots.forEach((s, i) => {
    if (lineup[i]) return
    const f = fitOf(player, s.role)
    if (f > bestFit) { bestFit = f; best = i }
  })
  return best
}

export function computeStandings(teams, results, penalty = null) {
  const table = Object.fromEntries(
    teams.map((t) => [t.id, { id: t.id, name: t.name, color: t.color, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] }]),
  )
  for (const r of results) {
    const [hg, ag] = r.score
    const h = table[r.home]
    const a = table[r.away]
    if (!h || !a) continue // 다른 시즌 데이터가 섞인 경우 무시
    h.p++; a.p++
    h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg
    if (hg > ag) { h.w++; a.l++; h.pts += 3; h.form.push('W'); a.form.push('L') }
    else if (hg < ag) { a.w++; h.l++; a.pts += 3; h.form.push('L'); a.form.push('W') }
    else { h.d++; a.d++; h.pts++; a.pts++; h.form.push('D'); a.form.push('D') }
  }
  if (penalty?.points && table[penalty.teamId]) table[penalty.teamId].pts -= penalty.points // FFP 승점 감점
  return Object.values(table).sort(
    (x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.name.localeCompare(y.name),
  )
}

const GameContext = createContext(null)

export function GameProvider({ children }) {
  const [data, setData] = useState(null) // { league, teams, formations, schedule }
  const [error, setError] = useState(null)
  const [save, setSave] = useState(loadSave)
  const [manager, setManager] = useState(() => { try { return JSON.parse(localStorage.getItem(MANAGER_KEY) || 'null') } catch { return null } })
  const [cupTeams, setCupTeams] = useState({}) // 대항전에 나오는 다른 리그 팀 (키: 리그/팀ID)

  // 리그·시즌이 바뀔 때마다 해당 시즌 데이터를 불러온다
  useEffect(() => {
    let alive = true
    setData(null)
    setError(null)
    ;(async () => {
      const sel = await api.selectSeason(save.league, save.season)
      const [t, s, index] = await Promise.all([api.teams(), api.schedule(), api.index()])
      // 시즌 데이터를 다시 가져와 선수 ID가 바뀌었으면 선발을 자동으로 다시 고른다
      const team = effectiveTeams(t.teams, save).find((x) => x.id === save.teamId)
      // 선발: 없는 선수가 있거나 예전(자리 순서가 아닌) 형식이면 고른 선수를 유지한 채 자리에 맞춰 다시 배치
      const invalid = team && save.lineup.some((id) => id && !team.players.some((p) => p.id === id))
      const legacy = team && !save.slotLineup
      const fresh = team && (invalid || legacy || save.lineup.length !== 11)
        ? (() => {
            const kept = alignLineup(team, save.formation, save.lineup.filter((id) => id && team.players.some((p) => p.id === id)))
            const keep = Object.fromEntries(kept.map((id, i) => [i, id]).filter(([, id]) => id))
            return autoSlots(team, save.formation, {}, keep)
          })()
        : null
      if (!alive) return
      setData({ ...t, schedule: s.rounds, index, leagueId: sel.leagueId, seasonId: sel.seasonId })
      setSave((cur) => {
        // 저장된 팀이 이 시즌에 없으면(시즌 파일 교체 등) 팀 선택부터 다시
        const teamMissing = cur.teamId && !t.teams.some((x) => x.id === cur.teamId)
        if (teamMissing) return { ...EMPTY_SAVE, league: sel.leagueId, season: sel.seasonId }
        if (fresh && cur.teamId === team.id) cur = { ...cur, lineup: fresh, slotLineup: true }
        if (cur.league === sel.leagueId && cur.season === sel.seasonId) return cur
        return { ...cur, league: sel.leagueId, season: sel.seasonId }
      })
    })().catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [save.league, save.season])

  // 예전 저장(보드 목표 없음)이면 지금 전력으로 목표를 정한다
  useEffect(() => {
    if (data && save.teamId && !save.board) setSave((s) => ({ ...s, board: newBoard(effectiveTeams(data.teams, s), s.teamId) }))
  }, [data, save.teamId, save.board])

  // 구단주 모드: 재정 시작, 내 선수 모두에게 계약을 고정 (없으면 생성)
  useEffect(() => {
    if (!data || !save.teamId) return
    const team = effectiveTeams(data.teams, save).find((t) => t.id === save.teamId)
    if (!team) return
    const missing = team.players.filter((p) => !save.contracts?.[p.id])
    if (save.finance?.base && !missing.length) return
    setSave((s) => {
      const contracts = { ...(s.contracts || {}) }
      for (const p of missing) contracts[p.id] = contractOf(s, p, data.leagueId)
      const fresh = newFinance(team, data.leagueId)
      // 예전 재정(수입 기준 없음)은 수입 기준만 채운다
      const finance = s.finance ? { ...s.finance, base: s.finance.base || fresh.base, cash: s.finance.base ? s.finance.cash : fresh.cash } : fresh
      return { ...s, contracts, finance, fans: s.fans ?? 60 }
    })
  }, [data, save.teamId, save.rosters, save.signed?.length, save.youth?.length, save.finance?.base ? 1 : 0])

  // 대항전(챔스·유로파·컨퍼런스): 시즌마다 참가팀을 뽑고(다른 리그 파일을 읽어서) 대진을 만든다
  const seasonNo = save.seasonNo || 1
  useEffect(() => {
    if (!data || !save.teamId || !CUP_LEAGUES.includes(data.leagueId)) return
    let alive = true
    ;(async () => {
      const leagues = data.index.leagues.filter((l) => CUP_LEAGUES.includes(l.id))
      const loaded = []
      for (const l of leagues) {
        const s = l.seasons.find((x) => x.id === data.seasonId)
        if (!s) continue
        if (l.id === data.leagueId) loaded.push({ leagueId: l.id, teams: effectiveTeams(data.teams, save), order: seasonNo > 1 ? save.lastOrder : null })
        else loaded.push({ leagueId: l.id, teams: (await loadSeasonFile(s.file)).teams })
      }
      if (!alive) return
      const map = {}
      for (const l of loaded) for (const t of l.teams) map[cupKey(l.leagueId, t.id)] = t
      setCupTeams(map)
      if (!save.cups || save.cupSeason !== seasonNo) {
        const cups = buildCups(loaded, { seed: seasonNo * 101 + (save.teamId || '').length, totalRounds: data.schedule.length })
        setSave((cur) => { const { cup: _old, ...rest } = cur; return { ...rest, cups, cupSeason: seasonNo } })
      }
    })().catch((e) => console.warn('대항전 준비 실패', e))
    return () => { alive = false }
  }, [data, save.teamId, seasonNo, save.cupSeason])

  // 내 팀 경기가 없는 대회 매치데이(미참가·탈락·다른 조)는 자동으로 진행
  useEffect(() => {
    const cups = save.cups || []
    if (!data || !cups.length || !cups.every((c) => c.teams.every((t) => cupTeams[t.key] || t.leagueId === data.leagueId))) return
    const myKey = cupKey(data.leagueId, save.teamId)
    const due = cups.map((c) => { const md = dueMatchday(c, save.round); return md && !myCupFixture(c, md, myKey) ? md : null })
    if (!due.some(Boolean)) return
    const leagueKeyed = Object.fromEntries(effectiveTeams(data.teams, save).map((t) => [cupKey(data.leagueId, t.id), t]))
    const all = { ...cupTeams, ...leagueKeyed }
    setSave((s) => {
      const st = engineStatus(s, Object.values(all))
      return { ...s, cups: s.cups.map((c, i) => (due[i] ? playMatchday(c, due[i], all, st, null, s.seasonNo || 1).cup : c)) }
    })
  }, [data, save.cups, save.round, cupTeams])

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(save)) } catch { /* 저장 실패해도 게임은 계속 */ }
  }, [save])

  const value = useMemo(() => {
    const teams = data ? effectiveTeams(data.teams, save) : []
    const teamsById = Object.fromEntries(teams.map((t) => [t.id, t]))
    const status = data ? engineStatus(save, teams) : {}
    const myTeam = save.teamId ? teamsById[save.teamId] : null
    const totalRounds = data ? data.schedule.length : 0
    const seasonOver = data ? save.round >= totalRounds : false
    // 대항전: 내 팀 키, 다른 리그 팀을 포함한 팀 찾기, 내가 나가는 대회와 이번에 치를 매치데이
    const myKey = data && save.teamId ? cupKey(data.leagueId, save.teamId) : null
    const leagueKeyed = data ? Object.fromEntries(teams.map((t) => [cupKey(data.leagueId, t.id), t])) : {}
    const allTeams = { ...cupTeams, ...leagueKeyed }
    const cups = save.cups || []
    const cupIdx = cups.findIndex((c) => c.teams.some((t) => t.key === myKey))
    const cup = cupIdx >= 0 ? cups[cupIdx] : null
    const comp = cup ? COMPS[cup.tier] : null
    const cupReady = cup && cup.teams.every((t) => allTeams[t.key])
    const cupMd = cupReady ? dueMatchday(cup, save.round) : null
    const myCup = cupMd ? myCupFixture(cup, cupMd, myKey) : null
    const leagueFixture = data && myTeam && !seasonOver
      ? data.schedule[save.round].find((m) => m.home === myTeam.id || m.away === myTeam.id)
      : null
    // 다음 경기: 유럽 대항전이 끼어 있으면 그것부터. homeTeam/awayTeam은 팀 객체, isHome은 내 팀이 홈인지
    const nextFixture = myCup
      ? { ...myCup, cup: true, label: `${comp.short} ${cupMd.label}`, comp, homeTeam: allTeams[myCup.home], awayTeam: allTeams[myCup.away], isHome: myCup.home === myKey }
      : leagueFixture
        ? { ...leagueFixture, homeTeam: teamsById[leagueFixture.home], awayTeam: teamsById[leagueFixture.away], isHome: leagueFixture.home === myTeam.id, label: `${save.round + 1}라운드` }
        : null

    const update = (patch) => setSave((s) => ({ ...s, ...patch }))

    return {
      manager,
      saveManager(m) { setManager(m); try { localStorage.setItem(MANAGER_KEY, JSON.stringify(m)) } catch { /* 저장 실패 무시 */ } },
      data, error, save, teams, teamsById, myTeam, totalRounds, seasonOver, nextFixture, update, status,
      cups, cup, cupIdx, cupMd, allTeams, myKey, cupState: cup ? cupStatus(cup, myKey) : null,
      standings: data ? computeStandings(teams, save.results, penaltyOf(save)) : [],
      unread: (save.inbox || []).filter((x) => !x.read).length,
      /** 컨디션·부상·징계를 고려한 베스트 11 */
      autoPick(formation = save.formation, teamId = save.teamId) {
        return autoSlots(teamsById[teamId], formation, status)
      },
      chooseTeam(teamId) {
        const lineup = autoSlots(teamsById[teamId], '4-4-2', {})
        const base = effectiveTeams(data.teams, EMPTY_SAVE)
        setSave((s) => ({ ...EMPTY_SAVE, league: s.league, season: s.season, teamId, lineup, slotLineup: true, board: newBoard(base, teamId) }))
      },
      seasonText: data ? `${data.leagueInfo.name} ${seasonLabel(data.season, save.seasonNo)}` : '',
      review: data && save.teamId && save.round >= data.schedule.length ? seasonReview(save, computeStandings(teams, save.results, penaltyOf(save))) : null,
      /** 시즌 마감 → 다음 시즌 (경질되면 팀 선택으로) */
      startNextSeason() {
        setSave((s) => {
          const standingsNow = computeStandings(teams, s.results, penaltyOf(s))
          const r = nextSeason(s, { teams, baseTeams: data.teams, standings: standingsNow, country: data.leagueInfo.country, baseSeason: data.season })
          if (r.review.sacked) {
            return { ...EMPTY_SAVE, league: s.league, season: s.season, sacked: { team: s.teamId, history: r.save.history } }
          }
          // 구단주 결산: 순위 상금, 사채 상환, 계약 만료 선수 이탈
          const pos = standingsNow.findIndex((x) => x.id === s.teamId) + 1
          const prize = prizeMoney(pos, standingsNow.length, s.finance?.base || 40)
          const repay = Math.min(s.owner?.debt || 0, Math.round(((s.owner?.debt || 0) / 2) * 10) / 10)
          const settled = book(book(r.save.finance || {}, prize), -repay)
          const ffp = ffpReview(settled, wageBill(s, myTeam, data.leagueId), s.seasonNo || 1)
          const finance = { ...ffp.finance, ...(ffp.penalty ? { ban: (s.seasonNo || 1) + 1 } : {}) }
          const owner = { ...(r.save.owner || {}), debt: Math.round(((s.owner?.debt || 0) - repay) * 10) / 10, used: {}, youthBoost: false, sponsorBoost: 0 }
          const leaving = Object.entries(s.contracts || {}).filter(([id, c]) => c.until < (s.seasonNo || 1) + 1 && r.save.rosters?.[s.teamId]?.includes(id)).map(([id]) => id)
          const byIdNow = Object.fromEntries(teams.flatMap((t) => t.players).map((p) => [p.id, p]))
          const rosters = { ...r.save.rosters, [s.teamId]: r.save.rosters[s.teamId].filter((id) => !leaving.includes(id)) }
          const released = [...(s.released || []), ...leaving.map((id) => byIdNow[id]).filter(Boolean).map((p) => ({ ...p, from: s.teamId }))]
          const closing = [
            news(0, 'finance', `💼 시즌 결산: 상금 ${eur(prize)}`, `${pos}위 상금 ${eur(prize)}${repay ? ` · 사채 상환 ${eur(repay)}` : ''}. 시즌 손익 ${eur(ffp.st.cur)} · FFP ${ffp.st.label}. 현재 현금 ${eur(finance.cash)}.`),
            ...(ffp.penalty ? [news(0, 'finance', '⚖️ FFP 위반 징계', `최근 3시즌 손익 ${eur(ffp.st.total)} (허용 -${eur(ffp.st.allowance)}) · 매출 대비 연봉 ${Math.round(ffp.st.ratio * 100)}%. 벌금 ${eur(ffp.penalty.fine)}, 이번 시즌 선수 영입 금지${ffp.penalty.points ? `, 승점 ${ffp.penalty.points}점 감점` : ''}.`)] : []),
            ...(leaving.length ? [news(0, 'contract', `📄 계약 만료 ${leaving.length}명 이탈`, `${leaving.map((id) => byIdNow[id]?.name).join(', ')} 선수가 계약이 끝나 팀을 떠났습니다. FA 시장에서 다시 영입할 수 있습니다.`)] : []),
          ]
          r.save = { ...r.save, finance, owner, rosters, released, lineup: r.save.lineup.map((id) => (leaving.includes(id) ? null : id)), inbox: [...closing, ...(r.save.inbox || [])].slice(0, 80) }
          const nextTeams = effectiveTeams(data.teams, r.save)
          const mine = nextTeams.find((t) => t.id === s.teamId)
          const keep = Object.fromEntries(r.save.lineup.map((id, i) => [i, id]).filter(([, id]) => id && mine.players.some((p) => p.id === id)))
          const lineup = autoSlots(mine, s.formation, {}, keep)
          const pointsPenalty = ffp.penalty?.points ? { seasonNo: (s.seasonNo || 1) + 1, teamId: s.teamId, points: ffp.penalty.points } : null
          return { ...r.save, pointsPenalty, lineup, lastOrder: standingsNow.map((x) => x.id), board: newBoard(nextTeams, s.teamId, { confidence: r.conf, fails: r.review.fails }) }
        })
      },
      readInbox(id) {
        setSave((s) => ({ ...s, inbox: s.inbox.map((x) => (x.id === id || id === 'all' ? { ...x, read: true } : x)) }))
      },
      answerTalk(id, action) {
        setSave((s) => resolveTalk(s, id, action))
      },
      transferWindow: data ? windowState(save.round, data.schedule.length) : { open: false },
      /** 트레이드 제안 평가 (상대 구단 AI) */
      proposeTrade(theirId, give, get) {
        return evaluateTrade({ mine: teamsById[save.teamId], theirs: teamsById[theirId], give, get, status })
      },
      /** 트레이드 실행 */
      doTrade(theirId, give, get) {
        setSave((s) => executeTrade(s, teams, s.teamId, theirId, give, get))
      },
      /** 편지함의 상대 구단 제안에 답 */
      answerOffer(id, action) {
        setSave((s) => {
          const item = s.inbox.find((x) => x.id === id)
          if (!item?.offer || item.resolved) return s
          const { teamId, give, get } = item.offer
          const valid = give.every((x) => teamsById[s.teamId]?.players.some((p) => p.id === x)) && get.every((x) => teamsById[teamId]?.players.some((p) => p.id === x))
          const mark = (sv, reply) => ({ ...sv, inbox: sv.inbox.map((x) => (x.id === id ? { ...x, resolved: action, reply, read: true } : x)) })
          if (action !== 'accept') return mark(s, '제안을 거절했습니다.')
          if (!valid) return mark(s, '이미 선수 구성이 바뀌어 제안이 무효가 됐습니다.')
          if (!windowState(s.round, data.schedule.length).open) return mark(s, '이적 시장이 닫혀 진행할 수 없습니다.')
          return mark(executeTrade(s, teams, s.teamId, teamId, give, get), '트레이드가 성사됐습니다.')
        })
      },
      /** 구단주 결정 실행 → { title, text, good } */
      ownerDecide(key) {
        const r = decide(save, key, { team: myTeam, leagueId: data.leagueId })
        setSave(r.save)
        return r
      },
      setTicket(pct) { setSave((s) => ({ ...s, finance: { ...s.finance, ticketPct: pct } })) },
      setWageRatio(ratio) { setSave((s) => ({ ...s, finance: { ...s.finance, wageRatio: ratio } })) },
      contractOf: (p) => contractOf(save, p, data?.leagueId),
      wageFor: (p) => wageFor(p, data?.leagueId),
      renewalAsk: (p) => renewalAsk(save, p, data?.leagueId, status[p.id]),
      /** 재계약 */
      renew(p, years, wage) {
        const billNow = wageBill(save, myTeam, data.leagueId)
        const old = contractOf(save, p, data.leagueId).wage
        if (wage > old && billNow - old + wage > wageBudget(save.finance)) return { ok: false, reason: `임금 예산 초과: 재계약하면 연봉 총액 ${eur(billNow - old + wage)} > 예산 ${eur(wageBudget(save.finance))}` }
        setSave((s) => {
          const st = { ...(s.status?.[p.id] || {}), morale: Math.min(100, (s.status?.[p.id]?.morale ?? 60) + 6), contractAsked: false }
          const kept = checkPromises(p, st, { round: s.round, sum: null, fitOk: false, renewed: true, sold: false }) // 재계약 약속을 지켰는지
          return {
            ...s,
            contracts: { ...s.contracts, [p.id]: { until: (s.seasonNo || 1) + years, wage } },
            status: { ...s.status, [p.id]: st },
            inbox: [...kept, news(s.round, 'contract', `✍️ ${p.name} 재계약`, `${years}년 연장, 연봉 ${eur(wage)}.`), ...(s.inbox || [])],
          }
        })
        return { ok: true }
      },
      releaseCost: (p) => releaseCost(save, p, data?.leagueId),
      /** 방출: 위약금을 내고 FA로 내보낸다 */
      release(p) {
        const cost = releaseCost(save, p, data.leagueId)
        setSave((s) => {
          const rosters = s.rosters || Object.fromEntries(teams.map((t) => [t.id, t.players.map((x) => x.id)]))
          return {
            ...s,
            rosters: { ...rosters, [s.teamId]: rosters[s.teamId].filter((id) => id !== p.id) },
            lineup: s.lineup.map((id) => (id === p.id ? null : id)),
            finance: book(s.finance, -cost),
            released: [...(s.released || []), { ...p, from: s.teamId }],
            fans: Math.max(0, (s.fans ?? 60) - (playerOvr(p) >= 80 ? 4 : 0)),
            inbox: [news(s.round, 'contract', `🚪 ${p.name} 방출`, `위약금 ${eur(cost)}을 내고 계약을 해지했습니다.`), ...(s.inbox || [])],
          }
        })
      },
      /** 강제 매각: 감독·선수 의사와 상관없이 AI 구단에 즉시 판다 (가치의 60~120%) */
      forceSell(p) {
        const others = teams.filter((t) => t.id !== save.teamId)
        const buyer = others.sort((a, b) => a.players.filter((x) => x.pos === p.pos).length - b.players.filter((x) => x.pos === p.pos).length)[0]
        const k = 0.6 + ((p.id.length * 7 + save.round * 13) % 60) / 100
        const fee = Math.round(valueOf(p, status[p.id]) * k * 10) / 10
        const star = [...myTeam.players].sort((a, b) => playerOvr(b) - playerOvr(a)).slice(0, 3).some((x) => x.id === p.id)
        setSave((s) => {
          const rosters = s.rosters || Object.fromEntries(teams.map((t) => [t.id, t.players.map((x) => x.id)]))
          return {
            ...s,
            rosters: { ...rosters, [s.teamId]: rosters[s.teamId].filter((id) => id !== p.id), [buyer.id]: [...rosters[buyer.id], p.id] },
            lineup: s.lineup.map((id) => (id === p.id ? null : id)),
            finance: book(s.finance, fee),
            fans: Math.max(0, (s.fans ?? 60) - (star ? 10 : 2)),
            inbox: [news(s.round, 'trade', `💸 ${p.name} 강제 매각`, `${buyer.name}에 ${eur(fee)}을 받고 팔았습니다.${star ? ' 핵심 선수를 판 구단주에게 팬들이 분노합니다. (민심 -10)' : ''}`), ...(s.inbox || [])],
          }
        })
        return { buyer: buyer.name, fee }
      },
      /** FA 제안 전 미리보기: 임금 체계·주급 총액 영향 */
      faPreview(p, wage) { return myTeam && data ? wageShock(save, myTeam, data.leagueId, p, wage) : null },
      /** FA 영입 제안 */
      offerFA(p, years, offerWage) {
        if (teams.some((t) => t.players.some((x) => x.id === p.id))) return { ok: false, reason: '이미 구단에 소속된 선수입니다.' }
        const size = myTeam.players.length
        if (size >= ROSTER_MAX) return { ok: false, reason: `로스터가 가득 찼습니다 (${ROSTER_MAX}명). 먼저 방출하세요.` }
        const top = myTeam.players.map(playerOvr).sort((a, b) => b - a).slice(0, 11)
        const d = faDecision(p, { offerWage, years, leagueId: data.leagueId, clubOvr: top.reduce((a, b) => a + b, 0) / top.length })
        if (!d.ok) return d
        const fee = Math.round(offerWage * 0.5 * 10) / 10 // 계약금
        if (save.finance?.ban === (save.seasonNo || 1)) return { ok: false, reason: 'FFP 위반 징계로 이번 시즌에는 선수를 영입할 수 없습니다.' }
        const billNow = wageBill(save, myTeam, data.leagueId)
        if (billNow + offerWage > wageBudget(save.finance)) return { ok: false, reason: `임금 예산 초과: 연봉 총액 ${eur(billNow + offerWage)} > 예산 ${eur(wageBudget(save.finance))}. 구단 운영에서 임금 예산을 늘리거나 선수를 정리하세요.` }
        if ((save.finance?.cash ?? 0) < fee) return { ok: false, reason: `계약금 ${eur(fee)}을 낼 현금이 없습니다 (보유 ${eur(save.finance?.cash ?? 0)}).` }
        const shock = wageShock(save, myTeam, data.leagueId, p, offerWage)
        const roll = (k) => (hashStr(`${p.id}-${k}-${save.round}`) % 100) / 100
        setSave((s) => {
          const rosters = s.rosters || Object.fromEntries(teams.map((t) => [t.id, t.players.map((x) => x.id)]))
          if (Object.values(rosters).some((ids) => ids.includes(p.id))) return s // 연속 클릭으로 두 번 들어오는 것 방지
          const used = new Set(myTeam.players.map((x) => x.number))
          const number = Array.from({ length: 98 }, (_, i) => i + 2).find((n) => !used.has(n))
          const signedP = { ...p, number, from: undefined }
          return {
            ...s,
            signed: [...(s.signed || []).filter((x) => x.id !== p.id), signedP],
            released: (s.released || []).filter((x) => x.id !== p.id),
            rosters: { ...rosters, [s.teamId]: [...rosters[s.teamId].filter((id) => id !== p.id), p.id] },
            contracts: { ...s.contracts, [p.id]: { until: (s.seasonNo || 1) + years - 1, wage: offerWage } },
            finance: book(s.finance, -fee),
            status: { ...s.status, [p.id]: { morale: 72, cond: 100 } },
            fans: Math.min(100, (s.fans ?? 60) + (playerOvr(p) >= 75 ? 3 : 1)),
            inbox: [news(s.round, 'trade', `✍️ FA 영입: ${p.name}`, `${years}년 계약, 연봉 ${eur(offerWage)}, 계약금 ${eur(fee)}.`), ...(s.inbox || [])],
          }
        })
        // 후폭풍: 임금 체계 붕괴(더 잘하는데 덜 받는 선수들 반발) · 과다 지출 비판
        const fallout = []
        if (shock.jealous.length) {
          const angry = [...shock.jealous].sort((a, b) => playerOvr(b) - playerOvr(a))
          const leaver = angry[0] && roll('out') < 0.35 ? angry[0] : null
          setSave((s) => {
            const st = { ...s.status }
            for (const x of angry) st[x.id] = { morale: 60, cond: 100, ...(st[x.id] || {}), morale: Math.max(0, (st[x.id]?.morale ?? 60) - 12) }
            if (leaver) st[leaver.id] = { ...st[leaver.id], wantsOut: true }
            const names = angry.slice(0, 3).map((x) => x.name).join('·')
            const item = news(s.round, 'talk', '😤 임금 체계 붕괴', `${p.name}이(가) ${eur(offerWage)}을 받는다는 소식에 ${names}${angry.length > 3 ? ` 등 ${angry.length}명` : ''}이(가) "우리가 더 잘하는데 왜 덜 받냐"며 반발합니다. (사기 -12)${leaver ? ` ${leaver.name}은(는) 결국 이적을 요청했습니다.` : ''}`)
            return { ...s, status: st, inbox: [item, ...(s.inbox || [])] }
          })
          fallout.push(`기존 선수 ${angry.length}명이 반발합니다 (사기 -12)${leaver ? ` · ${leaver.name} 이적 요청` : ''}`)
        }
        if (shock.overpay >= 1.6) {
          setSave((s) => ({ ...s, fans: Math.max(0, (s.fans ?? 60) - 5), inbox: [news(s.round, 'owner', '📰 "돈을 길바닥에 뿌린다"', `언론이 ${p.name}에게 요구액의 ${Math.round(shock.overpay * 100)}%를 준 계약을 맹비난합니다. (민심 -5)`), ...(s.inbox || [])] }))
          fallout.push('과다 지출 비판 (민심 -5)')
        }
        if (shock.newBill > shock.income) fallout.push(`주급 총액 ${eur(shock.newBill)}이 시즌 수입 ${eur(shock.income)}을 넘어 매 경기 적자가 납니다`)
        return { ...d, fee, fallout }
      },
      /** 직접 입력한 말로 면담 → 반응 결과 (itemId: 편지함 면담 요청에 대한 답) */
      sayTo(playerId, text, itemId = null) {
        const player = myTeam?.players.find((p) => p.id === playerId)
        if (!player || !text.trim()) return null
        const r = customTalk(save, player, text.trim(), itemId)
        if (r.blocked) return { blocked: r.blocked }
        setSave(r.save)
        return r.result
      },
      /** 배틀식 면담 결과 반영 (itemId: 편지함 면담 요청) */
      finishTalk(playerId, result, itemId = null) {
        const player = myTeam?.players.find((p) => p.id === playerId)
        if (!player) return
        setSave((s) => applyTalkResult(s, player, result, itemId).save)
      },
      /** 개별 면담 → 반응 문구를 돌려준다 */
      talkTo(playerId, kind) {
        const r = playerTalk(save, playerId, kind)
        setSave(r.save)
        return r.text
      },
      /** 리그·시즌 변경 — 진행 중인 시즌 기록은 초기화된다 */
      chooseSeason(league, season) {
        setSave({ ...EMPTY_SAVE, league, season })
      },
      resetSeason() {
        setSave((s) => ({ ...s, round: 0, results: [], status: {}, pstats: {}, inbox: [] }))
      },
      quitTeam() {
        setSave((s) => ({ ...EMPTY_SAVE, league: s.league, season: s.season }))
      },
      /** 내 경기 요약을 넣고 라운드 마무리 (다른 경기는 여기서 시뮬레이션) */
      finishRound(mine) {
        if (nextFixture?.cup) {
          // 대항전 경기: 대회 결과 반영 + 내 선수 상태 (리그 라운드는 그대로)
          const md = cupMd
          setSave((s) => {
            const r = playMatchday(s.cups[cupIdx], md, allTeams, engineStatus(s, Object.values(allTeams)), { home: nextFixture.home, away: nextFixture.away, summary: mine.summary }, seasonNo)
            const mineIdx = nextFixture.isHome ? 0 : 1
            const opp = mineIdx === 0 ? nextFixture.awayTeam : nextFixture.homeTeam
            const after = applyCupMatch({ ...s, cups: s.cups.map((c, i) => (i === cupIdx ? r.cup : c)) }, { myTeam, mineIdx, summary: mine.summary, label: `${cup.name} ${md.label}`, oppName: opp.name })
            const [gf, ga] = mineIdx === 0 ? mine.summary.score : [...mine.summary.score].reverse()
            const money = settleMatch(after, { team: myTeam, leagueId: data.leagueId, home: nextFixture.isHome, result: Math.sign(gf - ga), totalRounds: data.schedule.length, cupStage: md.stage, cupPay: comp.pay })
            return afterMatchOwner({ ...after, ...money }, Math.sign(gf - ga))
          })
          return
        }
        setSave((s) => {
          const next = applyRound(s, { teamsById, schedule: data.schedule, myTeamId: s.teamId, mine })
          const mineIdx = mine.home === s.teamId ? 0 : 1
          const [gf, ga] = mineIdx === 0 ? mine.summary.score : [...mine.summary.score].reverse()
          const money = settleMatch(next, { team: myTeam, leagueId: data.leagueId, home: mineIdx === 0, result: Math.sign(gf - ga), totalRounds: data.schedule.length })
          const owned = afterMatchOwner({ ...next, ...money }, Math.sign(gf - ga))
          const b = checkBankruptcy(owned, data.leagueId)
          if (b.bankrupt) return { ...EMPTY_SAVE, league: s.league, season: s.season, sacked: { team: s.teamId, history: s.history, bankrupt: true, cash: b.save.finance.cash } }
          return b.save
        })
      },
    }
  }, [data, error, save, manager, cupTeams])

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

export function useGame() {
  return useContext(GameContext)
}
