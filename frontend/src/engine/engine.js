// Mini FM 공통 규칙: 포메이션·전술 보정, 난수, 자동 선발, 리그 일정
// 경기 진행 자체는 match.js(1분 단위 엔진)에 있다. backend/engine.py는 이전(서버) 버전의 엔진.

export const FORMATIONS = {
  // 포메이션: [DF, MF, FW] 인원, 공격/중원/수비 보정
  '4-4-2': { slots: [4, 4, 2], att: 0, mid: 0, def: 0 },
  '4-3-3': { slots: [4, 3, 3], att: 4, mid: -2, def: -2 },
  '3-5-2': { slots: [3, 5, 2], att: 0, mid: 4, def: -3 },
  '5-3-2': { slots: [5, 3, 2], att: -4, mid: -1, def: 5 },
}
export const MENTALITY = {
  attacking: { att: 6, def: -6 },
  balanced: { att: 0, def: 0 },
  defensive: { att: -6, def: 6 },
}
export const PRESSING = {
  // 압박: 점유율 보정, 체력 소모 배수
  low: { mid: -3, drain: 0.6 },
  normal: { mid: 0, drain: 1.0 },
  high: { mid: 4, drain: 1.6 },
}

// 시드를 줄 수 있는 난수 생성기 (mulberry32) — 같은 시드면 같은 경기가 나온다
export function makeRng(seed) {
  let a = seed >>> 0
  const random = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    random,
    choice: (arr) => arr[Math.floor(random() * arr.length)],
    weighted: (arr, weights) => {
      const total = weights.reduce((s, w) => s + w, 0)
      let r = random() * total
      for (let i = 0; i < arr.length; i++) {
        r -= weights[i]
        if (r < 0) return arr[i]
      }
      return arr[arr.length - 1]
    },
  }
}

/** 포지션별 종합 능력치(OVR) */
export function playerOvrOf(p) {
  if (p.pos === 'GK') return p.def
  if (p.pos === 'DF') return Math.round(p.def * 0.8 + p.att * 0.2)
  if (p.pos === 'FW') return Math.round(p.att * 0.8 + p.def * 0.2)
  return Math.round((p.att + p.def) / 2)
}


/** 포메이션에 맞춰 포지션별 능력치가 높은 선수로 베스트 11을 고른다. */
export function autoLineup(team, formation = '4-4-2') {
  const [df, mf, fw] = (FORMATIONS[formation] || FORMATIONS['4-4-2']).slots
  const need = { GK: 1, DF: df, MF: mf, FW: fw }
  const key = { GK: (p) => p.def, DF: (p) => p.def, MF: (p) => p.att + p.def, FW: (p) => p.att }
  const lineup = []
  for (const [pos, n] of Object.entries(need)) {
    const pool = team.players.filter((p) => p.pos === pos).sort((a, b) => key[pos](b) - key[pos](a))
    lineup.push(...pool.slice(0, n).map((p) => p.id))
  }
  return lineup
}

/** 서클 방식 더블 라운드 로빈. 팀 수가 홀수면 쉬는 팀(bye)을 넣는다. (8팀 → 14라운드, 20팀 → 38라운드) */
export function roundRobin(teamIds) {
  let ids = [...teamIds]
  if (ids.length % 2) ids.push(null)
  const n = ids.length
  const rounds = []
  for (let r = 0; r < n - 1; r++) {
    const pairs = []
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i]
      const b = ids[n - 1 - i]
      if (a === null || b === null) continue
      pairs.push((r + i) % 2 === 0 ? { home: a, away: b } : { home: b, away: a })
    }
    rounds.push(pairs)
    ids = [ids[0], ids[n - 1], ...ids.slice(1, n - 1)]
  }
  return [...rounds, ...rounds.map((rnd) => rnd.map(({ home, away }) => ({ home: away, away: home })))]
}
