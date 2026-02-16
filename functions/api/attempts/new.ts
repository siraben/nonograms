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

  // Goobix-like generator: 2-state Markov chain to create runs/clustering.
  //
  // Translated from their JS (v[x][y]) into our row-major `bits[r*width+c]`:
  // - iterate columns outer, rows inner
  // - `last` tracks previous cell in the column (above)
  // - optional "neighbor influence" for tall puzzles (not used by 5x5/10x10)
  function fillGoobix(bits: Uint8Array) {
    for (let c = 0; c < width; c++) {
      let last = 0;
      for (let r = 0; r < height; r++) {
        let prob = last === 0 ? 0.47 : 0.7;
        if (c > 0 && height > 20) {
          const left = bits[r * width + (c - 1)];
          if (left === 1) prob = 0.7;
        }
        if (rng.next01() < prob) {
          bits[r * width + c] = 1;
          last = 1;
        } else {
          bits[r * width + c] = 0;
          last = 0;
        }
      }
    }
  }

  // Keep regenerating until it's not trivial (density bounds).
  for (let tries = 0; tries < 50; tries++) {
    const bits = new Uint8Array(total);
    fillGoobix(bits);

    let ones = 0;
    for (let i = 0; i < bits.length; i++) ones += bits[i];
    if (ones < minFilled || ones > maxFilled) continue;

    const { rowClues, colClues } = computeClues(bits, width, height);
    const sol = Array.from(bits, (b) => (b ? "1" : "0")).join("");
    return { width, height, seed, solution: sol, rowClues, colClues };
  }

  // If we keep failing density bounds, still return a Goobix-style puzzle.
  // The goal is to avoid a hard-coded deterministic pattern fallback.
  const bits = new Uint8Array(total);
  fillGoobix(bits);
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

  return json({
    attempt: { id: attemptId, puzzleId, eligible: eligible === 1, state },
    puzzle: { width: puzzleRow.width, height: puzzleRow.height }
  });
};
