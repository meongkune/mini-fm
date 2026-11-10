// 선수 프로필: 위키백과·위키데이터에서 사진과 키·생년월일만 가져온다 (소개 글·출생지 등은 쓰지 않는다) (브라우저에서 바로 조회, CORS 허용)
// 한 번 본 선수는 localStorage에 저장 (30일)
const CACHE_KEY = 'mini-fm-wiki-v2'
const TTL = 30 * 24 * 3600 * 1000
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') } catch { return {} } }
function writeCache(id, value) {
  try {
    const c = readCache()
    c[id] = { t: Date.now(), v: value }
    const keys = Object.keys(c)
    if (keys.length > 400) keys.sort((a, b) => c[a].t - c[b].t).slice(0, keys.length - 400).forEach((k) => delete c[k])
    localStorage.setItem(CACHE_KEY, JSON.stringify(c))
  } catch { /* 저장 공간 부족 등은 무시 */ }
}
const getJson = async (url) => (await fetch(url)).json()

/** 영어 위키백과에서 이 선수 문서 찾기: 성이 제목에 있고 설명에 footballer가 있는 문서 */
async function findPage(player, teamName) {
  const last = fold(player.name.split(' ').at(-1))
  const q = encodeURIComponent(`${player.name} footballer`)
  const s = await getJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srlimit=6&format=json&origin=*`)
  const titles = (s.query?.search || []).map((x) => x.title).filter((t) => fold(t).includes(last))
  for (const t of titles.slice(0, 3)) {
    const sum = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}`)
    if (/football|soccer/i.test(sum.description || '') || /footballer/i.test(sum.extract || '')) return sum
  }
  return null
}

/** @returns 프로필 객체 또는 { none: true } */
export async function fetchProfile(player, teamName = '') {
  const cached = readCache()[player.id]
  if (cached && Date.now() - cached.t < TTL) return cached.v
  try {
    const sum = await findPage(player, teamName)
    if (!sum) { writeCache(player.id, { none: true }); return { none: true } }
    const out = {
      en: sum.title,
      photo: sum.thumbnail?.source || null,
      url: sum.content_urls?.mobile?.page || sum.content_urls?.desktop?.page,
    }
    // 위키데이터: 키·생년월일
    if (sum.wikibase_item) {
      const wd = await getJson(`https://www.wikidata.org/wiki/Special:EntityData/${sum.wikibase_item}.json`)
      const e = Object.values(wd.entities || {})[0] || {}
      const c = e.claims || {}
      const val = (p) => c[p]?.[0]?.mainsnak?.datavalue?.value
      const h = val('P2048')
      if (h?.amount) out.height = Math.round(Number(h.amount) * (/Q11573/.test(h.unit) ? 100 : 1))
      const dob = val('P569')?.time
      if (dob) out.born = dob.slice(1, 11)
    }
    writeCache(player.id, out)
    return out
  } catch {
    return { error: true }
  }
}
