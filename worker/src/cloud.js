// 클라우드 세이브: 구글 로그인 확인 → 접속 번호(세션) → 세이브 슬롯 읽기·쓰기 (Cloudflare D1)
// 개인정보는 저장하지 않는다. 구글 ID 토큰을 검증한 뒤 고유 번호(sub)를 비밀값(UID_PEPPER)과 함께 해시한 값만 uid로 쓰고,
// 이메일·이름·사진은 읽지도 저장하지도 않는다. 토큰·이메일은 로그에도 남기지 않는다.
//
// 규칙
//  - 마지막으로 로그인한 한 곳만 인정: 로그인할 때마다 새 접속 번호를 발급하고 예전 번호는 무효(401 session) → "다른 곳에서 접속"
//  - 버전 확인: 저장할 때 내가 이어받은 버전(baseVersion)이 서버와 다르면 409 → 덮어쓰기 대신 서버 세이브를 다시 받게 한다
//  - 슬롯 3개, 지우거나 덮어쓴 슬롯은 7일 동안 휴지통

export const SLOTS = 3
const TRASH_DAYS = 7
const MAX_DATA = 1_800_000 // 압축(base64) 세이브 최대 크기 — D1 한 줄 한도(약 2MB) 안
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs'
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com']

const enc = new TextEncoder()
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
const b64urlToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0))
const now = () => Date.now()

// 구글 공개키 (워커 인스턴스 안에서 Cache-Control 만큼 캐시)
let certs = null
let certsUntil = 0
async function googleKeys() {
  if (certs && Date.now() < certsUntil) return certs
  const res = await fetch(GOOGLE_CERTS)
  if (!res.ok) throw Object.assign(new Error('certs'), { status: 502 })
  const age = Number((res.headers.get('Cache-Control') || '').match(/max-age=(\d+)/)?.[1] || 3600)
  certs = (await res.json()).keys || []
  certsUntil = Date.now() + Math.min(age, 6 * 3600) * 1000
  return certs
}

/** 구글 ID 토큰(JWT, RS256) 검증 → sub. 실패하면 401 */
export async function verifyGoogle(credential, clientId) {
  const fail = (why) => { throw Object.assign(new Error(`토큰 검증 실패: ${why}`), { status: 401 }) }
  const parts = String(credential || '').split('.')
  if (parts.length !== 3) fail('형식')
  let header, payload
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])))
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])))
  } catch { fail('해석') }
  if (header.alg !== 'RS256') fail('알고리즘')
  const jwk = (await googleKeys()).find((k) => k.kid === header.kid)
  if (!jwk) fail('키')
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`))
  if (!ok) fail('서명')
  const t = Math.floor(Date.now() / 1000)
  if (!ISSUERS.includes(payload.iss)) fail('발급자')
  if (payload.aud !== clientId) fail('대상')
  if (!(payload.exp > t - 60)) fail('만료')
  if (!payload.sub) fail('sub')
  return String(payload.sub)
}

/** 요청의 접속 번호 → uid (없거나 무효면 null) */
async function userOf(req, env) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!/^[0-9a-f]{64}$/.test(token)) return null
  const row = await env.DB.prepare('SELECT uid FROM users WHERE session = ?').bind(await sha256(token)).first()
  return row?.uid || null
}

const slotOf = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= SLOTS ? n : null }

async function listSlots(env, uid) {
  // 7일 지난 휴지통은 지운다 (모든 계정 — 이 계정이 다시 오지 않아도 다른 사람이 접속할 때 정리된다)
  await env.DB.prepare('DELETE FROM trash WHERE deleted_at < ?').bind(now() - TRASH_DAYS * 86400000).run()
  const saves = (await env.DB.prepare('SELECT slot, version, summary, updated_at FROM saves WHERE uid = ? ORDER BY slot').bind(uid).all()).results || []
  const trash = (await env.DB.prepare('SELECT id, slot, summary, deleted_at FROM trash WHERE uid = ? ORDER BY deleted_at DESC LIMIT 10').bind(uid).all()).results || []
  return {
    slots: saves.map((s) => ({ ...s, summary: parseSummary(s.summary) })),
    trash: trash.map((s) => ({ ...s, summary: parseSummary(s.summary) })),
  }
}
const parseSummary = (s) => { try { return JSON.parse(s || 'null') } catch { return null } }
const cleanSummary = (s) => JSON.stringify(s && typeof s === 'object' ? Object.fromEntries(Object.entries(s).slice(0, 12).map(([k, v]) => [String(k).slice(0, 20), typeof v === 'number' ? v : String(v ?? '').slice(0, 60)])) : null)

async function toTrash(env, uid, slot) {
  const cur = await env.DB.prepare('SELECT data, summary FROM saves WHERE uid = ? AND slot = ?').bind(uid, slot).first()
  if (!cur) return false
  await env.DB.batch([
    env.DB.prepare('INSERT INTO trash (uid, slot, data, summary, deleted_at) VALUES (?, ?, ?, ?, ?)').bind(uid, slot, cur.data, cur.summary, now()),
    env.DB.prepare('DELETE FROM saves WHERE uid = ? AND slot = ?').bind(uid, slot),
  ])
  return true
}

/**
 * /auth · /slots · /save · /restore · /logout 처리. 해당 경로가 아니면 null
 * @returns {Promise<[body, status] | null>}
 */
export async function handleCloud(req, env, url) {
  const p = url.pathname
  if (!['/auth', '/slots', '/save', '/restore', '/logout', '/account'].includes(p)) return null
  if (!env.DB || !env.UID_PEPPER) return [{ error: '클라우드 세이브 설정 안 됨' }, 503]
  let body = {}
  if (req.method === 'POST' || req.method === 'PUT') { try { body = await req.json() } catch { return [{ error: 'bad json' }, 400] } }

  // 로그인: 구글 ID 토큰 → 새 접속 번호 (예전 접속은 무효)
  if (p === '/auth' && req.method === 'POST') {
    const sub = await verifyGoogle(body.credential, env.GOOGLE_CLIENT_ID)
    const uid = await sha256(`${env.UID_PEPPER}:${sub}`)
    const token = hex(crypto.getRandomValues(new Uint8Array(32)))
    const t = now()
    await env.DB.prepare('INSERT INTO users (uid, session, session_at, created_at, last_login) VALUES (?, ?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET session = excluded.session, session_at = excluded.session_at, last_login = excluded.last_login')
      .bind(uid, await sha256(token), t, t, t).run()
    return [{ token, ...(await listSlots(env, uid)) }, 200]
  }

  const uid = await userOf(req, env)
  if (!uid) return [{ error: 'session', message: '다른 곳에서 로그인했거나 접속이 만료됐습니다.' }, 401]

  if (p === '/logout' && req.method === 'POST') {
    await env.DB.prepare('UPDATE users SET session = NULL WHERE uid = ?').bind(uid).run()
    return [{ ok: true }, 200]
  }
  // 계정 삭제: 세이브·휴지통·계정 줄을 모두 지운다 (되돌릴 수 없음)
  if (p === '/account' && req.method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM saves WHERE uid = ?').bind(uid),
      env.DB.prepare('DELETE FROM trash WHERE uid = ?').bind(uid),
      env.DB.prepare('DELETE FROM users WHERE uid = ?').bind(uid),
    ])
    return [{ ok: true }, 200]
  }
  if (p === '/slots' && req.method === 'GET') return [await listSlots(env, uid), 200]

  if (p === '/save' && req.method === 'GET') {
    const slot = slotOf(url.searchParams.get('slot'))
    if (!slot) return [{ error: 'slot' }, 400]
    const row = await env.DB.prepare('SELECT slot, version, data, summary, updated_at FROM saves WHERE uid = ? AND slot = ?').bind(uid, slot).first()
    if (!row) return [{ error: 'empty' }, 404]
    return [{ ...row, summary: parseSummary(row.summary) }, 200]
  }

  // 저장: baseVersion이 서버 버전과 같아야 한다. 빈 슬롯에 처음 쓰면 baseVersion 0. replace면 지금 있는 세이브를 휴지통으로 보내고 새로 쓴다
  if (p === '/save' && req.method === 'PUT') {
    const slot = slotOf(body.slot)
    if (!slot) return [{ error: 'slot' }, 400]
    const data = String(body.data || '')
    if (!data || data.length > MAX_DATA) return [{ error: 'size', message: `세이브가 너무 큽니다 (${Math.round(data.length / 1024)}KB)` }, 413]
    const cur = await env.DB.prepare('SELECT version FROM saves WHERE uid = ? AND slot = ?').bind(uid, slot).first()
    if (cur && body.replace) await toTrash(env, uid, slot)
    else if ((cur?.version || 0) !== Number(body.baseVersion || 0)) return [{ error: 'conflict', version: cur?.version || 0, message: '다른 곳에서 먼저 저장된 세이브가 있습니다.' }, 409]
    const version = cur && !body.replace ? cur.version + 1 : now()
    await env.DB.prepare('INSERT INTO saves (uid, slot, version, data, summary, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(uid, slot) DO UPDATE SET version = excluded.version, data = excluded.data, summary = excluded.summary, updated_at = excluded.updated_at')
      .bind(uid, slot, version, data, cleanSummary(body.summary), now()).run()
    return [{ slot, version }, 200]
  }

  if (p === '/save' && req.method === 'DELETE') {
    const slot = slotOf(url.searchParams.get('slot'))
    if (!slot) return [{ error: 'slot' }, 400]
    return [{ ok: await toTrash(env, uid, slot) }, 200]
  }

  // 휴지통에서 되살리기: 대상 슬롯에 세이브가 있으면 그것을 휴지통으로 보낸다
  if (p === '/restore' && req.method === 'POST') {
    const slot = slotOf(body.slot)
    const row = await env.DB.prepare('SELECT id, data, summary FROM trash WHERE uid = ? AND id = ?').bind(uid, Number(body.id)).first()
    if (!slot || !row) return [{ error: 'not found' }, 404]
    await toTrash(env, uid, slot)
    const version = now()
    await env.DB.batch([
      env.DB.prepare('INSERT INTO saves (uid, slot, version, data, summary, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(uid, slot, version, row.data, row.summary, version),
      env.DB.prepare('DELETE FROM trash WHERE id = ?').bind(row.id),
    ])
    return [{ slot, version }, 200]
  }
  return [{ error: 'not found' }, 404]
}
