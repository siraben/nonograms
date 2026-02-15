import type { Env } from "../../lib/auth";
import { requireUser } from "../../lib/auth";
import { err, json, readJson } from "../../lib/http";

type Body = { token?: string };

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;

  if (!env.BOOTSTRAP_TOKEN) return err(400, "BOOTSTRAP_TOKEN not set");

  let body: Body = {};
  try {
    body = await readJson<Body>(request);
  } catch {
    return err(400, "bad json");
  }

  if ((body.token || "").trim() !== env.BOOTSTRAP_TOKEN) return err(403, "invalid bootstrap token");

  await env.DB.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").bind(authed.userId).run();
  return json({ ok: true });
};

