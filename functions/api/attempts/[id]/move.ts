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
    "SELECT a.id, a.started_at as startedAt, a.completed as completed, a.current_state_json as stateJson FROM attempts a WHERE a.id = ? AND a.user_id = ?"
  )
    .bind(attemptId, authed.userId)
    .first<{ id: string; startedAt: string | null; completed: number; stateJson: string }>();
  if (!row) return err(404, "attempt not found");
  if (row.completed === 1) return err(409, "attempt finished");

  const now = new Date();
  const startedAt = row.startedAt ? new Date(row.startedAt) : now;
  const atMs = row.startedAt ? now.getTime() - startedAt.getTime() : 0;

  // Update state.
  const state: number[] = JSON.parse(row.stateJson);
  const n = state.length | 0;
  if (n <= 0) return err(500, "bad stored state");
  if (idx < 0 || idx >= n) return err(400, "bad idx");
  state[idx] = st;

  // Seq number.
  const nextSeq = await env.DB.prepare("SELECT COALESCE(MAX(seq), 0) + 1 as s FROM attempt_moves WHERE attempt_id = ?")
    .bind(attemptId)
    .first<{ s: number }>();
  const seq = nextSeq?.s || 1;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO attempt_moves (attempt_id, seq, at_ms, idx, state, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(attemptId, seq, atMs, idx, st, now.toISOString()),
    env.DB.prepare("UPDATE attempts SET current_state_json = ?, started_at = COALESCE(started_at, ?) WHERE id = ?")
      .bind(JSON.stringify(state), startedAt.toISOString(), attemptId)
  ]);

  return json({ ok: true, seq, atMs });
};
