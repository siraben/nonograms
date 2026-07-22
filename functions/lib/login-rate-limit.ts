import { sha256Hex } from "./crypto";

const WINDOW_MS = 15 * 60_000;
const BLOCK_AFTER = 10;
const CAPTCHA_AFTER = 5;

type LimitRow = {
  keyHash: string;
  failures: number;
  windowStartedAt: string;
  blockedUntil: string | null;
};

export type LoginRateLimit = {
  keys: string[];
  captchaRequired: boolean;
  blocked: boolean;
};

export async function checkLoginRateLimit(
  db: D1Database,
  ip: string,
  username: string,
): Promise<LoginRateLimit> {
  const keys = await Promise.all([
    sha256Hex(`ip:${ip}`),
    sha256Hex(`username:${username}`),
  ]);
  const rows = await db.prepare(
    `SELECT key_hash as keyHash, failures, window_started_at as windowStartedAt,
            blocked_until as blockedUntil
     FROM auth_rate_limits WHERE key_hash IN (?, ?)`
  ).bind(...keys).all<LimitRow>();

  const now = Date.now();
  const active = rows.results.filter((row) => {
    const started = Date.parse(row.windowStartedAt);
    return Number.isFinite(started) && now - started < WINDOW_MS;
  });
  return {
    keys,
    captchaRequired: active.some((row) => row.failures >= CAPTCHA_AFTER),
    blocked: active.some((row) => row.blockedUntil !== null && Date.parse(row.blockedUntil) > now),
  };
}

export async function recordLoginFailure(db: D1Database, keys: string[]): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - WINDOW_MS).toISOString();
  const blockUntil = new Date(now.getTime() + WINDOW_MS).toISOString();
  const statements = keys.map((key) => db.prepare(
    `INSERT INTO auth_rate_limits (key_hash, failures, window_started_at, blocked_until)
     VALUES (?, 1, ?, NULL)
     ON CONFLICT(key_hash) DO UPDATE SET
       failures = CASE
         WHEN auth_rate_limits.window_started_at < ? THEN 1
         ELSE auth_rate_limits.failures + 1
       END,
       window_started_at = CASE
         WHEN auth_rate_limits.window_started_at < ? THEN excluded.window_started_at
         ELSE auth_rate_limits.window_started_at
       END,
       blocked_until = CASE
         WHEN auth_rate_limits.window_started_at < ? THEN NULL
         WHEN auth_rate_limits.failures + 1 >= ? THEN ?
         ELSE auth_rate_limits.blocked_until
       END`
  ).bind(key, nowIso, cutoff, cutoff, cutoff, BLOCK_AFTER, blockUntil));

  statements.push(
    db.prepare("DELETE FROM auth_rate_limits WHERE window_started_at < ?")
      .bind(new Date(now.getTime() - 2 * WINDOW_MS).toISOString())
  );
  await db.batch(statements);
}

export async function clearLoginFailures(db: D1Database, keys: string[]): Promise<void> {
  await db.prepare("DELETE FROM auth_rate_limits WHERE key_hash IN (?, ?)").bind(...keys).run();
}
