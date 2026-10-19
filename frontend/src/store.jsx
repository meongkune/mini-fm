import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { api } from './api.js'

// 시즌 진행 상황은 서버가 아니라 브라우저 localStorage에 저장한다 (서버는 stateless).
// v2: 프리미어리그 구단 데이터로 바뀌면서 이전 저장(가상 구단 ID)과 호환되지 않아 키를 올림
const STORAGE_KEY = 'mini-fm-save-v1'
const FORMATION_SLOTS = { '4-4-2': [4, 4, 2], '4-3-3': [4, 3, 3], '3-5-2': [3, 5, 2], '5-3-2': [5, 3, 2] }
const EMPTY_SAVE = {
  teamId: null,
  formation: '4-4-2',
  mentality: 'balanced',
  pressing: 'normal',
  lineup: [],
  round: 0,
  results: [],
}

function loadSave() {
  try {
    return { ...EMPTY_SAVE, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }
  } catch {
    return EMPTY_SAVE
  }
}

export function playerOvr(p) {
  if (p.pos === 'GK') return p.def
  if (p.pos === 'DF') return Math.round(p.def * 0.8 + p.att * 0.2)
  if (p.pos === 'FW') return Math.round(p.att * 0.8 + p.def * 0.2)
  return Math.round((p.att + p.def) / 2)
}

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

export function formationNeeds(formation) {
  const [df, mf, fw] = FORMATION_SLOTS[formation] || FORMATION_SLOTS['4-4-2']
  return { GK: 1, DF: df, MF: mf, FW: fw }
}

export function computeStandings(teams, results) {
  const table = Object.fromEntries(
    teams.map((t) => [t.id, { id: t.id, name: t.name, color: t.color, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] }]),
  )
  for (const r of results) {
    const [hg, ag] = r.score
    const h = table[r.home]
    const a = table[r.away]
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

  useEffect(() => {
    Promise.all([api.teams(), api.schedule()])
      .then(([t, s]) => setData({ ...t, schedule: s.rounds }))
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(save)) } catch { /* 저장 실패해도 게임은 계속 */ }
  }, [save])

  const value = useMemo(() => {
    const teamsById = data ? Object.fromEntries(data.teams.map((t) => [t.id, t])) : {}
    const myTeam = save.teamId ? teamsById[save.teamId] : null
    const totalRounds = data ? data.schedule.length : 0
    const seasonOver = data ? save.round >= totalRounds : false
    const nextFixture = data && myTeam && !seasonOver
      ? data.schedule[save.round].find((m) => m.home === myTeam.id || m.away === myTeam.id)
      : null

    const update = (patch) => setSave((s) => ({ ...s, ...patch }))

    return {
      data, error, save, teamsById, myTeam, totalRounds, seasonOver, nextFixture, update,
      standings: data ? computeStandings(data.teams, save.results) : [],
      async chooseTeam(teamId) {
        const { lineup } = await api.autoLineup(teamId, '4-4-2')
        setSave({ ...EMPTY_SAVE, teamId, lineup })
      },
      resetSeason() {
        setSave((s) => ({ ...s, round: 0, results: [] }))
      },
      quitTeam() {
        setSave(EMPTY_SAVE)
      },
      async finishRound(myResult) {
        const { results } = await api.playRound(save.round, save.teamId)
        const round = save.round
        setSave((s) => ({
          ...s,
          round: s.round + 1,
          results: [...s.results, { round, ...myResult, mine: true }, ...results.map((r) => ({ round, ...r }))],
        }))
      },
    }
  }, [data, error, save])

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

export function useGame() {
  return useContext(GameContext)
}
