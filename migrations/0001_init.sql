-- Users + sessions
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  pass_salt_b64 TEXT NOT NULL,
  pass_hash_b64 TEXT NOT NULL,
  pass_iters INTEGER NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Puzzles are immutable. Attempts are per-user and store state + move log.
CREATE TABLE IF NOT EXISTS puzzles (
  id TEXT PRIMARY KEY,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  solution TEXT NOT NULL, -- 0/1 string length width*height
  row_clues_json TEXT NOT NULL,
  col_clues_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS replay_views (
  user_id TEXT NOT NULL,
  puzzle_id TEXT NOT NULL,
  viewed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, puzzle_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (puzzle_id) REFERENCES puzzles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_replay_views_puzzle ON replay_views(puzzle_id);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  puzzle_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT, -- set on first move
  finished_at TEXT,
  duration_ms INTEGER,
  eligible INTEGER NOT NULL DEFAULT 1,
  completed INTEGER NOT NULL DEFAULT 0,
  current_state_json TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (puzzle_id) REFERENCES puzzles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_puzzle ON attempts(puzzle_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_leader ON attempts(completed, eligible, duration_ms);

CREATE TABLE IF NOT EXISTS attempt_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  at_ms INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  state INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_attempt_moves_attempt_seq ON attempt_moves(attempt_id, seq);

