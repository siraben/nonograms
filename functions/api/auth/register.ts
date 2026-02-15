import type { Env } from "../../lib/auth";
import { createSession, destroySession } from "../../lib/auth";
import { err, json, readJson } from "../../lib/http";
import { hashPassword } from "../../lib/password";
import { verifyTurnstile } from "../../lib/turnstile";

type Body = { username: string; password: string; captchaToken?: string };

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const setCookieOld = await destroySession(env, request);

  let body: Body;
  try {
    body = await readJson<Body>(request);
  } catch {
    return err(400, "bad json");
  }

  const remoteip = request.headers.get("CF-Connecting-IP");
  const cap = await verifyTurnstile({
    secretKey: env.TURNSTILE_SECRET_KEY,
    token: body.captchaToken,
    remoteip
  });
  if (!cap.ok) return err(403, `captcha: ${cap.reason || "failed"}`);

  const username = (body.username || "").trim().toLowerCase();
  const password = body.password || "";

  if (!/^[a-z0-9_]{3,24}$/.test(username)) return err(400, "username must be 3-24 chars: a-z 0-9 _");
  if (password.length < 8) return err(400, "password must be at least 8 chars");

  const exists = await env.DB.prepare("SELECT 1 FROM users WHERE username = ?").bind(username).first();
  if (exists) return err(409, "username taken");

  const { saltB64, hashB64, iters } = await hashPassword(password);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO users (id, username, pass_salt_b64, pass_hash_b64, pass_iters, is_admin, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)"
  )
    .bind(id, username, saltB64, hashB64, iters, now)
    .run();

  const s = await createSession(env, request, id, true);
  const res = json({ ok: true });
  res.headers.append("Set-Cookie", setCookieOld);
  res.headers.append("Set-Cookie", s.setCookie);
  return res;
};
