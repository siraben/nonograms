/** Materialize grid state using the same server-assigned order exposed by replays. */
export async function materializeState(
  db: D1Database,
  attemptId: string,
  gridSize: number
): Promise<number[]> {
  const rows = await db
    .prepare(
      "SELECT idx, state FROM attempt_moves WHERE attempt_id = ? ORDER BY seq ASC, id ASC"
    )
    .bind(attemptId)
    .all<{ idx: number; state: number }>();
  const state = new Array(gridSize).fill(0);
  for (const r of rows.results) state[r.idx] = r.state;
  return state;
}
