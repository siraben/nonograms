import type { Env } from "../../lib/auth";
import { requireUser } from "../../lib/auth";
import { err, json, readJson } from "../../lib/http";
import { randomInviteCode, sha256Hex } from "../../lib/crypto";

function mask(code: string): string {
  const s = code.replace(/-/g, "");
  if (s.length <= 6) return "******";
  return `${s.slice(0, 2)}…${s.slice(-2)}`;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;
  if (!authed.isAdmin) return err(403, "admin only");

  const rows = await env.DB.prepare(
    `SELECT id, created_at as createdAt, expires_at as expiresAt, max_uses as maxUses, uses, disabled
     FROM invite_codes
     ORDER BY created_at DESC
     LIMIT 200`
  ).all<{ id: string; createdAt: string; expiresAt: string | null; maxUses: number | null; uses: number; disabled: number }>();

  return json({ invites: rows.results.map((r) => ({ ...r, disabled: r.disabled === 1 })) });
};

type CreateBody = { code?: string; maxUses?: number; expiresInDays?: number };
export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;
  if (!authed.isAdmin) return err(403, "admin only");

  let body: CreateBody = {};
  try {
    body = await readJson<CreateBody>(request);
  } catch {
    // ok
  }

  const code = (body.code || "").trim() || randomInviteCode();
  if (!/^[A-Za-z0-9-]{6,64}$/.test(code)) return err(400, "code must be 6-64 chars (A-Z 0-9 -)");

  const maxUses = body.maxUses === undefined ? null : Math.max(1, Math.min(1000, body.maxUses | 0));
  const expiresAt =
    body.expiresInDays === undefined
      ? null
      : new Date(Date.now() + Math.max(1, Math.min(365, body.expiresInDays | 0)) * 86400_000).toISOString();

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const hash = await sha256Hex(code);

  try {
    await env.DB.prepare(
      "INSERT INTO invite_codes (id, code_hash_hex, created_by_user_id, created_at, expires_at, max_uses, uses, disabled) VALUES (?, ?, ?, ?, ?, ?, 0, 0)"
    )
      .bind(id, hash, authed.userId, now, expiresAt, maxUses)
      .run();
  } catch (e) {
    return err(409, "invite code already exists");
  }

  // Return plaintext code only at creation time.
  return json({ invite: { id, code, codeMasked: mask(code), createdAt: now, expiresAt, maxUses } });
};

type DisableBody = { id: string };
export const onRequestPut: PagesFunction<Env> = async ({ env, request }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;
  if (!authed.isAdmin) return err(403, "admin only");

  let body: DisableBody;
  try {
    body = await readJson<DisableBody>(request);
  } catch {
    return err(400, "bad json");
  }
  const id = (body.id || "").trim();
  if (!id) return err(400, "missing id");

  await env.DB.prepare("UPDATE invite_codes SET disabled = 1 WHERE id = ?").bind(id).run();
  return json({ ok: true });
};

