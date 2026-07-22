import type { Env } from "../../../lib/auth";
import { requireUser } from "../../../lib/auth";
import { err, isJsonObject, json, readJson } from "../../../lib/http";
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
    body = await readJson<Body>(request, (value): value is Body =>
      isJsonObject(value) && Array.isArray(value.moves) && value.moves.every((move) =>
        isJsonObject(move) &&
        typeof move.idx === "number" && Number.isFinite(move.idx) &&
        typeof move.state === "number" && Number.isFinite(move.state) &&
        typeof move.atMs === "number" && Number.isFinite(move.atMs)
      )
    );
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

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const elapsedOnServer = Math.max(0, nowDate.getTime() - new Date(row.startedAt).getTime());
  const maxAtMs = elapsedOnServer + 5_000;

  // Preserve request order. Client time is display metadata only and is bounded
  // by server elapsed time before SQL makes it monotonic with accepted moves.
  const sorted = body.moves.map((m) => ({
    idx: m.idx | 0,
    state: m.state | 0,
    atMs: Math.min(maxAtMs, Math.max(0, Math.floor(Number(m.atMs)))),
  }));

  // Each INSERT allocates its sequence in the same statement that writes the
  // move. D1 executes the batch transactionally, so concurrent flushes cannot
  // observe the same MAX(seq) or exceed the row cap.
  const stmts: D1PreparedStatement[] = [];
  for (const m of sorted) {
    stmts.push(
      env.DB.prepare(
         `INSERT INTO attempt_moves (attempt_id, seq, at_ms, idx, state, created_at)
         SELECT ?, COALESCE((SELECT MAX(seq) + 1 FROM attempt_moves WHERE attempt_id = ?), 1),
                MIN(?, MAX(?, COALESCE((
                  SELECT at_ms FROM attempt_moves WHERE attempt_id = ? ORDER BY seq DESC LIMIT 1
                ), 0))), ?, ?, ?
         FROM attempts
         WHERE id = ? AND user_id = ? AND completed = 0 AND finishing = 0
           AND (SELECT COUNT(*) FROM attempt_moves WHERE attempt_id = ?) < ?`
      ).bind(
        attemptId, attemptId, maxAtMs, m.atMs, attemptId, m.idx, m.state, now,
        attemptId, authed.userId, attemptId, MAX_MOVES,
      )
    );
  }
  stmts.push(
    env.DB.prepare(
      `UPDATE attempts SET completed = 1, eligible = 0
       WHERE id = ? AND user_id = ? AND completed = 0
         AND (SELECT COUNT(*) FROM attempt_moves WHERE attempt_id = ?) >= ?`
    ).bind(attemptId, authed.userId, attemptId, MAX_MOVES)
  );

  const results = await env.DB.batch(stmts);
  const inserted = results.slice(0, sorted.length)
    .reduce((count, result) => count + (result.meta?.changes || 0), 0);
  const abandoned = (results[sorted.length]?.meta?.changes || 0) === 1;
  if (abandoned) {
    return json({ ok: true, abandoned: true, moveCount: MAX_MOVES });
  }
  if (inserted === 0) return err(409, "attempt is no longer writable");

  return json({ ok: true });
};
