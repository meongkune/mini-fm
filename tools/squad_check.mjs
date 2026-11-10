// 명단 점검: 한 구단의 원본 명단을 football-data.org와 API-Football에서 받아 비교한다 (요청 각 1~2회)
// 실행: FOOTBALL_DATA_TOKEN=... API_FOOTBALL_KEY=... node tools/squad_check.mjs <football-data 대회 코드> <구단 이름 일부> <API-Football 구단 ID>
//   예: node tools/squad_check.mjs PL Brentford 55
const [comp = 'PL', name = 'Brentford', afId = '55'] = process.argv.slice(2)
const fd = await fetch(`https://api.football-data.org/v4/competitions/${comp}/teams?season=2025`, { headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_TOKEN } }).then((r) => r.json())
const team = (fd.teams || []).find((t) => t.name.includes(name))
console.log(`## football-data.org · ${team?.name} 명단 ${team?.squad?.length ?? 0}명`)
for (const p of team?.squad || []) console.log(`- ${p.name} · ${p.position} · ${p.dateOfBirth}`)
if (process.env.API_FOOTBALL_KEY) {
  const af = await fetch(`https://v3.football.api-sports.io/players/squads?team=${afId}`, { headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY } }).then((r) => r.json())
  const ps = af.response?.[0]?.players || []
  console.log(`\n## API-Football · ${af.response?.[0]?.team?.name} 현재 명단 ${ps.length}명`)
  for (const p of ps) console.log(`- ${p.name} · ${p.position} · #${p.number ?? '-'} · ${p.age}세`)
}
