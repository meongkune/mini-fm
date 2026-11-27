-- Mini FM 기록 옮기기 (Cloudflare D1)
-- 적용: npx wrangler d1 execute mini-fm-db --remote --file=schema.sql   (여러 번 실행해도 안전)
-- 계정·개인정보는 없다. 게임을 다른 기기로 옮기려고 잠깐(24시간) 맡겨 두는 곳이고, 한 번 가져가면 바로 지운다.
CREATE TABLE IF NOT EXISTS transfers (
  code TEXT PRIMARY KEY,      -- 'abc-def-ghk'
  data TEXT NOT NULL,         -- gzip 압축한 게임 JSON의 base64
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS transfers_expires ON transfers(expires_at);
