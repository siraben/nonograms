import type { Env } from "../../lib/auth";
import { createSession, destroySession } from "../../lib/auth";
import { err, json, readJson } from "../../lib/http";
import { verifyPassword } from "../../lib/password";
import { verifyTurnstile } from "../../lib/turnstile";
import { checkLoginRateLimit, clearLoginFailures, recordLoginFailure } from "../../lib/login-rate-limit";

type Body = { username: string; password: string; remember?: boolean; captchaToken?: string };

const DUMMY_PASSWORD_RECORD = {
  salt: "AAAAAAAAAAAAAAAAAAAAAA==",
  hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  iters: 100_000,
};

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const setCookieOld = await destroySession(env, request);

  let body: Body;
  try {
    body = await readJson<Body>(request);
  } catch {
    return err(400, "bad json");
  }

  const username = (body.username || "").trim().toLowerCase();
  const password = body.password || "";
  const remember = body.remember === true;

  if (!/^[a-z0-9_]{3,24}$/.test(username)) return err(400, "username must be 3-24 chars: a-z 0-9 _");
  if (password.length < 8) return err(400, "password too short");

  const remoteIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const limit = await checkLoginRateLimit(env.DB, remoteIp, username);
  if (limit.blocked) return err(429, "too many login attempts; try again later");
  if (limit.captchaRequired) {
    const allowDevBypass = env.TURNSTILE_DEV_BYPASS === "1";
    if (!env.TURNSTILE_SECRET_KEY && !allowDevBypass) {
      return err(503, "captcha server not configured");
    }
    if (!body.captchaToken) return err(429, "captcha required");
    const captcha = await verifyTurnstile({
      secretKey: env.TURNSTILE_SECRET_KEY,
      token: body.captchaToken,
      remoteip: remoteIp,
      allowDevBypass,
    });
    if (!captcha.ok) return err(429, `captcha: ${captcha.reason || "failed"}`);
  }

  const row = await env.DB.prepare(
    "SELECT id, pass_salt_b64 as salt, pass_hash_b64 as hash, pass_iters as iters FROM users WHERE username = ?"
  )
    .bind(username)
    .first<{ id: string; salt: string; hash: string; iters: number }>();

  const passwordRecord = row || DUMMY_PASSWORD_RECORD;
  const ok = await verifyPassword(password, passwordRecord.salt, passwordRecord.hash, passwordRecord.iters);
  if (!row || !ok) {
    await recordLoginFailure(env.DB, limit.keys);
    return err(401, "invalid username/password");
  }

  await clearLoginFailures(env.DB, limit.keys);
  const s = await createSession(env, request, row.id, remember);
  const res = json({ ok: true });
  res.headers.append("Set-Cookie", setCookieOld);
  res.headers.append("Set-Cookie", s.setCookie);
  return res;
};
