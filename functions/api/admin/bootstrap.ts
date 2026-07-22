import type { Env } from "../../lib/auth";
import { requireUser } from "../../lib/auth";
import { err, isJsonObject, json, readJson } from "../../lib/http";

type Body = { token?: string };

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;

  if (!env.BOOTSTRAP_TOKEN) return err(400, "BOOTSTRAP_TOKEN not set");

  let body: Body = {};
  try {
    body = await readJson<Body>(request, (value): value is Body =>
      isJsonObject(value) && (value.token === undefined || typeof value.token === "string")
    );
  } catch {
    return err(400, "bad json");
  }

  const enc = new TextEncoder();
  const [provided, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode((body.token || "").trim())),
    crypto.subtle.digest("SHA-256", enc.encode(env.BOOTSTRAP_TOKEN)),
  ]);
  if (!crypto.subtle.timingSafeEqual(provided, expected)) return err(403, "invalid bootstrap token");

  const promoted = await env.DB.prepare(
    `UPDATE users SET is_admin = 1
     WHERE id = ? AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = 1)`
  ).bind(authed.userId).run();
  if ((promoted.meta?.changes || 0) !== 1) return err(409, "bootstrap already completed");

  return json({ ok: true });
};
