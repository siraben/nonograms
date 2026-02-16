import type { Env } from "../../../lib/auth";
import { requireUser } from "../../../lib/auth";
import { err, json } from "../../../lib/http";
import { puzzleTitle } from "../../../lib/puzzle";

export const onRequestPost: PagesFunction<Env> = async ({ env, request, params }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;

  const attemptId = String(params.id || "");

  const a = await env.DB.prepare(
    `SELECT a.id, a.puzzle_id as puzzleId, a.started_at as startedAt, a.completed as completed,
            a.eligible as eligible, a.current_state_json as stateJson,
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
  if (a.startedAt) return err(409, "attempt already started");

  const now = new Date().toISOString();
  const upd = await env.DB.prepare("UPDATE attempts SET started_at = ? WHERE id = ? AND started_at IS NULL")
    .bind(now, attemptId)
    .run();
  if ((upd.meta?.changes || 0) !== 1) return err(409, "attempt already started");

  return json({
    startedAt: now,
    puzzle: {
      id: a.puzzleId,
      title: puzzleTitle(a.width, a.height, a.puzzleId),
      width: a.width,
      height: a.height,
      rowClues: JSON.parse(a.rowCluesJson),
      colClues: JSON.parse(a.colCluesJson)
    }
  });
};
