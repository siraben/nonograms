import { computeClues } from "./nonogram";
import { XorShift32 } from "./rng";

export function puzzleTitle(width: number, height: number, id: string): string {
  return `${width}x${height} ${id.slice(0, 8)}`;
}

export function genPuzzle(
  width: number,
  height: number,
  seed: number,
): {
  width: number;
  height: number;
  seed: number;
  solution: string;
  rowClues: number[][];
  colClues: number[][];
} {
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
