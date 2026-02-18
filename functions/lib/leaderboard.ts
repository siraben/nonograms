import { computeAndCacheKdePaths } from "./kde-cache";

export type LeaderboardRow = {
  attemptId: string;
  puzzleId: string;
  durationMs: number;
  finishedAt: string;
  username: string;
  width: number;
  height: number;
  kdePath?: string;
};

type LeaderboardDbRow = Omit<LeaderboardRow, "kdePath"> & {
  kdePath: string | null;
};

/** Return midnight America/New_York as a UTC Date. */
function etMidnight(year: number, month: number, day: number): Date {
  const pad = (n: number) => String(n).padStart(2, "0");
  // Try EST (UTC-5) then EDT (UTC-4); check which gives midnight ET on the right date
  for (const offset of [5, 4]) {
    const d = new Date(Date.UTC(year, month, day, offset));
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", hour12: false,
    }).formatToParts(d);
    const h = parseInt(parts.find(p => p.type === "hour")!.value) % 24;
    const dd = parseInt(parts.find(p => p.type === "day")!.value);
    if (h === 0 && dd === day) return d;
  }
  return new Date(Date.UTC(year, month, day, 5)); // fallback EST
}

/** Get "now" as an ET local date. */
function etNow(): { year: number; month: number; day: number; dayOfWeek: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "numeric", day: "numeric",
    weekday: "short",
  }).formatToParts(new Date());
  const val = (type: string) => parseInt(parts.find(p => p.type === type)!.value);
  const wday = parts.find(p => p.type === "weekday")!.value;
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { year: val("year"), month: val("month") - 1, day: val("day"), dayOfWeek: dayMap[wday] ?? 0 };
}

export function periodCutoff(period: string | null): string | null {
  const { year, month, day, dayOfWeek } = etNow();
  switch (period) {
    case "day":
      return etMidnight(year, month, day).toISOString();
    case "week": {
      const daysSinceMonday = (dayOfWeek + 6) % 7;
      return etMidnight(year, month, day - daysSinceMonday).toISOString();
    }
    case "month":
      return etMidnight(year, month, 1).toISOString();
    default: return null;
  }
}

export async function queryLeaderboard(db: D1Database, size: number | null, cutoff: string | null, limit: number) {
  const rows = await db.prepare(
    `SELECT a.id as attemptId,
            a.puzzle_id as puzzleId,
            a.duration_ms as durationMs,
            a.finished_at as finishedAt,
            a.kde_path as kdePath,
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
  ).bind(size, cutoff, limit).all<LeaderboardDbRow>();

  if (rows.results.length === 0) return rows;

  await computeAndCacheKdePaths(db, rows.results);

  return {
    ...rows,
    results: rows.results.map((r) => ({
      ...r,
      kdePath: r.kdePath || undefined,
    })),
  };
}
