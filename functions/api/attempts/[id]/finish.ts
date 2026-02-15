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
    await env.DB.prepare("UPDATE attempts SET current_state_json = ? WHERE id = ?")
      .bind(JSON.stringify(state), attemptId)
      .run();
    return json({ solved: false, wrongRows: v.wrongRows, wrongCols: v.wrongCols });
  }

  const viewed = await env.DB.prepare("SELECT 1 FROM replay_views WHERE user_id = ? AND puzzle_id = ?")
    .bind(authed.userId, a.puzzleId)
    .first();
  const eligible = viewed ? 0 : a.eligible;

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE attempts SET current_state_json = ?, completed = 1, finished_at = ?, duration_ms = ?, eligible = ? WHERE id = ?"
    ).bind(
      JSON.stringify(state),
      now.toISOString(),
      durationMs,
      eligible,
      attemptId
    )
  ]);

  return json({ solved: true, durationMs, eligible: eligible === 1 });
};
