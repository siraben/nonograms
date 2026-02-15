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

