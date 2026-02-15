import type { Env } from "../../lib/auth";
import { requireUser } from "../../lib/auth";
import { err, json, readJson } from "../../lib/http";
import { computeClues } from "../../lib/nonogram";
import { randomU32, XorShift32 } from "../../lib/rng";

type Body = { puzzleId?: string; size?: number };

const ALLOWED_SIZES = [5, 10] as const;

function genPuzzle(width: number, height: number, seed: number): { width: number; height: number; seed: number; solution: string; rowClues: number[][]; colClues: number[][] } {
  const total = width * height;
  const minFilled = Math.floor(total * 0.18);
  const maxFilled = Math.floor(total * 0.82);
  const rng = new XorShift32(seed);

  // Keep regenerating until it's not trivial.
  for (let tries = 0; tries < 50; tries++) {
    const bits = new Uint8Array(total);
    let ones = 0;
    for (let i = 0; i < bits.length; i++) {
      const v = rng.next01() < 0.42 ? 1 : 0;
      bits[i] = v;
      ones += v;
    }
    if (ones < minFilled || ones > maxFilled) continue;

    const { rowClues, colClues } = computeClues(bits, width, height);
    const sol = Array.from(bits, (b) => (b ? "1" : "0")).join("");
    return { width, height, seed, solution: sol, rowClues, colClues };
  }

  // Fallback: deterministic checkerboard-ish.
  const bits = new Uint8Array(total);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) bits[r * width + c] = (r + c) % 3 === 0 ? 1 : 0;
  const { rowClues, colClues } = computeClues(bits, width, height);
  const sol = Array.from(bits, (b) => (b ? "1" : "0")).join("");
  return { width, height, seed, solution: sol, rowClues, colClues };
}

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;

  let body: Body = {};
  try {
    body = await readJson<Body>(request);
  } catch {
    // ok: default
  }

  const now = new Date().toISOString();
  let puzzleId = body.puzzleId;

  const size = body.size && ALLOWED_SIZES.includes(body.size as any) ? body.size : 10;

  if (puzzleId) {
    const p = await env.DB.prepare("SELECT id FROM puzzles WHERE id = ?").bind(puzzleId).first();
    if (!p) return err(404, "puzzle not found");
  } else {
    const seed = randomU32();
    const p = genPuzzle(size, size, seed);
    puzzleId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO puzzles (id, width, height, seed, solution, row_clues_json, col_clues_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(puzzleId, p.width, p.height, p.seed, p.solution, JSON.stringify(p.rowClues), JSON.stringify(p.colClues), now)
      .run();
  }

  const viewed = await env.DB.prepare("SELECT 1 FROM replay_views WHERE user_id = ? AND puzzle_id = ?")
    .bind(authed.userId, puzzleId)
    .first();
  const eligible = viewed ? 0 : 1;

  const puzzleRow = await env.DB.prepare("SELECT width, height FROM puzzles WHERE id = ?").bind(puzzleId).first<{ width: number; height: number }>();
  if (!puzzleRow) return err(500, "puzzle missing");

  const attemptId = crypto.randomUUID();
  const state = Array.from({ length: puzzleRow.width * puzzleRow.height }, () => 0);
  await env.DB.prepare(
    "INSERT INTO attempts (id, puzzle_id, user_id, created_at, eligible, completed, current_state_json) VALUES (?, ?, ?, ?, ?, 0, ?)"
  )
    .bind(attemptId, puzzleId, authed.userId, now, eligible, JSON.stringify(state))
    .run();

  const puzzle = await env.DB.prepare(
    "SELECT id, width, height, row_clues_json as rowCluesJson, col_clues_json as colCluesJson FROM puzzles WHERE id = ?"
  )
    .bind(puzzleId)
    .first<{ id: string; width: number; height: number; rowCluesJson: string; colCluesJson: string }>();
  if (!puzzle) return err(500, "puzzle missing");

  return json({
    attempt: { id: attemptId, puzzleId, eligible: eligible === 1, state },
    puzzle: {
      id: puzzle.id,
      title: `${puzzle.width}x${puzzle.height} ${puzzle.id.slice(0, 8)}`,
      width: puzzle.width,
      height: puzzle.height,
      rowClues: JSON.parse(puzzle.rowCluesJson),
      colClues: JSON.parse(puzzle.colCluesJson)
    }
  });
};
