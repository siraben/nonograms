import type { Env } from "../../../lib/auth";
import { requireUser } from "../../../lib/auth";
import { err, json } from "../../../lib/http";

export const onRequestGet: PagesFunction<Env> = async ({ env, request, params }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;

  const attemptId = String(params.attemptId || "");
  const a = await env.DB.prepare(
    "SELECT puzzle_id as puzzleId FROM attempts WHERE id = ? AND completed = 1"
  ).bind(attemptId).first<{ puzzleId: string }>();

  if (!a) return err(404, "attempt not found");

  const viewed = await env.DB.prepare(
    "SELECT 1 FROM replay_views WHERE user_id = ? AND puzzle_id = ?"
  ).bind(authed.userId, a.puzzleId).first();

  return json({ alreadyViewed: !!viewed });
};
