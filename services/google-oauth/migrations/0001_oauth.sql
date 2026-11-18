CREATE TABLE IF NOT EXISTS oauth_flows (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('teacher', 'student')),
  status TEXT NOT NULL CHECK(status IN ('created', 'started', 'exchanging', 'ready', 'failed')),
  browser_hash TEXT,
  encrypted_payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_flows_expiry ON oauth_flows(expires_at);
CREATE TABLE IF NOT EXISTS oauth_sessions (
  token_hash TEXT PRIMARY KEY,
  encrypted_payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_sessions_expiry ON oauth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS oauth_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
