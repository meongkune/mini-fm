// API-Football 무료 플랜으로 K리그를 받을 수 있는지 시험 (요청 3~4회만 사용)
// 실행: API_FOOTBALL_KEY=... node tools/apifootball_probe.mjs
const KEY = process.env.API_FOOTBALL_KEY
if (!KEY) throw new Error('API_FOOTBALL_KEY 환경 변수가 없습니다')
const get = async (p) => {
  const res = await fetch(`https://v3.football.api-sports.io${p}`, { headers: { 'x-apisports-key': KEY } })
  const j = await res.json()
  console.log(`\n## ${p} → HTTP ${res.status} · 남은 요청 ${res.headers.get('x-ratelimit-requests-remaining')}/${res.headers.get('x-ratelimit-requests-limit')}`)
  if (j.errors && Object.keys(j.errors).length) console.log('errors:', JSON.stringify(j.errors))
  return j.response || []
}

// 1) 한국 리그 목록과 시즌별 지원 범위
const leagues = await get('/leagues?country=South-Korea')
for (const l of leagues) {
  const last = l.seasons.slice(-3).map((s) => `${s.year}${s.current ? '(현재)' : ''} players:${s.coverage?.players} injuries:${s.coverage?.injuries}`)
  console.log(`- [${l.league.id}] ${l.league.name} (${l.league.type}) · ${last.join(' | ')}`)
}
const k1 = leagues.find((l) => /K League 1/i.test(l.league.name))
if (!k1) process.exit(0)
const season = k1.seasons.find((s) => s.current)?.year ?? k1.seasons.at(-1).year

// 2) 현재 시즌 팀 목록 (무료 플랜이 이 시즌을 허용하는지)
const teams = await get(`/teams?league=${k1.league.id}&season=${season}`)
console.log(`K리그1 ${season} 팀 ${teams.length}개:`, teams.map((t) => `${t.team.id}:${t.team.name}`).join(', '))

// 3) 한 팀의 현재 명단 (시즌 지정 없는 엔드포인트)
if (teams[0]) {
  const sq = await get(`/players/squads?team=${teams[0].team.id}`)
  const ps = sq[0]?.players || []
  console.log(`${teams[0].team.name} 현재 명단 ${ps.length}명 예시:`, ps.slice(0, 6).map((p) => `${p.name}(${p.age}세 ${p.position} #${p.number ?? '-'})`).join(', '))
}
