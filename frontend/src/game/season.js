// 시즌 진행 규칙 (순수 함수): 라운드 결과 반영, 선수 기록·컨디션·부상·징계·폼·사기, 받은 편지함
// 브라우저 저장(save)만 바꾸고 원본 시즌 데이터(JSON)는 건드리지 않는다.
import { playerOvrOf } from '../engine/engine.js'
import { quickMatch } from '../engine/match.js'

export const RECOVERY = 15 // 라운드 사이 컨디션 회복량
export const YELLOW_LIMIT = 5 // 경고 누적 출전 정지 기준

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export const defaultStatus = () => ({ cond: 100, morale: 60, form: 6.6, fr: [], inj: 0, susp: 0, benched: 0 })

/** 선수 상태 (없으면 기본값) */
export const statusOf = (save, id) => ({ ...defaultStatus(), ...(save.status?.[id] || {}) })

/** 엔진에 넘길 상태 맵 */
export function engineStatus(save, teams) {
  const out = {}
  for (const t of teams) for (const p of t.players) out[p.id] = statusOf(save, p.id)
  return out
}

let newsSeq = 0
export const news = (round, type, title, body, extra = {}) => ({ id: `${Date.now().toString(36)}-${newsSeq++}`, round, type, title, body, read: false, ...extra })

/**
 * 한 라운드 마무리: 내 경기 요약 + 나머지 경기 시뮬레이션 → 결과·기록·상태 갱신
 * @param mine { home, away, summary }
 */
export function applyRound(save, { teamsById, schedule, myTeamId, mine }) {
  const round = save.round
  const fixtures = schedule[round] || []
  const teams = Object.values(teamsById)
  const status = engineStatus(save, teams)
  const played = []
  for (const f of fixtures) {
    if (mine && f.home === mine.home && f.away === mine.away) { played.push({ ...f, summary: mine.summary, mine: true }); continue }
    const seed = hash(`${save.seasonNo || 1}-${round}-${f.home}-${f.away}`) || 1
    played.push({ ...f, summary: quickMatch(teamsById[f.home], teamsById[f.away], status, seed) })
  }

  const st = { ...(save.status || {}) }
  const ps = { ...(save.pstats || {}) }
  const inbox = []
  const touch = (id) => (st[id] = { ...defaultStatus(), ...(st[id] || {}) })

  // 1) 이번 라운드 이전부터 이어지던 부상·징계는 한 경기씩 줄어든다
  for (const t of teams) for (const p of t.players) {
    const s = st[p.id]
    if (!s) continue
    if (s.inj > 0 || s.susp > 0) st[p.id] = { ...s, inj: Math.max(0, s.inj - 1), susp: Math.max(0, s.susp - 1) }
  }

  const results = []
  for (const m of played) {
    const sum = m.summary
    const sides = [m.home, m.away]
    results.push({
      round, home: m.home, away: m.away, score: sum.score, mine: !!m.mine, mom: sum.mom,
      scorers: sum.scorers.map((x) => ({ player_id: x.playerId, name: x.name, team: sides[x.team], minute: x.minute, assist_id: x.assistId, assist_name: x.assistName })),
      ...(m.mine ? { stats: sum.stats } : {}),
    })
    // 2) 선수 시즌 기록
    for (const [id, r] of Object.entries(sum.players)) {
      const cur = ps[id] || { team: sides[r.team], apps: 0, starts: 0, min: 0, g: 0, a: 0, rsum: 0, cs: 0, yc: 0, rc: 0, mom: 0 }
      ps[id] = {
        ...cur, team: sides[r.team], apps: cur.apps + 1, starts: cur.starts + r.start, min: cur.min + r.min,
        g: cur.g + r.g, a: cur.a + r.a, rsum: Math.round((cur.rsum + r.r) * 10) / 10, cs: cur.cs + r.cs,
        yc: cur.yc + r.yc, rc: cur.rc + r.rc, mom: cur.mom + r.mom,
      }
      // 3) 상태: 폼, 컨디션(경기 끝난 체력), 징계
      const s = touch(id)
      s.fr = [...(s.fr || []), r.r].slice(-5)
      s.form = Math.round((s.fr.reduce((a, b) => a + b, 0) / s.fr.length) * 100) / 100
      s.cond = sum.energy[id] ?? s.cond
      if (r.rc) s.susp = Math.max(s.susp, r.yc ? 1 : 3)
      else if (r.yc && ps[id].yc > 0 && ps[id].yc % YELLOW_LIMIT === 0) s.susp = Math.max(s.susp, 1)
    }
    for (const inj of sum.injuries) {
      const s = touch(inj.id)
      s.inj = Math.max(s.inj, inj.games)
    }
  }

  // 4) 컨디션 회복 (경기를 뛴 선수도, 안 뛴 선수도)
  for (const t of teams) for (const p of t.players) {
    const s = st[p.id]
    if (s && s.cond < 100) st[p.id] = { ...s, cond: Math.min(100, Math.round(s.cond + RECOVERY + (p.sta - 70) / 10)) }
  }

  // 5) 내 팀: 사기, 출전 불만, 부상·징계 알림
  const my = teamsById[myTeamId]
  if (my && mine) {
    const myIdx = mine.home === myTeamId ? 0 : 1
    const [gf, ga] = myIdx === 0 ? mine.summary.score : [...mine.summary.score].reverse()
    const res = Math.sign(gf - ga)
    const core = new Set([...my.players].sort((a, b) => playerOvrOf(b) - playerOvrOf(a)).slice(0, 15).map((p) => p.id))
    for (const p of my.players) {
      const s = touch(p.id)
      const r = mine.summary.players[p.id]
      let dm = res > 0 ? 4 : res < 0 ? -4 : 0
      if (r) {
        dm += clamp((r.r - 6.6) * 4, -5, 6)
        s.benched = 0
      } else if (s.inj <= 0 && s.susp <= 0) {
        s.benched = (s.benched || 0) + 1
        if (core.has(p.id) && s.benched >= 3) dm -= 4
        if (core.has(p.id) && s.benched === 3) {
          inbox.push(news(round, 'talk', `${p.name} 면담 요청`, `${p.name} 선수가 최근 ${s.benched}경기 연속 출전하지 못해 불만을 드러내며 면담을 요청했습니다.`, { playerId: p.id, actions: TALK_ACTIONS }))
        }
      }
      // 약속 확인: 선발을 약속했는데 지키지 않았으면
      if (s.promise === round) {
        if (r?.start) { dm += 4; delete s.promise }
        else { dm -= 18; delete s.promise; inbox.push(news(round, 'promise', `${p.name}: 약속을 어겼습니다`, `선발로 기용하겠다던 약속이 지켜지지 않자 ${p.name} 선수가 크게 실망했습니다. (사기 크게 하락)`, { playerId: p.id })) }
      }
      s.morale = Math.round(clamp(s.morale + dm + (60 - s.morale) * 0.05, 0, 100))
      if (s.morale < 25 && !s.wantsOut) {
        s.wantsOut = true
        inbox.push(news(round, 'request', `${p.name} 이적 요청`, `${p.name} 선수가 팀을 떠나고 싶다며 공식적으로 이적을 요청했습니다. 이적 시장에서 트레이드 카드로 쓸 수 있습니다.`, { playerId: p.id }))
      }
    }
    for (const inj of mine.summary.injuries) {
      const p = my.players.find((x) => x.id === inj.id)
      if (p) inbox.push(news(round, 'injury', `${p.name} 부상`, `${inj.minute}분에 다친 ${p.name} 선수는 약 ${inj.games}경기 결장할 예정입니다.`, { playerId: p.id }))
    }
    for (const p of my.players) {
      const r = mine.summary.players[p.id]
      if (st[p.id]?.susp > 0 && r && (r.rc || r.yc)) inbox.push(news(round, 'susp', `${p.name} 출전 정지`, `${r.rc ? '퇴장' : `경고 ${YELLOW_LIMIT}회 누적`}으로 다음 ${st[p.id].susp}경기에 나설 수 없습니다.`, { playerId: p.id }))
    }
    if (mine.summary.mom && my.players.some((p) => p.id === mine.summary.mom)) {
      const p = my.players.find((x) => x.id === mine.summary.mom)
      inbox.push(news(round, 'mom', `경기 최우수 선수: ${p.name}`, `${p.name} 선수가 평점 ${mine.summary.players[p.id].r}로 이 경기 MOM에 선정됐습니다.`, { playerId: p.id }))
    }
  }

  return {
    ...save,
    round: round + 1,
    results: [...save.results, ...results],
    status: st,
    pstats: ps,
    inbox: [...inbox, ...(save.inbox || [])].slice(0, 80),
  }
}

// 면담 선택지
export const TALK_ACTIONS = [
  ['promise', '다음 경기 선발을 약속한다', '사기가 크게 오르지만, 지키지 않으면 크게 실망합니다'],
  ['persuade', '경쟁에서 이겨내라고 설득한다', '선수 성격에 따라 결과가 갈립니다'],
  ['refuse', '지금은 기회를 줄 수 없다고 말한다', '사기가 떨어지고 이적을 요청할 수 있습니다'],
]

/** 면담 결과 */
export function resolveTalk(save, itemId, action) {
  const item = (save.inbox || []).find((x) => x.id === itemId)
  if (!item || item.resolved) return save
  const s = { ...defaultStatus(), ...(save.status?.[item.playerId] || {}) }
  let reply
  if (action === 'promise') {
    s.morale = Math.min(100, s.morale + 12)
    s.promise = save.round // 다음 라운드(=현재 save.round)에 선발
    reply = '"감사합니다, 감독님. 기대에 보답하겠습니다." (사기 상승 · 다음 경기 선발 약속)'
  } else if (action === 'persuade') {
    const ok = (hash(`${item.playerId}-${save.round}`) % 100) < 55
    s.morale = clamp(s.morale + (ok ? 6 : -6), 0, 100)
    reply = ok ? '"알겠습니다. 훈련에서 보여드리죠." (사기 소폭 상승)' : '"말뿐이네요." (사기 하락)'
  } else {
    s.morale = Math.max(0, s.morale - 10)
    reply = '"…그렇군요." (사기 하락)'
  }
  s.benched = 0
  return {
    ...save,
    status: { ...save.status, [item.playerId]: s },
    inbox: save.inbox.map((x) => (x.id === itemId ? { ...x, resolved: action, reply, read: true } : x)),
  }
}

/** 하프타임 지시: 상황(이기는 중/비김/지는 중)에 따라 후반 경기력 보정과 반응 */
export const TEAM_TALKS = [
  ['praise', '👏 칭찬한다', '잘하고 있다고 북돋운다'],
  ['calm', '🧘 침착하게', '흥분하지 말고 하던 대로'],
  ['demand', '📣 다그친다', '더 많이 뛰라고 요구한다'],
]
export function teamTalkEffect(kind, diff, avgMorale = 60) {
  const lead = diff > 0 ? 'lead' : diff < 0 ? 'trail' : 'draw'
  const table = {
    praise: { lead: [0.02, '선수들이 자신감에 차 있습니다.'], draw: [0.01, '분위기가 좋아졌습니다.'], trail: [-0.015, '지고 있는데 칭찬이라니, 선수들이 어리둥절해합니다.'] },
    calm: { lead: [0.015, '선수들이 차분하게 리드를 지키려 합니다.'], draw: [0.01, '선수들이 집중력을 되찾았습니다.'], trail: [0, '별다른 반응이 없습니다.'] },
    demand: { lead: [-0.015, '이기고 있는데 질책을 받자 선수들이 위축됐습니다.'], draw: [0.015, '선수들이 투지를 불태웁니다.'], trail: avgMorale < 40 ? [-0.01, '사기가 낮은 선수들이 오히려 주눅 들었습니다.'] : [0.025, '선수들이 이를 악물고 나갑니다!'] },
  }
  const [boost, text] = table[kind][lead]
  return { boost, text }
}
