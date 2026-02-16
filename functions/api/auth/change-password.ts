import type { Env } from "../../lib/auth";
import { requireUser } from "../../lib/auth";
import { err, json, readJson } from "../../lib/http";
import { hashPassword, verifyPassword } from "../../lib/password";

type Body = { currentPassword: string; newPassword: string };

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;

  let body: Body;
  try {
    body = await readJson<Body>(request);
  } catch {
    return err(400, "bad json");
  }

  const currentPassword = body.currentPassword || "";
  const newPassword = body.newPassword || "";

  if (newPassword.length < 8) return err(400, "new password must be at least 8 characters");

  const row = await env.DB.prepare(
    "SELECT pass_salt_b64 as salt, pass_hash_b64 as hash, pass_iters as iters FROM users WHERE id = ?"
  )
    .bind(authed.userId)
    .first<{ salt: string; hash: string; iters: number }>();

  if (!row) return err(401, "user not found");

  const ok = await verifyPassword(currentPassword, row.salt, row.hash, row.iters);
  if (!ok) return err(401, "current password is incorrect");

  const { saltB64, hashB64, iters } = await hashPassword(newPassword);

  await env.DB.prepare(
    "UPDATE users SET pass_salt_b64 = ?, pass_hash_b64 = ?, pass_iters = ? WHERE id = ?"
  )
    .bind(saltB64, hashB64, iters, authed.userId)
    .run();

  return json({ ok: true });
};
