import type { Env } from "../../lib/auth";
import { requireUser } from "../../lib/auth";
import { err, json, readJson } from "../../lib/http";
import { genPuzzle } from "../../lib/puzzle";
import { randomU32 } from "../../lib/rng";

type Body = { puzzleId?: string; size?: number };

const ALLOWED_SIZES = [5, 10, 15] as const;

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;

  let body: Body = {};
  try {
    body = await readJson<Body>(request);
  } catch {
    // ok: default
  }

  const now = new Date().toISOString();

  // Abandon stale in-progress attempts and clean up never-started ones in a single batch.
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE attempts SET completed = 1, eligible = 0 WHERE user_id = ? AND completed = 0 AND started_at IS NOT NULL"
    ).bind(authed.userId),
    env.DB.prepare(
      "DELETE FROM attempts WHERE user_id = ? AND completed = 0 AND started_at IS NULL"
    ).bind(authed.userId),
  ]);

  let puzzleId = body.puzzleId;

  const size = body.size && ALLOWED_SIZES.includes(body.size as any) ? body.size : 10;
  let width: number;
  let height: number;

  if (puzzleId) {
    const puzzleRow = await env.DB.prepare("SELECT width, height FROM puzzles WHERE id = ?").bind(puzzleId).first<{ width: number; height: number }>();
    if (!puzzleRow) return err(404, "puzzle not found");
    width = puzzleRow.width;
    height = puzzleRow.height;
  } else {
    const seed = randomU32();
    const p = genPuzzle(size, size, seed);
    puzzleId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO puzzles (id, width, height, seed, solution, row_clues_json, col_clues_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(puzzleId, p.width, p.height, p.seed, p.solution, JSON.stringify(p.rowClues), JSON.stringify(p.colClues), now)
      .run();
    width = size;
    height = size;
  }

  const attemptId = crypto.randomUUID();
  const state = Array.from({ length: width * height }, () => 0);
  // Compute eligibility atomically via subquery to avoid TOCTTOU race with concurrent replay views.
  await env.DB.prepare(
    `INSERT INTO attempts (id, puzzle_id, user_id, created_at, eligible, completed, current_state_json)
     VALUES (?, ?, ?, ?,
       CASE WHEN EXISTS(SELECT 1 FROM replay_views WHERE user_id = ? AND puzzle_id = ?)
                 OR EXISTS(SELECT 1 FROM attempts WHERE user_id = ? AND puzzle_id = ? AND started_at IS NOT NULL)
            THEN 0 ELSE 1 END,
       0, ?)`
  )
    .bind(attemptId, puzzleId, authed.userId, now, authed.userId, puzzleId, authed.userId, puzzleId, JSON.stringify(state))
    .run();

  const eligible = await env.DB.prepare("SELECT eligible FROM attempts WHERE id = ?")
    .bind(attemptId).first<{ eligible: number }>();

  return json({
    attempt: { id: attemptId, puzzleId, eligible: eligible?.eligible === 1, state },
    puzzle: { width, height }
  });
};
