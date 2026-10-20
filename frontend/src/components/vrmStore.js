// VRoid로 만든 감독 VRM 파일을 이 브라우저(IndexedDB)에만 저장한다. 서버로 보내지 않는다.
const DB = 'mini-fm'
const STORE = 'files'
const KEY = 'manager.vrm'

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function tx(mode, fn) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const r = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(r?.result)
    t.onerror = () => reject(t.error)
  })
}
export const saveVrm = (buf) => tx('readwrite', (s) => s.put(buf, KEY))
export const loadVrm = async () => { try { return await tx('readonly', (s) => s.get(KEY)) } catch { return null } }
export const deleteVrm = () => tx('readwrite', (s) => s.delete(KEY))
