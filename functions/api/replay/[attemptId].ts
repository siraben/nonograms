import type { Env } from "../../lib/auth";
import { getSession } from "../../lib/auth";
import { err, json } from "../../lib/http";
import { puzzleTitle } from "../../lib/puzzle";

export const onRequestGet: PagesFunction<Env> = async ({ env, request, params }) => {
  const attemptId = String(params.attemptId || "");
  const a = await env.DB.prepare(
    `SELECT a.id as attemptId, a.puzzle_id as puzzleId, a.user_id as userId,
            a.started_at as startedAt, a.finished_at as finishedAt, a.duration_ms as durationMs,
            a.shared as shared,
            u.username as username,
            p.width as width, p.height as height, p.row_clues_json as rowCluesJson, p.col_clues_json as colCluesJson
     FROM attempts a
     JOIN users u ON u.id = a.user_id
     JOIN puzzles p ON p.id = a.puzzle_id
     WHERE a.id = ? AND a.completed = 1`
  )
    .bind(attemptId)
    .first<{
      attemptId: string;
      puzzleId: string;
      userId: string;
      startedAt: string | null;
      finishedAt: string | null;
      durationMs: number | null;
      shared: number;
      username: string;
      width: number;
      height: number;
      rowCluesJson: string;
      colCluesJson: string;
    }>();

  if (!a) return err(404, "replay not found");

  // Access control: owner or logged-in user always allowed; unauthenticated only if shared
  const authed = await getSession(env, request);
  const isOwner = authed?.userId === a.userId;
  if (!authed && !a.shared) return err(404, "replay not found");

  const moves = await env.DB.prepare(
    "SELECT seq, at_ms as atMs, idx, state FROM attempt_moves WHERE attempt_id = ? ORDER BY seq ASC"
  )
    .bind(attemptId)
    .all<{ seq: number; atMs: number; idx: number; state: number }>();

  // Mark that this user has viewed a replay for this puzzle (their times won't count for the leaderboard).
  if (authed && !isOwner) {
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT OR REPLACE INTO replay_views (user_id, puzzle_id, viewed_at) VALUES (?, ?, ?)")
      .bind(authed.userId, a.puzzleId, now)
      .run();
  }

  return json({
    attempt: {
      id: a.attemptId,
      puzzleId: a.puzzleId,
      username: a.username,
      startedAt: a.startedAt,
      finishedAt: a.finishedAt,
      durationMs: a.durationMs,
      shared: !!a.shared,
    },
    puzzle: {
      id: a.puzzleId,
      title: puzzleTitle(a.width, a.height, a.puzzleId),
      width: a.width,
      height: a.height,
      rowClues: JSON.parse(a.rowCluesJson),
      colClues: JSON.parse(a.colCluesJson)
    },
    moves: moves.results
  });
};
