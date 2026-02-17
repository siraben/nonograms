import type { Env } from "../../lib/auth";
import { requireUser } from "../../lib/auth";
import { json } from "../../lib/http";
import { computeKdePath } from "../../../lib/kde";

const PAGE_SIZE = 10;

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;

  const url = new URL(request.url);
  const page = Math.max(0, parseInt(url.searchParams.get("page") || "0", 10) || 0);
  const hideAbandoned = url.searchParams.get("hideAbandoned") === "1";

  const whereClause = hideAbandoned
    ? "WHERE a.user_id = ? AND NOT (a.completed = 1 AND a.finished_at IS NULL)"
    : "WHERE a.user_id = ?";

  const rows = await env.DB.prepare(
    `SELECT a.id AS attemptId, a.puzzle_id AS puzzleId, a.created_at AS createdAt,
            a.started_at AS startedAt, a.finished_at AS finishedAt,
            a.duration_ms AS durationMs, a.completed, a.eligible,
            p.width, p.height
     FROM attempts a
     JOIN puzzles p ON p.id = a.puzzle_id
     ${whereClause}
     ORDER BY a.created_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(authed.userId, PAGE_SIZE + 1, page * PAGE_SIZE)
    .all<{
      attemptId: string;
      puzzleId: string;
      createdAt: string;
      startedAt: string | null;
      finishedAt: string | null;
      durationMs: number | null;
      completed: number;
      eligible: number;
      width: number;
      height: number;
    }>();

  const hasMore = rows.results.length > PAGE_SIZE;
  const items = rows.results.slice(0, PAGE_SIZE);

  const completedIds = items.filter((r) => r.completed && r.finishedAt && r.durationMs).map((r) => r.attemptId);

  let movesByAttempt = new Map<string, number[]>();
  if (completedIds.length > 0) {
    const placeholders = completedIds.map(() => "?").join(",");
    const moves = await env.DB.prepare(
      `SELECT attempt_id, at_ms FROM attempt_moves WHERE attempt_id IN (${placeholders}) ORDER BY at_ms`
    ).bind(...completedIds).all<{ attempt_id: string; at_ms: number }>();
    for (const m of moves.results) {
      let arr = movesByAttempt.get(m.attempt_id);
      if (!arr) { arr = []; movesByAttempt.set(m.attempt_id, arr); }
      arr.push(m.at_ms);
    }
  }

  const games = items.map((r) => {
    let status: "in_progress" | "completed" | "abandoned";
    if (r.completed && r.finishedAt) {
      status = "completed";
    } else if (r.completed && !r.finishedAt) {
      status = "abandoned";
    } else {
      status = "in_progress";
    }
    const atMs = movesByAttempt.get(r.attemptId);
    const kdePath = atMs && atMs.length >= 2 && r.durationMs
      ? computeKdePath(atMs, r.durationMs) : undefined;
    return {
      attemptId: r.attemptId,
      puzzleId: r.puzzleId,
      width: r.width,
      height: r.height,
      status,
      durationMs: r.durationMs,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
      kdePath,
    };
  });

  return json({ games, hasMore, page });
};
