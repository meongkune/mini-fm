// GitHub REST API로 레포의 시즌 데이터를 읽고 커밋한다 (/admin 전용)
// 토큰은 이 브라우저에만 저장되고 api.github.com 외에는 보내지 않는다.
const API = 'https://api.github.com'
export const BRANCH = 'main'
export const DATA_DIR = 'frontend/public/data'

/** 배포 시 넣은 레포 이름(VITE_GITHUB_REPO), 없으면 Pages 주소(<owner>.github.io/<repo>)에서 추정 */
export function defaultRepo() {
  if (import.meta.env.VITE_GITHUB_REPO) return import.meta.env.VITE_GITHUB_REPO
  const m = location.hostname.match(/^([^.]+)\.github\.io$/)
  const repo = import.meta.env.BASE_URL.replace(/\//g, '')
  return m && repo ? `${m[1]}/${repo}` : ''
}

// UTF-8 ↔ base64 (atob/btoa는 Latin-1만 다뤄서 한글·악센트 이름이 깨진다)
const decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)))
function encode(text) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const hint = {
      401: '토큰이 올바르지 않거나 만료됐습니다.',
      403: '권한이 없거나 요청 한도를 넘었습니다. 토큰에 이 레포의 Contents 쓰기 권한이 있는지 확인하세요.',
      404: '레포 또는 파일을 찾을 수 없습니다. (비공개 레포라면 토큰이 필요합니다)',
      409: '그사이 파일이 바뀌었습니다. 다시 불러온 뒤 편집하세요.',
      422: '요청 형식 오류입니다. 다시 불러온 뒤 시도하세요.',
    }[res.status]
    const err = new Error(`${hint || 'GitHub API 오류'} (${res.status}${json.message ? `: ${json.message}` : ''})`)
    err.status = res.status
    throw err
  }
  return json
}

/** 토큰 확인: 레포 쓰기 권한이 있는지 */
export async function checkAccess(repo, token) {
  const r = await call(`/repos/${repo}`, { token })
  return { canPush: Boolean(r.permissions?.push), fullName: r.full_name, htmlUrl: r.html_url }
}

/** 레포의 파일 내용과 sha (sha는 커밋할 때 "이 버전을 고친다"는 확인용) */
export async function readFile(repo, path, token) {
  const url = `/repos/${repo}/contents/${path}?ref=${BRANCH}`
  // 토큰이 틀려도 공개 레포는 읽을 수 있으므로 401이면 토큰 없이 다시 시도
  const r = await call(url, { token }).catch((e) => (e.status === 401 && token ? call(url) : Promise.reject(e)))
  // 1MB가 넘는 파일은 content가 비어 오므로 blob으로 다시 읽는다
  const text = r.content ? decode(r.content) : decode((await call(`/repos/${repo}/git/blobs/${r.sha}`, { token })).content)
  return { text, sha: r.sha }
}

/** 파일 하나를 커밋한다. sha가 레포의 현재 값과 다르면 409(충돌) */
export async function writeFile(repo, path, text, { sha, message, token }) {
  const r = await call(`/repos/${repo}/contents/${path}`, {
    token,
    method: 'PUT',
    body: { message, content: encode(text), sha, branch: BRANCH },
  })
  return { sha: r.content.sha, commitSha: r.commit.sha, commitUrl: r.commit.html_url }
}
