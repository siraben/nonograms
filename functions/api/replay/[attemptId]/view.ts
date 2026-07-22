import type { Env } from "../../../lib/auth";
import { requireUser } from "../../../lib/auth";
import { err, json } from "../../../lib/http";

export const onRequestPost: PagesFunction<Env> = async ({ env, request, params }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;

  const origin = request.headers.get("Origin");
  if (origin !== new URL(request.url).origin) return err(403, "invalid origin");

  const attemptId = String(params.attemptId || "");
  const attempt = await env.DB.prepare(
    `SELECT puzzle_id as puzzleId, user_id as userId, shared
     FROM attempts WHERE id = ? AND completed = 1`
  ).bind(attemptId).first<{ puzzleId: string; userId: string; shared: number }>();

  if (!attempt || (!attempt.shared && attempt.userId !== authed.userId)) {
    return err(404, "replay not found");
  }
  if (attempt.userId === authed.userId) return json({ ok: true });

  await env.DB.prepare(
    "INSERT OR IGNORE INTO replay_views (user_id, puzzle_id, viewed_at) VALUES (?, ?, ?)"
  ).bind(authed.userId, attempt.puzzleId, new Date().toISOString()).run();

  return json({ ok: true });
};
