import type { Env } from "../../../lib/auth";
import { requireUser } from "../../../lib/auth";
import { err, json } from "../../../lib/http";
import { parseSolution, validateState } from "../../../lib/nonogram";

export const onRequestPost: PagesFunction<Env> = async ({ env, request, params }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;

  const attemptId = String(params.id || "");

  const a = await env.DB.prepare(
    `SELECT a.id, a.puzzle_id as puzzleId, a.started_at as startedAt, a.completed as completed, a.eligible as eligible,
            a.current_state_json as stateJson,
            p.solution as solution, p.width as width, p.height as height
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
      solution: string;
      width: number;
      height: number;
    }>();

  if (!a) return err(404, "attempt not found");
  if (a.completed === 1) return err(409, "attempt already finished");

  const width = a.width | 0;
  const height = a.height | 0;
  const n = width * height;

  // Always use server-stored state to prevent client-supplied solution bypass.
  const state: number[] = JSON.parse(a.stateJson);
  if (!Array.isArray(state) || state.length !== n) return err(400, "bad state");

  const sol = parseSolution(a.solution, width, height);
  const v = validateState(sol, state);

  const now = new Date();
  const startedAt = a.startedAt ? new Date(a.startedAt) : now;
  const durationMs = Math.max(0, now.getTime() - startedAt.getTime());

  if (!v.solved) {
    // Persist latest state anyway so resume works.
    await env.DB.prepare("UPDATE attempts SET current_state_json = ?, started_at = COALESCE(started_at, ?) WHERE id = ?")
      .bind(JSON.stringify(state), startedAt.toISOString(), attemptId)
      .run();
    return json({ solved: false, wrongFilled: v.wrongFilled, missingFilled: v.missingFilled });
  }

  const viewed = await env.DB.prepare("SELECT 1 FROM replay_views WHERE user_id = ? AND puzzle_id = ?")
    .bind(authed.userId, a.puzzleId)
    .first();
  const eligible = viewed ? 0 : a.eligible;

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE attempts SET current_state_json = ?, started_at = COALESCE(started_at, ?), completed = 1, finished_at = ?, duration_ms = ?, eligible = ? WHERE id = ?"
    ).bind(
      JSON.stringify(state),
      startedAt.toISOString(),
      now.toISOString(),
      durationMs,
      eligible,
      attemptId
    )
  ]);

  return json({ solved: true, durationMs, eligible: eligible === 1 });
};

