import { computeKdePath } from "../../lib/kde";

type KdeCandidate = {
  attemptId: string;
  durationMs: number | null;
  kdePath?: string | null;
};

/**
 * Lazily compute KDE paths from move history and persist them into attempts.kde_path.
 * Rows with kdePath already set are skipped.
 */
export async function computeAndCacheKdePaths(db: D1Database, attempts: KdeCandidate[]): Promise<void> {
  const missing = attempts.filter((a) => a.kdePath == null && typeof a.durationMs === "number" && a.durationMs > 0);
  if (missing.length === 0) return;

  const ids = missing.map((a) => a.attemptId);
  const placeholders = ids.map(() => "?").join(",");

  const moves = await db
    .prepare(
      `SELECT attempt_id as attemptId, at_ms as atMs
       FROM attempt_moves
       WHERE attempt_id IN (${placeholders})
       ORDER BY attempt_id ASC, at_ms ASC`
    )
    .bind(...ids)
    .all<{ attemptId: string; atMs: number }>();

  const byAttempt = new Map<string, number[]>();
  for (const m of moves.results) {
    let arr = byAttempt.get(m.attemptId);
    if (!arr) {
      arr = [];
      byAttempt.set(m.attemptId, arr);
    }
    arr.push(m.atMs);
  }

  const stmts: D1PreparedStatement[] = [];
  for (const a of missing) {
    const atMs = byAttempt.get(a.attemptId) || [];
    const path = atMs.length >= 2 ? computeKdePath(atMs, a.durationMs as number) : "";
    a.kdePath = path;
    stmts.push(
      db.prepare("UPDATE attempts SET kde_path = ? WHERE id = ? AND kde_path IS NULL").bind(path, a.attemptId)
    );
  }

  if (stmts.length > 0) {
    await db.batch(stmts);
  }
}
