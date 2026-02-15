import { err, getCookie, setCookieHeader } from "./http";

export type Env = {
  DB: D1Database;
  INVITE_CODE?: string;
  BOOTSTRAP_TOKEN?: string;
  TURNSTILE_SECRET_KEY?: string;
};

export type Authed = { userId: string; username: string; isAdmin: boolean };

export function isHttps(req: Request): boolean {
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export async function getSession(env: Env, req: Request): Promise<Authed | null> {
  const sid = getCookie(req, "sid");
  if (!sid) return null;

  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT u.id as userId, u.username as username, u.is_admin as isAdmin
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`
  )
    .bind(sid, now)
    .first<{ userId: string; username: string; isAdmin: number }>();

  if (!row) return null;
  return { userId: row.userId, username: row.username, isAdmin: row.isAdmin === 1 };
}

export async function requireUser(env: Env, req: Request): Promise<Authed | Response> {
  const s = await getSession(env, req);
  if (!s) return err(401, "not logged in");
  return s;
}

export async function createSession(env: Env, req: Request, userId: string, remember: boolean): Promise<{ sid: string; setCookie: string }> {
  const sid = crypto.randomUUID();

  const now = new Date();
  const maxAgeSeconds = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 12;
  const expiresAt = new Date(now.getTime() + maxAgeSeconds * 1000);

  await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(sid, userId, now.toISOString(), expiresAt.toISOString())
    .run();

  const setCookie = setCookieHeader({
    name: "sid",
    value: sid,
    secure: isHttps(req),
    sameSite: "Lax",
    httpOnly: true,
    // For "remember me" set Max-Age so it persists. Otherwise, session cookie.
    maxAgeSeconds: remember ? maxAgeSeconds : undefined
  });

  return { sid, setCookie };
}

export async function destroySession(env: Env, req: Request): Promise<string> {
  const sid = getCookie(req, "sid");
  if (sid) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
  }
  return setCookieHeader({
    name: "sid",
    value: "",
    secure: isHttps(req),
    sameSite: "Lax",
    httpOnly: true,
    maxAgeSeconds: 0,
    expires: new Date(0)
  });
}
