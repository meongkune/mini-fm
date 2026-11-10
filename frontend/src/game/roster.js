import { inferRoles } from '../engine/formation.js'

// 세이브 안에서 바뀐 선수단을 원본 시즌 데이터 위에 입힌다
// save.rosters: { teamId: [playerId…] } (트레이드 결과), save.mods: { playerId: {att, def, sta, age} } (성장·노화),
// save.youth: [선수 객체…] (유스 입단)
export function effectiveTeams(baseTeams, save) {
  const all = {}
  for (const t of baseTeams) for (const p of t.players) all[p.id] = p
  for (const p of [...(save.youth || []), ...(save.signed || [])]) all[p.id] = { ...p, name: cleanName(p.name) }
  const mods = save.mods || {}
  const withMods = (p) => (mods[p.id] ? { ...p, ...mods[p.id] } : p)
  // 세이브에 명단이 저장된 뒤 데이터에 새로 들어온 선수(명단 갱신으로 추가된 선수)는 원래 구단에 붙인다
  //   단, 이미 어느 명단에 있거나 · 방출(FA) · 해외로 판 선수는 제외
  const placed = save.rosters ? new Set(Object.values(save.rosters).flat()) : null
  const away = new Set([...(save.released || []).map((p) => p.id), ...Object.keys(save.abroad || {}), ...Object.keys(save.gone || {})])
  return baseTeams.map((t) => {
    const ids = save.rosters?.[t.id]
    const fresh = ids ? t.players.filter((p) => !placed.has(p.id) && !away.has(p.id)).map((p) => p.id) : []
    const players = ids ? [...new Set([...ids, ...fresh])].map((id) => all[id]).filter(Boolean) : t.players // 같은 선수가 두 번 들어가지 않게
    // 세부 포지션이 없는 선수는 팀 안 능력치 성향으로 역할을 정한다
    return { ...t, players: inferRoles(players.map(withMods)) }
  })
}

/** 선수 ID → 지금 소속 팀 ID */
export function teamOfPlayer(teams, id) {
  return teams.find((t) => t.players.some((p) => p.id === id))?.id ?? null
}

/** "이인규 (축구 선수)" 같은 위키 표기에서 괄호 설명을 뗀다 */
export const cleanName = (n = '') => n.replace(/\s*\([^)]*\)\s*$/, '').trim() || n
