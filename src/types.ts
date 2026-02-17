export type User = { id: string; username: string; isAdmin: boolean };
export type Toast = { kind: "ok" | "bad" | "info"; msg: string };

export type Puzzle = {
  id: string;
  title: string;
  width: number;
  height: number;
  rowClues: number[][];
  colClues: number[][];
};

// 0 unknown, 1 filled, 2 X
export type CellState = 0 | 1 | 2;

export type Attempt = {
  id: string;
  puzzleId: string;
  eligible: boolean;
  completed: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  state: CellState[];
};

export type LeaderboardEntry = {
  attemptId: string;
  puzzleId: string;
  durationMs: number;
  finishedAt: string;
  username: string;
  width: number;
  height: number;
  kdePath?: string;
};

export type ReplayMove = { seq: number; atMs: number; idx: number; state: CellState };
