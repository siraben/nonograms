import type { Env } from "../../../lib/auth";
import { requireUser } from "../../../lib/auth";
import { err, json } from "../../../lib/http";
import { validateStateByClues } from "../../../lib/nonogram";

export const onRequestPost: PagesFunction<Env> = async ({ env, request, params }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;

  const attemptId = String(params.id || "");

  const a = await env.DB.prepare(
    `SELECT a.id, a.puzzle_id as puzzleId, a.started_at as startedAt, a.completed as completed, a.eligible as eligible,
            a.current_state_json as stateJson,
            p.width as width, p.height as height,
            p.row_clues_json as rowCluesJson, p.col_clues_json as colCluesJson
     FROM attempts a
     JOIN puzzles p ON p.id = a.puzzle_id
     WHERE a.id = ? AND a.user_id = ?`
  )
    .bind(attemptId, authed.userId)
    .first<{
      id: string;
      puzzleId: string;
      startedAt: string | null;
      completed: number;
      eligible: number;
      stateJson: string;
      width: number;
      height: number;
      rowCluesJson: string;
      colCluesJson: string;
    }>();

  if (!a) return err(404, "attempt not found");
  if (a.completed === 1) return err(409, "attempt already finished");
  if (!a.startedAt) return err(409, "attempt not started");

  const width = a.width | 0;
  const height = a.height | 0;
  const n = width * height;

  // Always use server-stored state to prevent client-supplied solution bypass.
  const state: number[] = JSON.parse(a.stateJson);
  if (!Array.isArray(state) || state.length !== n) return err(400, "bad state");

  const rowClues: number[][] = JSON.parse(a.rowCluesJson);
  const colClues: number[][] = JSON.parse(a.colCluesJson);
  const v = validateStateByClues(state, width, height, rowClues, colClues);

  const now = new Date();
  const startedAt = new Date(a.startedAt!);
  const durationMs = Math.max(0, now.getTime() - startedAt.getTime());

  if (!v.solved) {
    await env.DB.prepare("UPDATE attempts SET current_state_json = ? WHERE id = ? AND completed = 0")
      .bind(JSON.stringify(state), attemptId)
      .run();
    return json({ solved: false, wrongRows: v.wrongRows, wrongCols: v.wrongCols });
  }

  // Compute eligibility atomically to avoid TOCTTOU race with concurrent replay views.
  const upd = await env.DB.prepare(
    `UPDATE attempts
     SET current_state_json = ?, completed = 1, finished_at = ?, duration_ms = ?,
         eligible = CASE WHEN eligible = 0 THEN 0
                         WHEN EXISTS(SELECT 1 FROM replay_views WHERE user_id = ? AND puzzle_id = ?)
                         THEN 0
                         WHEN EXISTS(SELECT 1 FROM attempts WHERE user_id = ? AND puzzle_id = ? AND id != ? AND started_at IS NOT NULL)
                         THEN 0 ELSE eligible END
     WHERE id = ? AND completed = 0`
  ).bind(
    JSON.stringify(state),
    now.toISOString(),
    durationMs,
    authed.userId,
    a.puzzleId,
    authed.userId,
    a.puzzleId,
    attemptId,
    attemptId
  ).run();

  if ((upd.meta?.changes || 0) !== 1) return err(409, "attempt already finished");

  // Read back the final eligible value set by the atomic UPDATE.
  const final = await env.DB.prepare("SELECT eligible, duration_ms as durationMs FROM attempts WHERE id = ?")
    .bind(attemptId).first<{ eligible: number; durationMs: number }>();

  return json({ solved: true, durationMs, eligible: final?.eligible === 1 });
};
