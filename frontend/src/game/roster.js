import { inferRoles } from '../engine/formation.js'

// 세이브 안에서 바뀐 선수단을 원본 시즌 데이터 위에 입힌다
// save.rosters: { teamId: [playerId…] } (트레이드 결과), save.mods: { playerId: {att, def, sta, age} } (성장·노화),
// save.youth: [선수 객체…] (유스 입단)
export function effectiveTeams(baseTeams, save) {
  const all = {}
  for (const t of baseTeams) for (const p of t.players) all[p.id] = p
  for (const p of save.youth || []) all[p.id] = p
  const mods = save.mods || {}
  const withMods = (p) => (mods[p.id] ? { ...p, ...mods[p.id] } : p)
  return baseTeams.map((t) => {
    const ids = save.rosters?.[t.id]
    const players = ids ? ids.map((id) => all[id]).filter(Boolean) : t.players
    // 세부 포지션이 없는 선수는 팀 안 능력치 성향으로 역할을 정한다
    return { ...t, players: inferRoles(players.map(withMods)) }
  })
}

/** 선수 ID → 지금 소속 팀 ID */
export function teamOfPlayer(teams, id) {
  return teams.find((t) => t.players.some((p) => p.id === id))?.id ?? null
}
