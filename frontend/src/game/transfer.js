// 저장과 기록 옮기기
// - 게임은 로그인 없이 이 브라우저(localStorage)에 자동 저장된다 (store.jsx)
// - 다른 기기로 옮길 때만 서버에 잠깐 맡기고 코드(abc-def-ghk)를 받는다. 24시간 안에 한 번 쓰면 사라진다
// - 플레이어 번호: 브라우저마다 만드는 익명 번호 (나중에 랭킹·멀티용). 이름·이메일 같은 개인정보는 없다
import { TALK_API } from './aiTalk.js'
import { SAVE_KEY } from '../store.jsx'

// 개발 중에는 .env.development.local의 VITE_CLOUD_API(예: wrangler dev 주소)로 시험할 수 있다
const API = import.meta.env.VITE_CLOUD_API || TALK_API.replace(/\/talk$/, '')
const PLAYER_KEY = 'mini-fm-player'

// ── 익명 플레이어 번호 ──
export function player() {
  try {
    const p = JSON.parse(localStorage.getItem(PLAYER_KEY) || 'null')
    if (p?.id) return p
  } catch { /* 새로 만든다 */ }
  const p = { id: crypto.randomUUID(), createdAt: Date.now() }
  try { localStorage.setItem(PLAYER_KEY, JSON.stringify(p)) } catch { /* 저장 못 함 */ }
  return p
}

// ── 압축: 게임 JSON → gzip → base64 ──
async function streamBytes(stream) { return new Uint8Array(await new Response(stream).arrayBuffer()) }
async function pack(obj) {
  const bytes = await streamBytes(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip')))
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
async function unpack(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text())
}

async function call(path, opts = {}) {
  let res
  try {
    res = await fetch(`${API}${path}`, { ...opts, signal: AbortSignal.timeout(15000) })
  } catch {
    throw new Error('서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.')
  }
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.message || `서버 오류 (${res.status})`)
  return j
}

/** 이 브라우저의 게임을 맡기고 옮기기 코드를 받는다 → { code, expires_at } */
export async function sendGame(save) {
  const data = await pack({ v: 1, save, player: player(), at: Date.now() })
  return call('/transfer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) })
}

/** 코드로 게임을 받아 온다 (아직 이 브라우저에 쓰지는 않음) → { save, player, at } */
export async function receiveGame(code) {
  const j = await call(`/transfer?code=${encodeURIComponent(code.trim())}`)
  const got = await unpack(j.data)
  if (!got?.save || typeof got.save !== 'object') throw new Error('옮겨 온 게임을 읽을 수 없어요.')
  return got
}

/** 받아 온 게임을 이 브라우저 게임으로 쓰고 게임을 새로 띄운다 */
export function applyGame(got) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(got.save))
  if (got.player?.id) { try { localStorage.setItem(PLAYER_KEY, JSON.stringify(got.player)) } catch { /* 없음 */ } }
  reloadGame()
}

// ── 게임 새로 띄우기 (저장된 게임을 바꾼 뒤) ──
const reloadListeners = new Set()
export const onReloadGame = (f) => { reloadListeners.add(f); return () => reloadListeners.delete(f) }
export const reloadGame = () => reloadListeners.forEach((f) => f())

// ── 잠깐 띄우는 안내 (화면이 바뀌어도 남도록 게임 바깥에서 그린다) ──
const toastListeners = new Set()
export const onToast = (f) => { toastListeners.add(f); return () => toastListeners.delete(f) }
export const toast = (text) => toastListeners.forEach((f) => f(text))
