import type { Env } from "../../lib/auth";
import { createSession, destroySession } from "../../lib/auth";
import { err, json, readJson } from "../../lib/http";
import { verifyPassword } from "../../lib/password";

type Body = { username: string; password: string; remember?: boolean };

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

  const row = await env.DB.prepare(
    "SELECT id, pass_salt_b64 as salt, pass_hash_b64 as hash, pass_iters as iters FROM users WHERE username = ?"
  )
    .bind(username)
    .first<{ id: string; salt: string; hash: string; iters: number }>();

  if (!row) return err(401, "invalid username/password");

  const ok = await verifyPassword(password, row.salt, row.hash, row.iters);
  if (!ok) return err(401, "invalid username/password");

  const s = await createSession(env, request, row.id, remember);
  const res = json({ ok: true });
  res.headers.append("Set-Cookie", setCookieOld);
  res.headers.append("Set-Cookie", s.setCookie);
  return res;
};
