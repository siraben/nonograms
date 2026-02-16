import type { Env } from "../../../lib/auth";
import { requireUser } from "../../../lib/auth";
import { err, json } from "../../../lib/http";

export const onRequestPost: PagesFunction<Env> = async ({ env, request, params }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;

  const attemptId = String(params.id || "");

  const upd = await env.DB.prepare(
    "UPDATE attempts SET completed = 1, eligible = 0 WHERE id = ? AND user_id = ? AND completed = 0 AND started_at IS NOT NULL"
  )
    .bind(attemptId, authed.userId)
    .run();

  if ((upd.meta?.changes || 0) !== 1) return err(409, "attempt already finished or not started");

  return json({ ok: true });
};
