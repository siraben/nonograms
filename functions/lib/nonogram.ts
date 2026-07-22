export type Clues = { rowClues: number[][]; colClues: number[][] };

function cluesForLine(bits: number[]): number[] {
  const out: number[] = [];
  let run = 0;
  for (const b of bits) {
    if (b === 1) run++;
    else if (run) {
      out.push(run);
      run = 0;
    }
  }
  if (run) out.push(run);
  return out.length ? out : [0];
}

export function computeClues(solutionBits: Uint8Array, width: number, height: number): Clues {
  const rowClues: number[][] = [];
  const colClues: number[][] = [];

  for (let r = 0; r < height; r++) {
    const line: number[] = [];
    for (let c = 0; c < width; c++) line.push(solutionBits[r * width + c]);
    rowClues.push(cluesForLine(line));
  }

  for (let c = 0; c < width; c++) {
    const line: number[] = [];
    for (let r = 0; r < height; r++) line.push(solutionBits[r * width + c]);
    colClues.push(cluesForLine(line));
  }

  return { rowClues, colClues };
}

// Validate by checking the player's state against the puzzle clues.
// Any state that produces the correct clues is a valid solution.
export function validateStateByClues(
  state: number[], width: number, height: number,
  rowClues: number[][], colClues: number[][]
): { solved: boolean; wrongRows: number; wrongCols: number } {
  let wrongRows = 0;
  let wrongCols = 0;
  for (let r = 0; r < height; r++) {
    const line: number[] = [];
    for (let c = 0; c < width; c++) line.push(state[r * width + c] === 1 ? 1 : 0);
    const got = cluesForLine(line);
    const want = rowClues[r];
    if (got.length !== want.length || got.some((v, i) => v !== want[i])) wrongRows++;
  }
  for (let c = 0; c < width; c++) {
    const line: number[] = [];
    for (let r = 0; r < height; r++) line.push(state[r * width + c] === 1 ? 1 : 0);
    const got = cluesForLine(line);
    const want = colClues[c];
    if (got.length !== want.length || got.some((v, i) => v !== want[i])) wrongCols++;
  }
  return { solved: wrongRows === 0 && wrongCols === 0, wrongRows, wrongCols };
}

function linePatterns(length: number, clues: number[]): number[] {
  const runs = clues.length === 1 && clues[0] === 0 ? [] : clues;
  if (runs.length === 0) return [0];

  const out: number[] = [];
  const place = (runIndex: number, start: number, mask: number) => {
    const remainingRuns = runs.slice(runIndex);
    const remainingLength = remainingRuns.reduce((sum, run) => sum + run, 0) + remainingRuns.length - 1;
    const maxStart = length - remainingLength;
    const run = runs[runIndex];
    for (let pos = start; pos <= maxStart; pos++) {
      let nextMask = mask;
      for (let offset = 0; offset < run; offset++) nextMask |= 1 << (pos + offset);
      if (runIndex === runs.length - 1) out.push(nextMask);
      else place(runIndex + 1, pos + run + 1, nextMask);
    }
  };
  place(0, 0, 0);
  return out;
}

type SolverState = { rows: number[][]; cols: number[][] };

function propagate(state: SolverState, width: number, height: number): boolean {
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < height; r++) {
      const options = state.rows[r];
      if (options.length === 0) return false;
      let alwaysFilled = options[0];
      let possiblyFilled = 0;
      for (const option of options) {
        alwaysFilled &= option;
        possiblyFilled |= option;
      }
      for (let c = 0; c < width; c++) {
        const cell = 1 << c;
        if ((alwaysFilled & cell) === 0 && (possiblyFilled & cell) !== 0) continue;
        const requireFilled = (alwaysFilled & cell) !== 0;
        const before = state.cols[c];
        const after = before.filter((option) => ((option & (1 << r)) !== 0) === requireFilled);
        if (after.length === 0) return false;
        if (after.length !== before.length) {
          state.cols[c] = after;
          changed = true;
        }
      }
    }

    for (let c = 0; c < width; c++) {
      const options = state.cols[c];
      if (options.length === 0) return false;
      let alwaysFilled = options[0];
      let possiblyFilled = 0;
      for (const option of options) {
        alwaysFilled &= option;
        possiblyFilled |= option;
      }
      for (let r = 0; r < height; r++) {
        const cell = 1 << r;
        if ((alwaysFilled & cell) === 0 && (possiblyFilled & cell) !== 0) continue;
        const requireFilled = (alwaysFilled & cell) !== 0;
        const before = state.rows[r];
        const after = before.filter((option) => ((option & (1 << c)) !== 0) === requireFilled);
        if (after.length === 0) return false;
        if (after.length !== before.length) {
          state.rows[r] = after;
          changed = true;
        }
      }
    }
  }
  return true;
}

/** Count solutions up to `limit`; grids are capped at 20x20 by the application. */
export function countSolutions(
  width: number,
  height: number,
  rowClues: number[][],
  colClues: number[][],
  limit = 2,
): number {
  const initial: SolverState = {
    rows: rowClues.map((clues) => linePatterns(width, clues)),
    cols: colClues.map((clues) => linePatterns(height, clues)),
  };

  const search = (state: SolverState, remaining: number): number => {
    if (!propagate(state, width, height)) return 0;

    let branchKind: "row" | "col" | null = null;
    let branchIndex = -1;
    let branchSize = Number.POSITIVE_INFINITY;
    for (let r = 0; r < height; r++) {
      const size = state.rows[r].length;
      if (size > 1 && size < branchSize) {
        branchKind = "row";
        branchIndex = r;
        branchSize = size;
      }
    }
    for (let c = 0; c < width; c++) {
      const size = state.cols[c].length;
      if (size > 1 && size < branchSize) {
        branchKind = "col";
        branchIndex = c;
        branchSize = size;
      }
    }
    if (branchKind === null) return 1;

    const options = branchKind === "row" ? state.rows[branchIndex] : state.cols[branchIndex];
    let total = 0;
    for (const option of options) {
      const next: SolverState = {
        rows: state.rows.slice(),
        cols: state.cols.slice(),
      };
      if (branchKind === "row") next.rows[branchIndex] = [option];
      else next.cols[branchIndex] = [option];
      total += search(next, remaining - total);
      if (total >= remaining) return remaining;
    }
    return total;
  };

  return search(initial, Math.max(1, limit));
}
