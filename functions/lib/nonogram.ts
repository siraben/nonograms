export type Clues = { rowClues: number[][]; colClues: number[][] };

export function parseSolution(sol: string, width: number, height: number): Uint8Array {
  const want = width * height;
  if (sol.length !== want) throw new Error("bad solution length");
  const out = new Uint8Array(want);
  for (let i = 0; i < want; i++) {
    const ch = sol.charCodeAt(i);
    if (ch === 48) out[i] = 0;
    else if (ch === 49) out[i] = 1;
    else throw new Error("bad solution encoding");
  }
  return out;
}

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

// state: 0 unknown, 1 filled, 2 x. We only treat "filled" as filled.
export function validateState(solutionBits: Uint8Array, state: number[]): { solved: boolean; wrongFilled: number; missingFilled: number } {
  let wrongFilled = 0;
  let missingFilled = 0;
  const n = solutionBits.length;
  for (let i = 0; i < n; i++) {
    const filled = state[i] === 1;
    const shouldFill = solutionBits[i] === 1;
    if (filled && !shouldFill) wrongFilled++;
    if (!filled && shouldFill) missingFilled++;
  }
  return { solved: wrongFilled === 0 && missingFilled === 0, wrongFilled, missingFilled };
}

