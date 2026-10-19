// 데이터 관리: 시즌 데이터(구단·선수·능력치)를 편집하고 GitHub에 커밋 → Pages가 자동으로 다시 배포한다
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadIndex } from '../api.js'
import { checkAccess, DATA_DIR, defaultRepo, readFile, writeFile } from '../github.js'
import { tierOf } from '../components/PlayerCard.jsx'
import { ink, playerOvr } from '../store.jsx'

const POS = ['GK', 'DF', 'MF', 'FW']
const POS_KO = { GK: '골키퍼', DF: '수비수', MF: '미드필더', FW: '공격수' }
const TOKEN_KEY = 'mini-fm-admin-token'
const REPO_KEY = 'mini-fm-admin-repo'
const draftKey = (path) => `mini-fm-admin-draft:${path}`

// 저장소 접근은 사생활 보호 모드 등에서 실패할 수 있으므로 항상 감싼다
const store = {
  get: (k, s = localStorage) => { try { return s.getItem(k) } catch { return null } },
  set: (k, v, s = localStorage) => { try { s.setItem(k, v) } catch { /* 무시 */ } },
  del: (k, s = localStorage) => { try { s.removeItem(k) } catch { /* 무시 */ } },
}
const toJson = (season) => JSON.stringify(season, null, 1) + '\n'

/** 경기가 성립하는지와 데이터 형식 검사. level: error면 게시 불가 */
export function validateTeam(team) {
  const issues = []
  const count = Object.fromEntries(POS.map((p) => [p, team.players.filter((x) => x.pos === p).length]))
  if (count.GK < 1) issues.push({ level: 'error', text: '골키퍼가 없습니다' })
  if (count.DF < 4 || count.MF < 4 || count.FW < 2) issues.push({ level: 'error', text: `4-4-2를 짤 수 없습니다 (DF ${count.DF} · MF ${count.MF} · FW ${count.FW})` })
  else if (count.DF < 5 || count.MF < 5 || count.FW < 3) issues.push({ level: 'warn', text: '일부 포메이션(5-3-2 · 3-5-2 · 4-3-3)은 인원이 모자랍니다' })
  if (!team.name.trim() || !team.short.trim()) issues.push({ level: 'error', text: '구단 이름이 비어 있습니다' })
  const nums = {}
  for (const p of team.players) {
    if (!p.name.trim()) issues.push({ level: 'error', text: '이름이 빈 선수가 있습니다' })
    if (!(p.number >= 1 && p.number <= 99)) issues.push({ level: 'error', text: `${p.name || '이름 없음'}: 등번호는 1~99` })
    else if (nums[p.number]) issues.push({ level: 'error', text: `등번호 ${p.number} 중복 (${nums[p.number]} · ${p.name})` })
    else nums[p.number] = p.name
    for (const k of ['att', 'def', 'sta']) if (!(p[k] >= 1 && p[k] <= 99)) issues.push({ level: 'error', text: `${p.name || '이름 없음'}: 능력치는 1~99` })
    if (!(p.age >= 15 && p.age <= 45)) issues.push({ level: 'error', text: `${p.name || '이름 없음'}: 나이는 15~45` })
  }
  return issues
}

/** 원본과 편집본을 비교해 바뀐 내용을 한 줄씩 */
export function diffSeason(before, after) {
  const lines = []
  const prevTeams = Object.fromEntries(before.teams.map((t) => [t.id, t]))
  const fields = ['name', 'pos', 'number', 'age', 'att', 'def', 'sta']
  for (const t of after.teams) {
    const o = prevTeams[t.id]
    if (!o) continue
    const team = []
    for (const k of ['name', 'short', 'color', 'alt']) if (o[k] !== t[k]) team.push(`${k}: ${o[k]} → ${t[k]}`)
    if (team.length) lines.push({ team: t.name, text: `구단 정보 (${team.join(', ')})` })
    const oldP = Object.fromEntries(o.players.map((p) => [p.id, p]))
    const newIds = new Set(t.players.map((p) => p.id))
    for (const p of t.players) {
      const q = oldP[p.id]
      if (!q) { lines.push({ team: t.name, text: `+ ${p.name} (${p.pos} #${p.number}) 추가` }); continue }
      const ch = fields.filter((k) => q[k] !== p[k]).map((k) => `${k} ${q[k]}→${p[k]}`)
      if (ch.length) lines.push({ team: t.name, text: `${p.name}: ${ch.join(', ')}` })
    }
    for (const q of o.players) if (!newIds.has(q.id)) lines.push({ team: t.name, text: `− ${q.name} 제외` })
  }
  return lines
}

export default function Admin() {
  // ── 연결 ──
  const [repo, setRepo] = useState(() => store.get(REPO_KEY) || defaultRepo())
  const [token, setToken] = useState(() => store.get(TOKEN_KEY) || store.get(TOKEN_KEY, sessionStorage) || '')
  const [remember, setRemember] = useState(() => Boolean(store.get(TOKEN_KEY)))
  const [access, setAccess] = useState(null) // { canPush, fullName, htmlUrl } | { error }

  // ── 시즌 ──
  const [index, setIndex] = useState(null)
  const [sel, setSel] = useState(null) // { league, season, file }
  const [file, setFile] = useState(null) // { path, sha, original }
  const [draft, setDraft] = useState(null)
  const [restored, setRestored] = useState(false)
  const [teamId, setTeamId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // ── 게시 ──
  const [message, setMessage] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(null)

  useEffect(() => {
    loadIndex().then((i) => {
      setIndex(i)
      const league = i.leagues.find((l) => l.id === i.default.league) || i.leagues[0]
      const season = league.seasons.find((s) => s.id === i.default.season) || league.seasons[0]
      setSel({ league: league.id, season: season.id, file: season.file })
    }).catch((e) => setError(e.message))
  }, [])

  // 토큰 보관: 기본은 이 탭(sessionStorage), "기억"을 켜면 이 기기(localStorage)
  useEffect(() => {
    store.del(TOKEN_KEY); store.del(TOKEN_KEY, sessionStorage)
    if (token) store.set(TOKEN_KEY, token, remember ? localStorage : sessionStorage)
  }, [token, remember])

  useEffect(() => { store.set(REPO_KEY, repo) }, [repo])

  // 편집 중인 내용은 새로고침해도 남도록 브라우저에 임시 저장
  useEffect(() => {
    if (file && draft) store.set(draftKey(file.path), JSON.stringify({ sha: file.sha, draft }))
  }, [file, draft])

  async function connect() {
    setAccess(null)
    try { setAccess(await checkAccess(repo.trim(), token.trim())) } catch (e) { setAccess({ error: e.message }) }
  }

  async function load() {
    if (!sel) return
    if (draft && changes.length && !confirm('편집 중인 내용을 버리고 다시 불러올까요?')) return
    setLoading(true); setError(null); setPublished(null); setTeamId(null)
    const path = `${DATA_DIR}/${sel.file}`
    try {
      const { text, sha } = await readFile(repo.trim(), path, token.trim() || undefined)
      const original = JSON.parse(text)
      const saved = JSON.parse(store.get(draftKey(path)) || 'null')
      const resume = saved?.sha === sha && toJson(saved.draft) !== toJson(original)
      setFile({ path, sha, original })
      setDraft(resume ? saved.draft : structuredClone(original))
      setRestored(resume)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const changes = useMemo(() => (file && draft ? diffSeason(file.original, draft) : []), [file, draft])
  const issues = useMemo(() => (draft ? Object.fromEntries(draft.teams.map((t) => [t.id, validateTeam(t)])) : {}), [draft])
  const errorCount = Object.values(issues).flat().filter((i) => i.level === 'error').length

  // 편집 도우미: 수동으로 손댄 구단·선수는 manual 표시 → 시즌을 다시 가져와도 유지된다
  const editTeam = (id, fn) => setDraft((d) => ({ ...d, teams: d.teams.map((t) => (t.id === id ? fn(structuredClone(t)) : t)) }))
  const setTeamField = (id, k, v) => editTeam(id, (t) => ({ ...t, [k]: v, manual: true }))
  const setPlayer = (id, pid, k, v) => editTeam(id, (t) => ({ ...t, players: t.players.map((p) => (p.id === pid ? { ...p, [k]: v, manual: true } : p)) }))
  const addPlayer = (id, pos) => editTeam(id, (t) => {
    const used = new Set(t.players.map((p) => p.number))
    const number = Array.from({ length: 99 }, (_, i) => i + 1).find((n) => !used.has(n))
    t.players.push({ id: `${t.id}-m${Date.now().toString(36)}`, name: '', pos, number, age: 22, att: 60, def: 60, sta: 60, manual: true })
    return t
  })
  const removePlayer = (id, pid) => editTeam(id, (t) => {
    const p = t.players.find((x) => x.id === pid)
    if (p?.ext) t.removed = [...new Set([...(t.removed || []), p.ext])] // 다시 가져와도 빠진 채로
    t.players = t.players.filter((x) => x.id !== pid)
    return t
  })

  function discard() {
    if (!confirm('편집한 내용을 모두 버릴까요?')) return
    store.del(draftKey(file.path))
    setDraft(structuredClone(file.original)); setRestored(false)
  }

  async function publish() {
    const teamsTouched = new Set(changes.map((c) => c.team)).size
    const msg = message.trim() || `data: ${draft.league.name} ${draft.season} 수동 편집 (${teamsTouched}개 구단, ${changes.length}건)`
    if (!confirm(`${repo}에 커밋합니다.\n\n${msg}\n\n게시하면 1~2분 뒤 사이트에 반영됩니다.`)) return
    setPublishing(true); setError(null)
    try {
      const next = { ...draft, updatedAt: new Date().toLocaleDateString('sv-SE') } // 로컬 날짜 YYYY-MM-DD
      const r = await writeFile(repo.trim(), file.path, toJson(next), { sha: file.sha, message: msg, token: token.trim() })
      store.del(draftKey(file.path))
      setFile({ ...file, sha: r.sha, original: next })
      setDraft(structuredClone(next)); setRestored(false); setMessage('')
      setPublished({ ...r, count: changes.length })
    } catch (e) {
      setError(e.message)
    } finally {
      setPublishing(false)
    }
  }

  const team = draft && teamId ? draft.teams.find((t) => t.id === teamId) : null
  const league = index && sel ? index.leagues.find((l) => l.id === sel.league) : null

  return (
    <section className="admin">
      <div className="section-head">
        <div>
          <h1>데이터 관리</h1>
          <p className="muted">구단·선수·능력치를 고치고 GitHub에 게시하면 사이트가 자동으로 다시 배포됩니다.</p>
        </div>
        <Link className="btn ghost small" to="/deploy">닫기</Link>
      </div>

      {/* 1. 연결 */}
      <div className="card">
        <h3>1. GitHub 연결</h3>
        <label className="field"><span>레포</span>
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" autoComplete="off" spellCheck="false" />
        </label>
        <label className="field"><span>토큰</span>
          <input type="password" value={token} onChange={(e) => { setToken(e.target.value); setAccess(null) }} placeholder="github_pat_…" autoComplete="off" spellCheck="false" />
        </label>
        <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> 이 기기에 토큰 기억 (끄면 탭을 닫을 때 지워짐)</label>
        <div className="row">
          <button className="btn small" onClick={connect} disabled={!repo || !token}>권한 확인</button>
          {access?.canPush && <span className="pill ok">✓ {access.fullName} 쓰기 가능</span>}
          {access && !access.error && !access.canPush && <span className="pill bad">읽기만 가능 — 쓰기 권한 필요</span>}
        </div>
        {access?.error && <p className="small bad-text">{access.error}</p>}
        <details className="help">
          <summary>토큰 만드는 법</summary>
          <ol className="small">
            <li>GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token</li>
            <li>Repository access: <b>Only select repositories</b> → 이 레포만 선택</li>
            <li>Permissions → Repository permissions → <b>Contents: Read and write</b> (나머지는 기본값)</li>
            <li>만료일은 짧게(예: 30일). 토큰은 이 브라우저에만 저장되고 api.github.com으로만 전송됩니다.</li>
          </ol>
        </details>
      </div>

      {/* 2. 시즌 */}
      <div className="card">
        <h3>2. 시즌 불러오기</h3>
        {index && sel && (
          <>
            <div className="row">
              <select value={sel.league} onChange={(e) => {
                const l = index.leagues.find((x) => x.id === e.target.value)
                setSel({ league: l.id, season: l.seasons[0].id, file: l.seasons[0].file })
              }}>
                {index.leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <select value={sel.season} onChange={(e) => {
                const s = league.seasons.find((x) => x.id === e.target.value)
                setSel({ ...sel, season: s.id, file: s.file })
              }}>
                {league.seasons.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.teams}팀</option>)}
              </select>
              <button className="btn small" onClick={load} disabled={loading}>{loading ? '불러오는 중…' : file ? '다시 불러오기' : '불러오기'}</button>
            </div>
            <p className="small muted">레포의 main 브랜치에서 최신 파일을 읽습니다. 새 시즌·리그 추가는 Actions의 <b>Import season data</b>로 합니다.</p>
          </>
        )}
        {file && draft && (
          <p className="small muted">
            {draft.league.name} {draft.season} · {draft.source} · 업데이트 {draft.updatedAt} · <code>{file.sha.slice(0, 7)}</code>
          </p>
        )}
        {restored && (
          <p className="small notice">↺ 이전에 편집하던 내용을 이어서 불러왔습니다. <button className="linkish" onClick={discard}>버리기</button></p>
        )}
      </div>

      {error && <div className="card error">{error}</div>}

      {/* 3. 편집 */}
      {draft && !team && (
        <div className="card">
          <h3>3. 구단 선택</h3>
          <div className="admin-teams">
            {draft.teams.map((t) => {
              const errs = issues[t.id].filter((i) => i.level === 'error').length
              const warns = issues[t.id].length - errs
              const edited = changes.filter((c) => c.team === t.name).length
              return (
                <button key={t.id} className="admin-team" style={{ '--c': t.color, '--ink': ink(t.color) }} onClick={() => setTeamId(t.id)}>
                  <span className="crest">{t.id.slice(0, 3)}</span>
                  <span className="grow">
                    <strong>{t.name}</strong>
                    <small>{t.players.length}명</small>
                  </span>
                  {edited > 0 && <span className="pill edit">수정 {edited}</span>}
                  {errs > 0 && <span className="pill bad">오류 {errs}</span>}
                  {!errs && warns > 0 && <span className="pill warn">주의</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {team && (
        <TeamEditor
          team={team}
          issues={issues[team.id]}
          onBack={() => setTeamId(null)}
          onTeam={(k, v) => setTeamField(team.id, k, v)}
          onPlayer={(pid, k, v) => setPlayer(team.id, pid, k, v)}
          onAdd={(pos) => addPlayer(team.id, pos)}
          onRemove={(pid) => removePlayer(team.id, pid)}
        />
      )}

      {/* 4. 게시 */}
      {draft && (
        <div className="card">
          <h3>4. 게시</h3>
          {published && (
            <div className="notice ok">
              ✓ {published.count}건을 커밋했습니다 (<a href={published.commitUrl} target="_blank" rel="noreferrer">{published.commitSha.slice(0, 7)}</a>).
              {' '}<a href={`https://github.com/${repo}/actions/workflows/pages.yml`} target="_blank" rel="noreferrer">배포 진행 상황</a>을 확인하세요. 1~2분 뒤 사이트에 반영됩니다.
            </div>
          )}
          {changes.length === 0 ? (
            <p className="muted small">아직 바뀐 내용이 없습니다.</p>
          ) : (
            <>
              <ul className="changes">
                {changes.slice(0, 30).map((c, i) => <li key={i}><b>{c.team}</b> {c.text}</li>)}
                {changes.length > 30 && <li className="muted">… 외 {changes.length - 30}건</li>}
              </ul>
              <label className="field"><span>커밋 메시지</span>
                <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={`data: ${draft.league.name} ${draft.season} 수동 편집`} />
              </label>
              {errorCount > 0 && <p className="small bad-text">오류 {errorCount}건을 고쳐야 게시할 수 있습니다.</p>}
              {!access?.canPush && <p className="small muted">게시하려면 1단계에서 쓰기 권한을 확인하세요.</p>}
              <div className="row">
                <button className="btn" onClick={publish} disabled={publishing || errorCount > 0 || !access?.canPush}>{publishing ? '게시 중…' : `변경 ${changes.length}건 게시`}</button>
                <button className="btn ghost small" onClick={discard} disabled={publishing}>편집 취소</button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function TeamEditor({ team, issues, onBack, onTeam, onPlayer, onAdd, onRemove }) {
  const num = (v) => (v === '' ? '' : Number(v))
  return (
    <>
      <div className="card" style={{ '--c': team.color }}>
        <div className="row between">
          <button className="btn ghost small" onClick={onBack}>← 구단 목록</button>
          <span className="muted small">{team.id} · {team.players.length}명</span>
        </div>
        <div className="admin-grid">
          <label className="field"><span>구단 이름</span><input value={team.name} onChange={(e) => onTeam('name', e.target.value)} /></label>
          <label className="field"><span>짧은 이름</span><input value={team.short} onChange={(e) => onTeam('short', e.target.value)} /></label>
          <label className="field"><span>홈 색</span><input type="color" value={team.color} onChange={(e) => onTeam('color', e.target.value.toUpperCase())} /></label>
          <label className="field"><span>원정 색</span><input type="color" value={team.alt} onChange={(e) => onTeam('alt', e.target.value.toUpperCase())} /></label>
        </div>
        {issues.length > 0 && (
          <ul className="issues">
            {issues.map((i, k) => <li key={k} className={i.level}>{i.level === 'error' ? '⛔' : '⚠️'} {i.text}</li>)}
          </ul>
        )}
      </div>

      {POS.map((pos) => {
        // 파일 순서 그대로(편집 중에 OVR이 바뀌어도 줄이 움직이지 않게)
        const list = team.players.filter((p) => p.pos === pos)
        return (
          <div className="card" key={pos}>
            <div className="row between">
              <h3>{POS_KO[pos]} <small className="muted">{list.length}명</small></h3>
              <button className="btn ghost small" onClick={() => onAdd(pos)}>+ 선수 추가</button>
            </div>
            {list.map((p) => {
              const ovr = playerOvr(p)
              return (
                <div className={`prow ${p.manual ? 'edited' : ''}`} key={p.id}>
                  <span className={`povr tier-${tierOf(ovr)}`}>{Number.isFinite(ovr) ? ovr : '-'}</span>
                  <input className="pnum" type="number" inputMode="numeric" aria-label="등번호" value={p.number} onChange={(e) => onPlayer(p.id, 'number', num(e.target.value))} />
                  <input className="pname" aria-label="이름" value={p.name} placeholder="선수 이름" onChange={(e) => onPlayer(p.id, 'name', e.target.value)} />
                  <select aria-label="포지션" value={p.pos} onChange={(e) => onPlayer(p.id, 'pos', e.target.value)}>
                    {POS.map((x) => <option key={x}>{x}</option>)}
                  </select>
                  <button className="pdel" aria-label={`${p.name} 제외`} onClick={() => { if (confirm(`${p.name || '이 선수'}를 선수단에서 뺄까요?`)) onRemove(p.id) }}>×</button>
                  <div className="pstats">
                    {[['age', '나이'], ['att', '공격'], ['def', '수비'], ['sta', '체력']].map(([k, label]) => (
                      <label key={k}><span>{label}</span>
                        <input type="number" inputMode="numeric" value={p[k]} onChange={(e) => onPlayer(p.id, k, num(e.target.value))} />
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </>
  )
}
