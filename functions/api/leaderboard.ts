import type { Env } from "../lib/auth";
import { requireUser } from "../lib/auth";
import { json } from "../lib/http";

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;

  const rows = await env.DB.prepare(
    `SELECT a.id as attemptId, a.puzzle_id as puzzleId, a.duration_ms as durationMs, a.finished_at as finishedAt,
            u.username as username
     FROM attempts a
     JOIN users u ON u.id = a.user_id
     WHERE a.completed = 1 AND a.eligible = 1 AND a.duration_ms IS NOT NULL
     ORDER BY a.duration_ms ASC
     LIMIT 50`
  ).all<{ attemptId: string; puzzleId: string; durationMs: number; finishedAt: string; username: string }>();

  return json({ leaderboard: rows.results });
};

