// Flask API 호출 모음
async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`)
  return data
}

export const api = {
  teams: () => request('/api/teams'),
  schedule: () => request('/api/league/schedule'),
  autoLineup: (teamId, formation) =>
    request(`/api/teams/${teamId}/auto-lineup?formation=${encodeURIComponent(formation)}`),
  simulate: (body) => request('/api/match/simulate', { method: 'POST', body: JSON.stringify(body) }),
  playRound: (round, skipTeam) =>
    request('/api/league/round', { method: 'POST', body: JSON.stringify({ round, skip_team: skipTeam }) }),
  meta: () => request('/api/meta'),
}
