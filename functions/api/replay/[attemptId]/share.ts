import type { Env } from "../../../lib/auth";
import { requireUser } from "../../../lib/auth";
import { err, json } from "../../../lib/http";

export const onRequestPost: PagesFunction<Env> = async ({ env, request, params }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;

  const attemptId = String(params.attemptId || "");

  const a = await env.DB.prepare(
    "SELECT id, user_id as userId, shared FROM attempts WHERE id = ? AND completed = 1"
  )
    .bind(attemptId)
    .first<{ id: string; userId: string; shared: number }>();

  if (!a) return err(404, "attempt not found");
  if (a.userId !== authed.userId) return err(403, "not your replay");

  const newShared = a.shared ? 0 : 1;
  await env.DB.prepare("UPDATE attempts SET shared = ? WHERE id = ?")
    .bind(newShared, attemptId)
    .run();

  return json({ shared: !!newShared });
};
