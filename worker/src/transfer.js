// 기록 옮기기: 로그인 없이 코드 하나로 게임을 다른 기기(브라우저)로 옮긴다
// - 보내는 쪽: POST /transfer { data } → { code: 'abc-def-ghk', expires_at }  (data = 압축한 게임, 계정·개인정보 없음)
// - 받는 쪽:  GET /transfer?code=abc-def-ghk → { data }  — 한 번 쓰면 바로 지운다
// - 코드는 24시간이 지나면 못 쓰고, 다음 보내기 때 지운다
const TTL = 24 * 3600 * 1000
const MAX_DATA = 1_800_000 // 압축한 게임이 보통 10~40KB라 넉넉히
const ABC = 'abcdefghjkmnpqrstuvwxyz' // 헷갈리는 i·l·o는 뺀다 (23자 × 9자리 ≈ 1.8조 가지)

function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(9))
  let s = ''
  for (let i = 0; i < 9; i++) {
    s += ABC[b[i] % ABC.length]
    if (i === 2 || i === 5) s += '-'
  }
  return s
}
/** 'ABC def-ghk' 같은 입력도 받아 준다 */
const normalize = (raw) => {
  const t = String(raw || '').toLowerCase().replace(/[^a-z]/g, '')
  return t.length === 9 ? `${t.slice(0, 3)}-${t.slice(3, 6)}-${t.slice(6)}` : null
}

/** /transfer 요청이면 [body, status], 아니면 null */
export async function handleTransfer(req, env, url) {
  if (url.pathname !== '/transfer') return null
  if (!env.DB) return [{ error: 'server', message: '지금은 기록 옮기기를 쓸 수 없어요.' }, 503]
  const now = Date.now()
  if (req.method === 'POST') {
    const body = await req.json().catch(() => null)
    const data = typeof body?.data === 'string' ? body.data : ''
    if (!data || data.length > MAX_DATA) return [{ error: 'bad', message: '옮길 게임이 비어 있거나 너무 커요.' }, 400]
    await env.DB.prepare('DELETE FROM transfers WHERE expires_at < ?').bind(now).run()
    for (let i = 0; i < 5; i++) {
      const code = newCode()
      try {
        await env.DB.prepare('INSERT INTO transfers (code, data, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(code, data, now, now + TTL).run()
        return [{ code, expires_at: now + TTL }, 200]
      } catch { /* 같은 코드가 이미 있으면 다시 뽑는다 */ }
    }
    return [{ error: 'server', message: '코드를 만들지 못했어요. 잠시 뒤 다시 해 주세요.' }, 500]
  }
  if (req.method === 'GET') {
    const code = normalize(url.searchParams.get('code'))
    if (!code) return [{ error: 'bad', message: '코드는 영문 9글자예요 (예: abc-def-ghk).' }, 400]
    const row = await env.DB.prepare('SELECT data, expires_at FROM transfers WHERE code = ?').bind(code).first()
    if (!row || row.expires_at < now) return [{ error: 'notfound', message: '없는 코드이거나 24시간이 지났어요. 보내는 기기에서 코드를 다시 만들어 주세요.' }, 404]
    await env.DB.prepare('DELETE FROM transfers WHERE code = ?').bind(code).run()
    return [{ data: row.data }, 200]
  }
  return [{ error: 'method' }, 405]
}
