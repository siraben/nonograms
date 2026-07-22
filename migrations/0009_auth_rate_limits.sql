CREATE TABLE auth_rate_limits (
  key_hash TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT
);

CREATE INDEX idx_auth_rate_limits_window ON auth_rate_limits(window_started_at);
