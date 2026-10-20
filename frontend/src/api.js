// 데이터·경기 계산 계층
// 서버 없이 동작한다: 리그·시즌 데이터는 정적 JSON(public/data)에서 읽고, 경기는 브라우저의 엔진이 계산한다.
// (Docker/ECS 버전처럼 Flask가 함께 있으면 /api/meta로 서버 정보도 보여준다.)
import { autoLineup as engineAutoLineup, roundRobin } from './engine/engine.js'
import { PRESETS } from './engine/formation.js'

const BASE = import.meta.env.BASE_URL // GitHub Pages면 '/mini-fm/', Docker면 '/'
const dataUrl = (file) => `${BASE}data/${file}`

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`데이터를 불러오지 못했습니다 (${res.status})`)
  return res.json()
}

let indexCache = null
let seasonCache = null // { key, data, teamsById, schedule }

export async function loadIndex() {
  indexCache ??= await getJson(dataUrl('index.json'))
  return indexCache
}

/** 리그·시즌 데이터를 읽고 일정까지 만들어 둔다. league/season을 생략하면 index.json의 기본값 */
export async function loadSeason(leagueId, seasonId) {
  const index = await loadIndex()
  const league = index.leagues.find((l) => l.id === (leagueId || index.default.league)) || index.leagues[0]
  const season = league.seasons.find((s) => s.id === (seasonId || index.default.season)) || league.seasons[0]
  const key = `${league.id}/${season.id}`
  if (seasonCache?.key !== key) {
    const data = await getJson(dataUrl(season.file))
    seasonCache = {
      key,
      leagueId: league.id,
      seasonId: season.id,
      data,
      teamsById: Object.fromEntries(data.teams.map((t) => [t.id, t])),
      schedule: roundRobin(data.teams.map((t) => t.id)),
    }
  }
  return seasonCache
}

const current = async () => seasonCache || loadSeason()

/** 다른 리그 시즌 파일 (현재 플레이 중인 시즌 캐시는 건드리지 않는다) */
const fileCache = {}
export async function loadSeasonFile(file) {
  fileCache[file] ??= getJson(dataUrl(file))
  return fileCache[file]
}

export const api = {
  /** 리그·시즌 목록 (data/index.json) */
  index: () => loadIndex(),
  /** 플레이할 리그·시즌을 고른다. 없거나 잘못된 값이면 index.json의 기본 시즌 */
  async selectSeason(leagueId, seasonId) {
    const s = await loadSeason(leagueId, seasonId)
    return { leagueId: s.leagueId, seasonId: s.seasonId }
  },
  async teams() {
    const { data } = await current()
    return { league: `${data.league.name} ${data.season}`, leagueInfo: data.league, season: data.season, zones: data.zones || [], teams: data.teams, formations: PRESETS.map(([f]) => f) }
  },
  async schedule() {
    const { schedule } = await current()
    return { rounds: schedule }
  },
  async autoLineup(teamId, formation) {
    const { teamsById } = await current()
    return { lineup: engineAutoLineup(teamsById[teamId], formation) }
  },
  /** 실행 환경 정보: Flask 서버가 있으면(/api/meta) 그 정보를, 없으면 정적 호스팅 정보를 돌려준다 */
  async meta() {
    try {
      const res = await fetch(`${BASE}api/meta`, { cache: 'no-store' })
      if (res.ok && (res.headers.get('content-type') || '').includes('json')) return res.json()
    } catch { /* 정적 호스팅 */ }
    const { data } = await current()
    return {
      environment: 'static',
      host: location.host,
      app_version: import.meta.env.VITE_APP_VERSION || 'dev',
      built_at: import.meta.env.VITE_BUILT_AT || null,
      data: { league: data.league.name, season: data.season, teams: data.teams.length, updatedAt: data.updatedAt, source: data.source },
      runtime: { engine: 'JavaScript (브라우저)', react: '18', router: 'React Router 6', bundler: 'Vite 5' },
    }
  },
}
