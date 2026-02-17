import type { Env } from "../../../lib/auth";
import { requireUser } from "../../../lib/auth";
import { err, json, readJson } from "../../../lib/http";
import { MAX_MOVES } from "../../../lib/limits";

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
    `SELECT a.id, a.started_at as startedAt, a.completed as completed,
            p.width * p.height as gridSize
     FROM attempts a JOIN puzzles p ON p.id = a.puzzle_id
     WHERE a.id = ? AND a.user_id = ?`
  )
    .bind(attemptId, authed.userId)
    .first<{ id: string; startedAt: string | null; completed: number; gridSize: number }>();
  if (!row) return err(404, "attempt not found");
  if (row.completed === 1) return err(409, "attempt finished");
  if (!row.startedAt) return err(409, "attempt not started");

  const n = row.gridSize | 0;
  if (n <= 0) return err(500, "bad grid size");

  // Validate all moves before writing any
  for (const m of body.moves) {
    const idx = m.idx | 0;
    const st = m.state | 0;
    if (![0, 1, 2].includes(st)) return err(400, "bad state");
    if (idx < 0 || idx >= n) return err(400, "bad idx");
  }

  const now = new Date().toISOString();

  // Sort moves by atMs so seq numbers reflect chronological order.
  const sorted = body.moves
    .map((m) => ({ idx: m.idx | 0, state: m.state | 0, atMs: Math.max(0, m.atMs | 0) }))
    .sort((a, b) => a.atMs - b.atMs);

  // Get current max seq once
  const seqRow = await env.DB.prepare(
    "SELECT COALESCE(MAX(seq), 0) as maxSeq FROM attempt_moves WHERE attempt_id = ?"
  ).bind(attemptId).first<{ maxSeq: number }>();
  let seq = seqRow?.maxSeq ?? 0;

  // Enforce move limit
  let abandoned = false;
  let movesToInsert = sorted;
  if (seq >= MAX_MOVES) {
    // Already at limit — auto-abandon and accept no more moves
    await env.DB.prepare("UPDATE attempts SET completed = 1, eligible = 0 WHERE id = ?").bind(attemptId).run();
    return json({ ok: true, abandoned: true, moveCount: MAX_MOVES });
  }
  if (seq + sorted.length > MAX_MOVES) {
    // Truncate batch to fit within limit
    movesToInsert = sorted.slice(0, MAX_MOVES - seq);
    abandoned = true;
  }

  // Build batch: one insert per move (history only, state materialized on read)
  const stmts: D1PreparedStatement[] = [];
  for (const m of movesToInsert) {
    seq++;
    stmts.push(
      env.DB.prepare(
        "INSERT INTO attempt_moves (attempt_id, seq, at_ms, idx, state, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(attemptId, seq, m.atMs, m.idx, m.state, now)
    );
  }

  if (abandoned) {
    stmts.push(env.DB.prepare("UPDATE attempts SET completed = 1, eligible = 0 WHERE id = ?").bind(attemptId));
  }

  await env.DB.batch(stmts);

  if (abandoned) {
    return json({ ok: true, abandoned: true, moveCount: MAX_MOVES });
  }

  return json({ ok: true });
};
