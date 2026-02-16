export type LeaderboardRow = {
  attemptId: string;
  puzzleId: string;
  durationMs: number;
  finishedAt: string;
  username: string;
  width: number;
  height: number;
};

export function periodCutoff(period: string | null): string | null {
  const now = new Date();
  switch (period) {
    case "day":
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    case "week": {
      const daysSinceMonday = (now.getUTCDay() + 6) % 7;
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday)).toISOString();
    }
    case "month":
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    default: return null;
  }
}

export function queryLeaderboard(db: D1Database, size: number | null, cutoff: string | null, limit: number) {
  return db.prepare(
    `SELECT a.id as attemptId,
            a.puzzle_id as puzzleId,
            a.duration_ms as durationMs,
            a.finished_at as finishedAt,
            u.username as username,
            p.width as width,
            p.height as height
     FROM attempts a
     JOIN users u ON u.id = a.user_id
     JOIN puzzles p ON p.id = a.puzzle_id
     WHERE a.completed = 1 AND a.eligible = 1 AND a.duration_ms IS NOT NULL
       AND (?1 IS NULL OR (p.width = ?1 AND p.height = ?1))
       AND (?2 IS NULL OR a.finished_at >= ?2)
     ORDER BY a.duration_ms ASC
     LIMIT ?3`
  ).bind(size, cutoff, limit).all<LeaderboardRow>();
}
