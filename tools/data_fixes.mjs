// 자동 수집 데이터의 잘못된 구단 이름·홈구장을 손으로 고친다 (manual: true → 다시 가져와도 유지)
//   구단 이름: tools/wiki_names.mjs가 같은 이름의 다른 구단을 잡은 경우(아틀레틱 클루브 → 올덤 애슬레틱 등)와 번역이 빠진 경우
//   홈구장: tools/stadiums.mjs(TheSportsDB 이름 검색)가 다른 나라·하부 리그 구단 구장을 잡은 경우
// 실행: node tools/data_fixes.mjs  (여러 번 돌려도 같은 결과)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'frontend', 'public', 'data')

// 리그 → 구단 ID → [이름, 짧은 이름]
const NAMES = {
  'la-liga': { ATH: ['아틀레틱 빌바오', '아틀레틱'], RSO: ['레알 소시에다드', '소시에다드'], VAL: ['발렌시아 CF', '발렌시아'], LEV: ['레반테 UD', '레반테'] },
  'serie-a': { INT: ['인테르 밀란', '인테르'], ATA: ['아탈란타 BC', '아탈란타'], CAG: ['칼리아리 칼초', '칼리아리'], UDI: ['우디네세 칼초', '우디네세'], USL: ['US 레체', '레체'], COM: ['코모 1907', '코모'] },
  'ligue-1': { BRE: ['스타드 브레스투아 29', '브레스트'], LIL: ['릴 OSC', '릴'], NIC: ['OGC 니스', '니스'], LYO: ['올랭피크 리옹', '리옹'], AJA: ['AJ 오세르', '오세르'], ANG: ['앙제 SCO', '앙제'], REN: ['스타드 렌 FC', '렌'] },
  eredivisie: { SPA: ['스파르타 로테르담', '스파르타'], GOA: ['고 어헤드 이글스', '고 어헤드'] },
  championship: { QPR: ['퀸스 파크 레인저스 FC', 'QPR'], SHE: ['셰필드 유나이티드 FC', '셰필드 Utd'], OXF: ['옥스퍼드 유나이티드 FC', '옥스퍼드'] },
  'primeira-liga': { ALV: ['FC 알베르카', '알베르카'], AVS: ['AVS 푸테볼', 'AVS'] },
  brasileirao: { BOT: ['보타포구 FR', '보타포구'] },
  'k-league': { K7061: ['충북청주 FC', '충북청주'] },
}

// 리그 → 구단 ID → [구장 이름, 수용 인원]
const STADIUMS = {
  'premier-league': {
    TOT: ['Tottenham Hotspur Stadium', 62850], NEW: ["St James' Park", 52305], WHU: ['London Stadium', 62500], BOU: ['Vitality Stadium', 11307],
    MCI: ['Etihad Stadium', 52900], MUN: ['Old Trafford', 74197], WOL: ['Molineux Stadium', 31750], NOT: ['The City Ground', 30404],
    BHA: ['American Express Stadium', 31876], BRE: ['Gtech Community Stadium', 17250], FUL: ['Craven Cottage', 27700],
  },
  bundesliga: {
    BVB: ['Signal Iduna Park', 81365], FCB: ['Allianz Arena', 75024], HSV: ['Volksparkstadion', 57000], SGE: ['Deutsche Bank Park', 58000],
    SVW: ['Weserstadion', 42100], BMG: ['Borussia-Park', 54042], STP: ['Millerntor-Stadion', 29546],
  },
  'la-liga': {
    ATH: ['San Mamés', 53289], ATL: ['Riyadh Air Metropolitano', 70460], FCB: ['Spotify Camp Nou', 62000], ALA: ['Mendizorrotza', 19840],
  },
  'serie-a': {
    MIL: ['San Siro', 75817], INT: ['San Siro', 75817], HVE: ['Stadio Marcantonio Bentegodi', 31045],
  },
  'ligue-1': {
    LIL: ['Stade Pierre-Mauroy', 50186], PSG: ['Parc des Princes', 47929], REN: ['Roazhon Park', 29778], ANG: ['Stade Raymond Kopa', 19350],
  },
  eredivisie: {
    AZ: ['AFAS Stadion', 19478], NEC: ['Goffert Stadion', 12500], TEL: ['BUKO Stadion', 3060], VOL: ['Kras Stadion', 7384],
    NAC: ['Rat Verlegh Stadion', 19000], ZWO: ['MAC³PARK Stadion', 14000], SIT: ['Fortuna Sittard Stadion', 12500], SPA: ['Sparta-Stadion Het Kasteel', 11026],
  },
  'primeira-liga': { GUI: ['Estádio D. Afonso Henriques', 30000], CDN: ['Estádio da Madeira', 5132] },
  championship: {
    NOR: ['Carrow Road', 27359], QPR: ['Loftus Road', 18439], WBA: ['The Hawthorns', 26850], SHE: ['Bramall Lane', 32050],
    PNE: ['Deepdale', 23404], SHW: ['Hillsborough', 39732],
  },
  brasileirao: { CAM: ['Arena MRV', 46000], RBB: ['Estádio Nabi Abi Chedid', 17022] },
}

const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'))
let n = 0
for (const [lid, fix] of Object.entries(NAMES)) {
  const l = index.leagues.find((x) => x.id === lid)
  for (const s of l?.seasons || []) {
    const file = path.join(DATA, s.file)
    const raw = fs.readFileSync(file, 'utf8')
    const d = JSON.parse(raw)
    // 원래 파일 형식 그대로 (한 줄 / 들여쓰기 1칸 / 2칸) — 변경 줄을 실제 수정한 곳만으로
    const indent = raw.trim().includes('\n') ?(raw.split('\n')[1].match(/^ */)[0].length || 1) : 0
    let changed = false
    for (const t of d.teams) {
      const f = fix[t.id]
      if (!f || (t.name === f[0] && t.short === f[1] && t.manual)) continue
      t.name = f[0]; t.short = f[1]; t.manual = true; changed = true; n++
    }
    if (changed) fs.writeFileSync(file, (indent ? JSON.stringify(d, null, indent) : JSON.stringify(d)) + (raw.endsWith('\n') ? '\n' : ''))
  }
}
const sf = path.join(DATA, 'stadiums.json')
const st = JSON.parse(fs.readFileSync(sf, 'utf8'))
for (const [lid, fix] of Object.entries(STADIUMS)) {
  for (const [id, [name, cap]] of Object.entries(fix)) {
    const cur = st[lid]?.[id]
    if (cur && cur.name === name && cur.cap === cap && cur.manual) continue
    ;(st[lid] ??= {})[id] = { name, cap, manual: true }
    n++
  }
}
fs.writeFileSync(sf, JSON.stringify(st) + '\n')
console.log(`고친 항목 ${n}개`)
