// 위키백과(영어 문서 → 한국어 문서 연결)로 구단의 한국어 이름을 찾는다
//   - 짧은 이름(예: Feyenoord)으로 검색하고, 그 단어가 제목에 들어 있는 문서만 쓴다 (엉뚱한 구단 방지)
//   - 2군·B팀·유스·여자팀·시즌 문서는 건너뛴다
const WIKI_UA = { 'User-Agent': 'MiniFM-importer/1.0 (https://github.com/meongkune/mini-fm)' }
const SKIP = /\sII$|\sB$|U-?\d{2}|reserves|youth|women|femenino|feminino|academy|\d{4}[–-]\d{2,4}/i
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

async function search(q) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=8&format=json`
  const r = await (await fetch(url, { headers: WIKI_UA })).json()
  return (r.query?.search || []).map((x) => x.title).filter((t) => !SKIP.test(t))
}

/** @returns {{ en: string, ko: string } | null} */
export async function koreanName(fullName, shortName) {
  try {
    const key = fold(shortName || fullName).split(/\s+/).filter((w) => w.length >= 3).sort((a, b) => b.length - a.length)[0] || fold(shortName || fullName)
    // 짧은 이름 또는 공식 이름에서 가장 긴 단어가 제목에 있어야 같은 구단으로 본다 (Barça → FC Barcelona)
    const longKey = fold(fullName).split(/\s+/).filter((w) => w.length >= 4).sort((a, b) => b.length - a.length)[0] || key
    const ok = (t) => fold(t).includes(key) || fold(t).includes(longKey) || fold(t).includes(fold(shortName || '').slice(0, 5))
    let title = (await search(`${shortName || fullName} football club`)).find(ok)
    if (!title) title = (await search(`${fullName} football club`)).find(ok)
    if (!title) return null
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=langlinks&lllang=ko&redirects=1&format=json`
    const l = await (await fetch(url, { headers: WIKI_UA })).json()
    const ko = Object.values(l.query?.pages || {})[0]?.langlinks?.[0]?.['*']
    return ko ? { en: title, ko: ko.replace(/\s*\(.*\)\s*$/, '').trim() } : null
  } catch {
    return null
  }
}

const PREFIX = /^(FC|AFC|SC|SV|AC|AS|SS|SSC|RC|CF|CD|SL|SE|CR|SK|RCD|UD|CA|EC|VfB|VfL|TSG|RB|AZ|NEC|PEC|SBV|1\.)\s+/i
const SUFFIX = /\s+(FC|SC|CF|AC|CFC|AFC)$/i

/**
 * 짧은 한국어 이름: FC 같은 약칭을 떼고, 그래도 길면 영어 짧은 이름이 제목에서 몇 번째 단어인지 보고 같은 위치의 한국어 단어를 쓴다
 * 예) 보루시아 도르트문트 + Dortmund → 도르트문트, 아틀레티코 마드리드 + Atleti → 아틀레티코
 */
export function shortKo(ko, en, shortName) {
  const s = ko.replace(PREFIX, '').replace(SUFFIX, '').trim()
  if (s.length <= 7) return s
  const enWords = en.replace(PREFIX, '').replace(SUFFIX, '').split(/\s+/)
  const koWords = s.split(/\s+/)
  const target = fold(shortName || '')
  const i = enWords.findIndex((w) => fold(w).startsWith(target.slice(0, 4)) || target.startsWith(fold(w).slice(0, 4)))
  if (i >= 0 && koWords.length === enWords.length) return koWords[i]
  return koWords.length > 1 ? koWords.reduce((a, b) => (b.length > a.length ? b : a)) : s
}
