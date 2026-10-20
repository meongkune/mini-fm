import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import { playerOvrOf } from './engine/engine.js'
import { available } from './engine/match.js'
import { assignSlots, buildSlots, fitOf, shapeNeeds } from './engine/formation.js'
import { applyRound, engineStatus, playerTalk, resolveTalk } from './game/season.js'
import { effectiveTeams } from './game/roster.js'
import { evaluateTrade, executeTrade, windowState } from './game/trade.js'
import { boardMidCheck, newBoard, nextSeason, seasonLabel, seasonReview } from './game/career.js'

// 시즌 진행 상황은 서버가 아니라 브라우저 localStorage에 저장한다 (서버는 stateless).
// v2: 프리미어리그 구단 데이터로 바뀌면서 이전 저장(가상 구단 ID)과 호환되지 않아 키를 올림
const STORAGE_KEY = 'mini-fm-save-v1'
const MANAGER_KEY = 'mini-fm-manager' // 감독 프로필은 세이브와 따로 (경질·팀 변경에도 유지)
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
  board: null, // 보드 목표·신뢰도
}

function loadSave() {
  try {
    return { ...EMPTY_SAVE, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }
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

export const formationNeeds = shapeNeeds

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

export function computeStandings(teams, results) {
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
    const nextFixture = data && myTeam && !seasonOver
      ? data.schedule[save.round].find((m) => m.home === myTeam.id || m.away === myTeam.id)
      : null

    const update = (patch) => setSave((s) => ({ ...s, ...patch }))

    return {
      manager,
      saveManager(m) { setManager(m); try { localStorage.setItem(MANAGER_KEY, JSON.stringify(m)) } catch { /* 저장 실패 무시 */ } },
      data, error, save, teams, teamsById, myTeam, totalRounds, seasonOver, nextFixture, update, status,
      standings: data ? computeStandings(teams, save.results) : [],
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
      review: data && save.teamId && save.round >= data.schedule.length ? seasonReview(save, computeStandings(teams, save.results)) : null,
      /** 시즌 마감 → 다음 시즌 (경질되면 팀 선택으로) */
      startNextSeason() {
        setSave((s) => {
          const standingsNow = computeStandings(teams, s.results)
          const r = nextSeason(s, { teams, baseTeams: data.teams, standings: standingsNow, country: data.leagueInfo.country, baseSeason: data.season })
          if (r.review.sacked) {
            return { ...EMPTY_SAVE, league: s.league, season: s.season, sacked: { team: s.teamId, history: r.save.history } }
          }
          const nextTeams = effectiveTeams(data.teams, r.save)
          const mine = nextTeams.find((t) => t.id === s.teamId)
          const keep = Object.fromEntries(r.save.lineup.map((id, i) => [i, id]).filter(([, id]) => id && mine.players.some((p) => p.id === id)))
          const lineup = autoSlots(mine, s.formation, {}, keep)
          return { ...r.save, lineup, board: newBoard(nextTeams, s.teamId, { confidence: r.conf, fails: r.review.fails }) }
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
        setSave((s) => {
          const next = applyRound(s, { teamsById, schedule: data.schedule, myTeamId: s.teamId, mine })
          return boardMidCheck(next, computeStandings(teams, next.results), data.schedule.length)
        })
      },
    }
  }, [data, error, save, manager])

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

export function useGame() {
  return useContext(GameContext)
}
