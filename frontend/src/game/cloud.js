// 클라우드 세이브 (구글 로그인 + Cloudflare 워커/D1)
// - 로그인하지 않으면 지금처럼 이 브라우저(localStorage)에만 저장하는 '게스트' 모드
// - 로그인하고 슬롯을 고르면 그 슬롯이 '지금 하는 게임'이 되고, 바뀔 때마다 서버에 올린다 (중요한 진행은 바로, 나머지는 잠깐 모아서)
// - 서버에는 구글 계정을 해시한 번호와 세이브만 간다. 이메일·이름은 브라우저에서도 읽지 않는다
import { TALK_API } from './aiTalk.js'

// 개발 중에는 .env.development.local의 VITE_CLOUD_API(예: wrangler dev 주소)로 시험할 수 있다
export const CLOUD_API = import.meta.env.VITE_CLOUD_API || TALK_API.replace(/\/talk$/, '')
export const SLOTS_MAX = 3
export const GOOGLE_CLIENT_ID = '751296159418-na2n9kkm0cno51l8oj66eqbqsd42i82a.apps.googleusercontent.com'
const SESSION_KEY = 'mini-fm-cloud' // { token, slot, version }
export const CACHE_KEY = 'mini-fm-cloud-cache' // 지금 하는 클라우드 슬롯의 세이브 (게스트 세이브와 따로)

// ── 접속 정보 ──
export function session() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') } catch { return null }
}
export function setSession(s) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(CACHE_KEY) } // 로그아웃·접속 끊김: 이 기기에 남은 클라우드 세이브 사본도 지운다
  } catch { /* 저장 못 함 */ }
  listeners.forEach((f) => f())
}
/** 지금 클라우드 슬롯으로 하고 있는지 */
export const cloudActive = () => { const s = session(); return !!(s?.token && s?.slot) }
const listeners = new Set()
export const onSession = (f) => { listeners.add(f); return () => listeners.delete(f) }

// ── 압축: 세이브 JSON → gzip → base64 (40KB가 8KB 정도로) ──
async function streamBytes(stream) { return new Uint8Array(await new Response(stream).arrayBuffer()) }
export async function pack(obj) {
  const bytes = await streamBytes(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip')))
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
export async function unpack(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
  return JSON.parse(text)
}

// ── 서버 요청 ──
export class CloudError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = kind; Object.assign(this, extra) }
}
async function call(path, { method = 'GET', body, auth = true } = {}) {
  const s = session()
  let res
  try {
    res = await fetch(`${CLOUD_API}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth && s?.token ? { Authorization: `Bearer ${s.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new CloudError('offline', '서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.')
  }
  const j = await res.json().catch(() => ({}))
  if (res.status === 401 && j.error === 'session') throw new CloudError('kicked', j.message || '다른 곳에서 로그인했습니다.')
  if (res.status === 409) throw new CloudError('conflict', j.message || '다른 곳에서 먼저 저장했습니다.', { version: j.version })
  if (!res.ok) throw new CloudError(j.error || 'server', j.message || `서버 오류 (${res.status})`)
  return j
}

/** 구글 로그인 결과(ID 토큰)로 접속 → { slots, trash } (예전 기기의 접속은 끊긴다) */
export async function login(credential) {
  const j = await call('/auth', { method: 'POST', body: { credential }, auth: false })
  setSession({ token: j.token, slot: null, version: 0 })
  return j
}
export async function logout() {
  try { await call('/logout', { method: 'POST', body: {} }) } catch { /* 이미 끊겼어도 이 기기에서는 로그아웃 */ }
  setSession(null)
  try { localStorage.removeItem(CACHE_KEY) } catch { /* 없음 */ }
}
export const listSlots = () => call('/slots')
/** 계정 삭제: 서버의 계정·세이브·휴지통을 모두 지우고 게스트로 */
export async function deleteAccount() {
  await call('/account', { method: 'DELETE' })
  setSession(null)
  try { localStorage.removeItem(CACHE_KEY) } catch { /* 없음 */ }
}

/** 세이브 요약 (슬롯 목록에 보여줄 것) */
export function summaryOf(save, extra = {}) {
  return { team: extra.team || '', teamId: save.teamId || '', league: save.league || '', season: save.seasonNo || 1, round: save.round || 0, ...extra }
}

/** 슬롯을 받아 '지금 하는 게임'으로 — 캐시에 넣고 접속 정보에 슬롯·버전 기록 */
export async function openSlot(slot) {
  const j = await call(`/save?slot=${slot}`)
  const save = await unpack(j.data)
  localStorage.setItem(CACHE_KEY, JSON.stringify(save))
  setSession({ ...session(), slot, version: j.version })
  return save
}
/** 빈 슬롯(또는 덮어쓰기)에 세이브를 올리고 그 슬롯으로 하기 */
export async function startSlot(slot, save, summary, replace = false) {
  const j = await call('/save', { method: 'PUT', body: { slot, baseVersion: 0, replace, data: await pack(save), summary } })
  localStorage.setItem(CACHE_KEY, JSON.stringify(save))
  setSession({ ...session(), slot, version: j.version })
  return j
}
export const deleteSlot = (slot) => call(`/save?slot=${slot}`, { method: 'DELETE' })
export const restoreTrash = (id, slot) => call('/restore', { method: 'POST', body: { id, slot } })
/** 클라우드 슬롯에서 나가기 (게스트 세이브로 돌아감, 로그인은 유지) */
export function leaveSlot() {
  setSession({ ...session(), slot: null, version: 0 })
  try { localStorage.removeItem(CACHE_KEY) } catch { /* 없음 */ }
}

// ── 자동 저장 ──
// 상태: idle(저장됨) · pending(모으는 중) · saving · offline(연결 끊김 — 진행 막음) · kicked(다른 곳 접속) · conflict(다른 곳에서 먼저 저장)
let state = { status: 'idle', at: 0, message: '' }
const stateListeners = new Set()
export const syncState = () => state
export const onSync = (f) => { stateListeners.add(f); return () => stateListeners.delete(f) }
const setState = (s) => { state = { ...state, ...s }; stateListeners.forEach((f) => f(state)) }

let latest = null // { save, summary }
let timer = null
let busy = false
let retryTimer = null

/** 세이브가 바뀔 때마다 부른다. important면 바로 올린다 (라운드 진행·이적·계약 등) */
export function queueSave(save, summary, important = false) {
  if (!cloudActive()) return
  latest = { save, summary }
  if (state.status === 'kicked' || state.status === 'conflict') return
  if (state.status !== 'offline' && state.status !== 'saving') setState({ status: 'pending' })
  clearTimeout(timer)
  timer = setTimeout(flush, important ? 0 : 2500)
}

export async function flush() {
  clearTimeout(timer)
  if (busy || !latest || !cloudActive()) return
  busy = true
  const { save, summary } = latest
  latest = null
  setState({ status: 'saving' })
  try {
    const s = session()
    const j = await call('/save', { method: 'PUT', body: { slot: s.slot, baseVersion: s.version, data: await pack(save), summary } })
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ ...session(), version: j.version })) } catch { /* 없음 */ }
    setState({ status: latest ? 'pending' : 'idle', at: Date.now(), message: '' })
  } catch (e) {
    latest = latest || { save, summary } // 실패한 것은 다시 올릴 수 있게 남겨 둔다
    if (e.kind === 'offline' || e.kind === 'server') {
      setState({ status: 'offline', message: e.message })
      clearTimeout(retryTimer)
      retryTimer = setTimeout(flush, 5000)
    } else setState({ status: e.kind === 'kicked' || e.kind === 'conflict' ? e.kind : 'offline', message: e.message })
  } finally {
    busy = false
  }
  if (latest && state.status === 'pending') timer = setTimeout(flush, 300)
}
if (typeof window !== 'undefined') window.addEventListener('online', () => { if (state.status === 'offline') flush() })

/** 충돌 해결: 내 것으로 덮어쓰기 (서버 것은 휴지통으로) */
export async function forceMine() {
  const pending = latest
  if (!pending) return
  const s = session()
  setState({ status: 'saving' })
  try {
    const j = await call('/save', { method: 'PUT', body: { slot: s.slot, replace: true, data: await pack(pending.save), summary: pending.summary } })
    latest = null
    setSession({ ...session(), version: j.version })
    setState({ status: 'idle', at: Date.now(), message: '' })
  } catch (e) { setState({ status: e.kind === 'kicked' ? 'kicked' : 'offline', message: e.message }) }
}
/** 충돌·접속 문제 상태를 지운다 (슬롯을 다시 받은 뒤) */
export function resetSync() { latest = null; clearTimeout(timer); setState({ status: 'idle', message: '' }) }

// ── 잠깐 띄우는 안내 (화면이 바뀌어도 남도록 게임 바깥에서 그린다) ──
const toastListeners = new Set()
export const onToast = (f) => { toastListeners.add(f); return () => toastListeners.delete(f) }
export const toast = (text) => toastListeners.forEach((f) => f(text))

/** '방금' · 'n분 전' · '오후 3:12' 같은 쉬운 시각 */
export function ago(t) {
  if (!t) return ''
  const s = (Date.now() - t) / 1000
  if (s < 60) return '방금'
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  const d = new Date(t)
  const today = new Date().toDateString() === d.toDateString()
  return d.toLocaleString('ko-KR', today ? { hour: 'numeric', minute: '2-digit' } : { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ── 구글 로그인 버튼 (Google Identity Services) ──
let gisPromise = null
export function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google)
  gisPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve(window.google)
    s.onerror = () => { gisPromise = null; reject(new Error('구글 로그인 스크립트를 불러오지 못했습니다.')) }
    document.head.appendChild(s)
  })
  return gisPromise
}
