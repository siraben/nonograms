import type { Env } from "../../../lib/auth";
import { requireUser } from "../../../lib/auth";
import { err, json, readJson } from "../../../lib/http";

type Body = { idx: number; state: number };

export const onRequestPost: PagesFunction<Env> = async ({ env, request, params }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;

  const attemptId = String(params.id || "");
  let body: Body;
  try {
    body = await readJson<Body>(request);
  } catch {
    return err(400, "bad json");
  }

  const idx = body.idx | 0;
  const st = body.state | 0;
  if (![0, 1, 2].includes(st)) return err(400, "bad state");

  const row = await env.DB.prepare(
    "SELECT a.id, a.started_at as startedAt, a.completed as completed, json_array_length(a.current_state_json) as stateLen FROM attempts a WHERE a.id = ? AND a.user_id = ?"
  )
    .bind(attemptId, authed.userId)
    .first<{ id: string; startedAt: string | null; completed: number; stateLen: number }>();
  if (!row) return err(404, "attempt not found");
  if (row.completed === 1) return err(409, "attempt finished");
  if (!row.startedAt) return err(409, "attempt not started");

  const n = row.stateLen | 0;
  if (n <= 0) return err(500, "bad stored state");
  if (idx < 0 || idx >= n) return err(400, "bad idx");

  const now = new Date();
  const startedAt = new Date(row.startedAt!);
  const atMs = now.getTime() - startedAt.getTime();

  // Use json_set to atomically update the single cell, avoiding read-modify-write races.
  // Seq is computed inline to avoid a separate read-then-insert race on the sequence number.
  const path = `$[${idx}]`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO attempt_moves (attempt_id, seq, at_ms, idx, state, created_at) VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM attempt_moves WHERE attempt_id = ?), ?, ?, ?, ?)"
    ).bind(attemptId, attemptId, atMs, idx, st, now.toISOString()),
    env.DB.prepare(
      "UPDATE attempts SET current_state_json = json_set(current_state_json, ?, ?) WHERE id = ?"
    ).bind(path, st, attemptId)
  ]);

  return json({ ok: true, atMs });
};
