-- Mini FM 클라우드 세이브 (Cloudflare D1)
-- 적용: npx wrangler d1 execute mini-fm-db --remote --file=schema.sql   (여러 번 실행해도 안전)
-- 개인정보는 저장하지 않는다: 구글 계정 고유 번호(sub)를 비밀값(UID_PEPPER)과 함께 해시한 값만 uid로 쓴다. 이메일·이름·사진은 저장하지 않는다.

-- 계정: 마지막으로 로그인한 한 곳만 인정한다 (session이 바뀌면 예전 접속은 무효)
CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  session TEXT,
  session_at INTEGER,
  created_at INTEGER NOT NULL,
  last_login INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS users_session ON users(session);

-- 세이브 슬롯 (계정당 3개): data = gzip 압축한 세이브 JSON의 base64, version = 저장할 때마다 +1 (덮어쓰기 충돌 방지)
CREATE TABLE IF NOT EXISTS saves (
  uid TEXT NOT NULL,
  slot INTEGER NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  summary TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (uid, slot)
);

-- 휴지통: 지우거나 덮어쓴 슬롯을 7일 동안 보관 (되살리기 가능)
CREATE TABLE IF NOT EXISTS trash (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  slot INTEGER NOT NULL,
  data TEXT NOT NULL,
  summary TEXT,
  deleted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trash_uid ON trash(uid, deleted_at);
