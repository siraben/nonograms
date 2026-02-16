import type { Env } from "../../lib/auth";
import { createSession, destroySession } from "../../lib/auth";
import { err, json, readJson } from "../../lib/http";
import { hashPassword } from "../../lib/password";
import { verifyTurnstile } from "../../lib/turnstile";
import { sha256Hex } from "../../lib/crypto";

type Body = { username: string; password: string; captchaToken?: string; inviteCode?: string };

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const setCookieOld = await destroySession(env, request);

  let body: Body;
  try {
    body = await readJson<Body>(request);
  } catch {
    return err(400, "bad json");
  }

  // Enforce captcha if configured (recommended for production).
  if (env.TURNSTILE_SECRET_KEY) {
    const remoteip = request.headers.get("CF-Connecting-IP");
    const cap = await verifyTurnstile({
      secretKey: env.TURNSTILE_SECRET_KEY,
      token: body.captchaToken,
      remoteip
    });
    if (!cap.ok) return err(403, `captcha: ${cap.reason || "failed"}`);
  }

  const username = (body.username || "").trim().toLowerCase();
  const password = body.password || "";

  if (!/^[a-z0-9_]{3,24}$/.test(username)) return err(400, "username must be 3-24 chars: a-z 0-9 _");
  if (password.length < 8) return err(400, "password must be at least 8 chars");

  const exists = await env.DB.prepare("SELECT 1 FROM users WHERE username = ?").bind(username).first();
  if (exists) return err(409, "username taken");

  // Enforce invite codes by default (friends-only). Set INVITES_REQUIRED=0 to allow open registration.
  // Validate + consume invite code after username check to avoid wasting codes on duplicate usernames.
  let inviteCodeId: string | null = null;
  if (env.INVITES_REQUIRED !== "0") {
    const code = (body.inviteCode || "").trim();
    if (!code) return err(403, "invite code required");

    const hash = await sha256Hex(code);
    const nowIso = new Date().toISOString();
    let found: { id: string } | null = null;
    try {
      found = await env.DB.prepare(
        "SELECT id FROM invite_codes WHERE code_hash_hex = ? AND disabled = 0 AND (expires_at IS NULL OR expires_at > ?)"
      )
        .bind(hash, nowIso)
        .first<{ id: string }>();
    } catch (e) {
      const msg = String(e);
      if (msg.includes("no such table: invite_codes")) {
        return err(500, "invite codes not migrated. Run D1 migrations.");
      }
      throw e;
    }
    if (!found) return err(403, "invalid invite code");

    // Atomic-ish consume: guard max_uses inside the update.
    const upd = await env.DB.prepare(
      "UPDATE invite_codes SET uses = uses + 1 WHERE id = ? AND disabled = 0 AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR uses < max_uses)"
    )
      .bind(found.id, nowIso)
      .run();
    if ((upd.meta?.changes || 0) !== 1) return err(403, "invite code exhausted");
    inviteCodeId = found.id;
  }

  const { saltB64, hashB64, iters } = await hashPassword(password);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      "INSERT INTO users (id, username, pass_salt_b64, pass_hash_b64, pass_iters, is_admin, created_at, invite_code_id) VALUES (?, ?, ?, ?, ?, 0, ?, ?)"
    )
      .bind(id, username, saltB64, hashB64, iters, now, inviteCodeId)
      .run();
  } catch (e) {
    const msg = String(e);
    if (msg.includes("UNIQUE") || msg.includes("unique")) return err(409, "username taken");
    throw e;
  }

  const s = await createSession(env, request, id, true);
  const res = json({ ok: true });
  res.headers.append("Set-Cookie", setCookieOld);
  res.headers.append("Set-Cookie", s.setCookie);
  return res;
};
