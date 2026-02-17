import type { Env } from "../../../lib/auth";
import { requireUser } from "../../../lib/auth";
import { err, json, readJson } from "../../../lib/http";

type Move = { idx: number; state: number; atMs: number };
type Body = { moves: Move[] };

const MAX_BATCH = 50;

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

  if (!Array.isArray(body.moves) || body.moves.length === 0) return err(400, "empty moves");
  if (body.moves.length > MAX_BATCH) return err(400, "too many moves");

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

  // Validate all moves before writing any
  for (const m of body.moves) {
    const idx = m.idx | 0;
    const st = m.state | 0;
    if (![0, 1, 2].includes(st)) return err(400, "bad state");
    if (idx < 0 || idx >= n) return err(400, "bad idx");
  }

  const now = new Date().toISOString();

  // Sort moves by atMs so seq numbers and json_set calls reflect chronological order.
  const sorted = body.moves
    .map((m) => ({ idx: m.idx | 0, state: m.state | 0, atMs: Math.max(0, m.atMs | 0) }))
    .sort((a, b) => a.atMs - b.atMs);

  // Get current max seq once
  const seqRow = await env.DB.prepare(
    "SELECT COALESCE(MAX(seq), 0) as maxSeq FROM attempt_moves WHERE attempt_id = ?"
  ).bind(attemptId).first<{ maxSeq: number }>();
  let seq = seqRow?.maxSeq ?? 0;

  // For current_state_json, only apply the last state per cell (highest atMs).
  const finalState = new Map<number, number>();
  for (const m of sorted) finalState.set(m.idx, m.state);

  // Build batch: inserts for all moves (history), then one json_set per unique cell
  const stmts: D1PreparedStatement[] = [];
  for (const m of sorted) {
    seq++;
    stmts.push(
      env.DB.prepare(
        "INSERT INTO attempt_moves (attempt_id, seq, at_ms, idx, state, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(attemptId, seq, m.atMs, m.idx, m.state, now)
    );
  }
  for (const [idx, st] of finalState) {
    stmts.push(
      env.DB.prepare(
        "UPDATE attempts SET current_state_json = json_set(current_state_json, ?, ?) WHERE id = ?"
      ).bind(`$[${idx}]`, st, attemptId)
    );
  }

  await env.DB.batch(stmts);

  return json({ ok: true });
};
