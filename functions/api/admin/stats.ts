import type { Env } from "../../lib/auth";
import { requireUser } from "../../lib/auth";
import { err, json } from "../../lib/http";

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;
  if (!authed.isAdmin) return err(403, "admin only");

  const now = new Date().toISOString();

  const [
    usersCount,
    puzzlesCount,
    completedCount,
    inProgressCount,
    activeSessionsCount,
    recentSignups,
    recentCompletions,
  ] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) as c FROM users").first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM puzzles").first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM attempts WHERE completed = 1 AND finished_at IS NOT NULL").first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM attempts WHERE started_at IS NOT NULL AND completed = 0").first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM sessions WHERE expires_at > ?").bind(now).first<{ c: number }>(),
    env.DB.prepare(
      "SELECT id, username, created_at as createdAt FROM users ORDER BY created_at DESC LIMIT 20"
    ).all<{ id: string; username: string; createdAt: string }>(),
    env.DB.prepare(
      `SELECT a.id as attemptId, u.username, a.duration_ms as durationMs, a.finished_at as finishedAt,
              p.width, p.height
       FROM attempts a
       JOIN users u ON u.id = a.user_id
       JOIN puzzles p ON p.id = a.puzzle_id
       WHERE a.completed = 1 AND a.finished_at IS NOT NULL
       ORDER BY a.finished_at DESC
       LIMIT 20`
    ).all<{ attemptId: string; username: string; durationMs: number; finishedAt: string; width: number; height: number }>(),
  ]);

  return json({
    totalUsers: usersCount?.c ?? 0,
    totalPuzzles: puzzlesCount?.c ?? 0,
    totalCompleted: completedCount?.c ?? 0,
    inProgress: inProgressCount?.c ?? 0,
    activeSessions: activeSessionsCount?.c ?? 0,
    recentSignups: recentSignups.results,
    recentCompletions: recentCompletions.results,
  });
};
