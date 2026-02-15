import type { Env } from "../../lib/auth";
import { requireUser } from "../../lib/auth";
import { err, json } from "../../lib/http";

export const onRequestGet: PagesFunction<Env> = async ({ env, request, params }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;

  const id = String(params.id || "");
  const a = await env.DB.prepare(
    `SELECT a.id, a.puzzle_id as puzzleId, a.eligible as eligible, a.completed as completed,
            a.started_at as startedAt, a.finished_at as finishedAt, a.duration_ms as durationMs,
            a.current_state_json as stateJson,
            p.width as width, p.height as height, p.row_clues_json as rowCluesJson, p.col_clues_json as colCluesJson
     FROM attempts a
     JOIN puzzles p ON p.id = a.puzzle_id
     WHERE a.id = ? AND a.user_id = ?`
  )
    .bind(id, authed.userId)
    .first<{
      id: string;
      puzzleId: string;
      eligible: number;
      completed: number;
      startedAt: string | null;
      finishedAt: string | null;
      durationMs: number | null;
      stateJson: string;
      width: number;
      height: number;
      rowCluesJson: string;
      colCluesJson: string;
    }>();

  if (!a) return err(404, "attempt not found");

  const state = JSON.parse(a.stateJson);
  return json({
    attempt: {
      id: a.id,
      puzzleId: a.puzzleId,
      eligible: a.eligible === 1,
      completed: a.completed === 1,
      startedAt: a.startedAt,
      finishedAt: a.finishedAt,
      durationMs: a.durationMs,
      state
    },
    puzzle: {
      id: a.puzzleId,
      title: `${a.width}x${a.height} ${a.puzzleId.slice(0, 8)}`,
      width: a.width,
      height: a.height,
      rowClues: JSON.parse(a.rowCluesJson),
      colClues: JSON.parse(a.colCluesJson)
    }
  });
};

