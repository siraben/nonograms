import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { CellState, Puzzle } from "./types";

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function lineClue(bits: number[]): number[] {
  const out: number[] = [];
  let run = 0;
  for (const b of bits) {
    if (b === 1) run++;
    else if (run > 0) { out.push(run); run = 0; }
  }
  if (run > 0) out.push(run);
  return out.length ? out : [0];
}

function cluesMatch(
  state: CellState[], w: number, h: number,
  rowClues: number[][], colClues: number[][],
): boolean {
  for (let r = 0; r < h; r++) {
    const bits = [];
    for (let c = 0; c < w; c++) bits.push(state[r * w + c] === 1 ? 1 : 0);
    const got = lineClue(bits);
    const want = rowClues[r];
    if (got.length !== want.length || got.some((v, i) => v !== want[i])) return false;
  }
  for (let c = 0; c < w; c++) {
    const bits = [];
    for (let r = 0; r < h; r++) bits.push(state[r * w + c] === 1 ? 1 : 0);
    const got = lineClue(bits);
    const want = colClues[c];
    if (got.length !== want.length || got.some((v, i) => v !== want[i])) return false;
  }
  return true;
}

export default function NonogramPlayer(props: {
  attemptId: string;
  eligible: boolean;
  puzzle: Puzzle;
  initialState: CellState[];
  startedAt?: string | null;
  readonly?: boolean;
  onToast: (t: { kind: "ok" | "bad"; msg: string } | null) => void;
}) {
  const { puzzle } = props;
  const [state, setState] = useState<CellState[]>(() => props.initialState);
  const [saving, setSaving] = useState(false);
  const [solved, setSolved] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const [hoverRow, setHoverRow] = useState(-1);
  const [hoverCol, setHoverCol] = useState(-1);
  const inFlight = useRef(0);
  const timerStart = useRef(0);
  const timerRef = useRef<number | null>(null);
  const dragging = useRef(false);
  const paintValue = useRef<CellState>(0);
  const lastTouchIdx = useRef(-1);
  const finishing = useRef(false);

  useEffect(() => {
    setState(props.initialState);
  }, [props.attemptId, props.initialState]);

  // Timer
  useEffect(() => {
    if (props.readonly || solved) return;
    if (props.startedAt) {
      const start = new Date(props.startedAt).getTime();
      timerStart.current = start;
      setTimerActive(true);
      setElapsed(Date.now() - start);
      timerRef.current = window.setInterval(() => {
        setElapsed(Date.now() - start);
      }, 200);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [props.startedAt, props.readonly]);

  // Global mouseup ends drag
  useEffect(() => {
    const handleUp = () => {
      dragging.current = false;
    };
    document.addEventListener("mouseup", handleUp);
    return () => document.removeEventListener("mouseup", handleUp);
  }, []);

  // Auto-finish: check clues after every state change
  useEffect(() => {
    if (solved || props.readonly || finishing.current) return;
    if (!state.some((s) => s === 1)) return;
    if (!cluesMatch(state, puzzle.width, puzzle.height, puzzle.rowClues, puzzle.colClues)) return;
    void finishAttempt(true);
  }, [state]);

  function startTimerIfNeeded() {
    if (timerActive || props.readonly || solved) return;
    const now = Date.now();
    timerStart.current = now;
    setTimerActive(true);
    timerRef.current = window.setInterval(() => {
      setElapsed(Date.now() - now);
    }, 200);
  }

  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimerActive(false);
  }

  // Goobix-style: 0 → 1 → 2 → 0
  function cycleState(cur: CellState): CellState {
    if (cur === 0) return 1;
    if (cur === 1) return 2;
    return 0;
  }

  function applyCell(idx: number, newState: CellState) {
    setState((prev) => {
      if (prev[idx] === newState) return prev;
      const next = prev.slice();
      next[idx] = newState;
      void postMove(idx, newState);
      return next;
    });
  }

  // Mousedown on a cell: cycle it and start drag-painting
  function onCellDown(idx: number) {
    if (props.readonly || solved) return;
    startTimerIfNeeded();
    dragging.current = true;
    setState((prev) => {
      const newVal = cycleState(prev[idx]);
      paintValue.current = newVal;
      const next = prev.slice();
      next[idx] = newVal;
      void postMove(idx, newVal);
      return next;
    });
  }

  // Mouse enters cell while dragging: paint with same value
  function onCellEnter(idx: number) {
    if (!dragging.current || props.readonly || solved) return;
    applyCell(idx, paintValue.current);
  }

  async function postMove(idx: number, st: CellState) {
    if (props.readonly) return;
    inFlight.current++;
    setSaving(true);
    try {
      await api(
        `/api/attempts/${encodeURIComponent(props.attemptId)}/move`,
        { method: "POST", json: { idx, state: st } }
      );
    } catch (err) {
      props.onToast({ kind: "bad", msg: (err as Error).message });
    } finally {
      inFlight.current--;
      if (inFlight.current <= 0) setSaving(false);
    }
  }

  async function finishAttempt(auto: boolean) {
    if (props.readonly || solved || finishing.current) return;
    finishing.current = true;
    if (!auto) props.onToast(null);
    try {
      const r = await api<{
        solved: boolean;
        durationMs?: number;
        eligible?: boolean;
        wrongFilled?: number;
        missingFilled?: number;
      }>(
        `/api/attempts/${encodeURIComponent(props.attemptId)}/finish`,
        { method: "POST", json: { state } }
      );
      if (r.solved) {
        stopTimer();
        setSolved(true);
        if (typeof r.durationMs === "number") setElapsed(r.durationMs);
        const t = typeof r.durationMs === "number" ? ` in ${(r.durationMs / 1000).toFixed(2)}s` : "";
        const el = r.eligible === false ? " (not eligible for leaderboard)" : "";
        props.onToast({ kind: "ok", msg: `Solved${t}${el}` });
      } else if (!auto) {
        props.onToast({
          kind: "bad",
          msg: `Not solved. Wrong: ${r.wrongFilled || 0}, Missing: ${r.missingFilled || 0}`,
        });
      }
    } catch (err) {
      if (!auto) props.onToast({ kind: "bad", msg: (err as Error).message });
    } finally {
      finishing.current = false;
    }
  }

  // Touch: find cell index from screen coordinates
  function getCellIdx(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const attr = el.getAttribute("data-idx") ?? el.parentElement?.getAttribute("data-idx");
    if (attr == null) return null;
    return parseInt(attr, 10);
  }

  function onTouchStart(e: React.TouchEvent) {
    if (props.readonly || solved) return;
    e.preventDefault();
    const touch = e.touches[0];
    const idx = getCellIdx(touch.clientX, touch.clientY);
    if (idx === null || idx < 0) return;
    startTimerIfNeeded();
    dragging.current = true;
    lastTouchIdx.current = idx;
    setState((prev) => {
      const newVal = cycleState(prev[idx]);
      paintValue.current = newVal;
      const next = prev.slice();
      next[idx] = newVal;
      void postMove(idx, newVal);
      return next;
    });
    setHoverRow(Math.floor(idx / puzzle.width));
    setHoverCol(idx % puzzle.width);
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!dragging.current || props.readonly || solved) return;
    e.preventDefault();
    const touch = e.touches[0];
    const idx = getCellIdx(touch.clientX, touch.clientY);
    if (idx === null || idx < 0 || idx === lastTouchIdx.current) return;
    lastTouchIdx.current = idx;
    applyCell(idx, paintValue.current);
    setHoverRow(Math.floor(idx / puzzle.width));
    setHoverCol(idx % puzzle.width);
  }

  function onTouchEnd(e: React.TouchEvent) {
    e.preventDefault();
    dragging.current = false;
    lastTouchIdx.current = -1;
    setHoverRow(-1);
    setHoverCol(-1);
  }

  const { gridTemplateColumns, cells } = useMemo(() => {
    const w = puzzle.width;
    const h = puzzle.height;

    const colDepth = Math.max(...puzzle.colClues.map((c) => c.length), 0);
    const rowDepth = Math.max(...puzzle.rowClues.map((c) => c.length), 0);

    const cols = rowDepth + w;
    const rows = colDepth + h;

    type Item =
      | { kind: "blank" }
      | { kind: "clue"; text: string; rmaj: boolean; cmaj: boolean; clueRow?: number; clueCol?: number }
      | { kind: "cell"; idx: number; row: number; col: number; rmaj: boolean; cmaj: boolean; state: CellState };

    const items: Item[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r < colDepth && c < rowDepth) {
          items.push({ kind: "blank" });
          continue;
        }
        if (r < colDepth && c >= rowDepth) {
          const col = c - rowDepth;
          const clue = puzzle.colClues[col];
          const clueIdx = r - (colDepth - clue.length);
          const text = clueIdx >= 0 ? String(clue[clueIdx]) : "";
          items.push({ kind: "clue", text, rmaj: false, cmaj: (col + 1) % 5 === 0, clueCol: col });
          continue;
        }
        if (r >= colDepth && c < rowDepth) {
          const row = r - colDepth;
          const clue = puzzle.rowClues[row];
          const clueIdx = c - (rowDepth - clue.length);
          const text = clueIdx >= 0 ? String(clue[clueIdx]) : "";
          items.push({ kind: "clue", text, rmaj: (row + 1) % 5 === 0, cmaj: false, clueRow: row });
          continue;
        }
        const row = r - colDepth;
        const col = c - rowDepth;
        const idx = row * w + col;
        items.push({
          kind: "cell",
          idx,
          row,
          col,
          rmaj: (row + 1) % 5 === 0,
          cmaj: (col + 1) % 5 === 0,
          state: state[idx],
        });
      }
    }

    return { gridTemplateColumns: `repeat(${cols}, 28px)`, cells: items };
  }, [puzzle, state]);

  return (
    <div>
      {!props.readonly && (
        <div className="timer">{fmtTime(elapsed)}</div>
      )}

      {!props.readonly && (
        <div className="game-status" style={{ textAlign: "center", marginBottom: 8 }}>
          {saving ? "saving..." : solved ? "solved!" : "\u00A0"}
        </div>
      )}

      {!props.eligible && !props.readonly && (
        <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>
          Not eligible for leaderboard (viewed replay).
        </div>
      )}

      <div className="nonogram-wrap">
        <div
          className="nonogram"
          style={{ gridTemplateColumns }}
          onMouseLeave={() => {
            setHoverRow(-1);
            setHoverCol(-1);
          }}
          onContextMenu={(e) => e.preventDefault()}
          onTouchStart={!props.readonly ? onTouchStart : undefined}
          onTouchMove={!props.readonly ? onTouchMove : undefined}
          onTouchEnd={!props.readonly ? onTouchEnd : undefined}
        >
          {cells.map((it, i) => {
            if (it.kind === "blank") return <div key={i} className="clue" />;
            if (it.kind === "clue") {
              const highlight =
                (it.clueRow !== undefined && it.clueRow === hoverRow) ||
                (it.clueCol !== undefined && it.clueCol === hoverCol);
              const cls =
                "clue" +
                (it.rmaj ? " rmaj" : "") +
                (it.cmaj ? " cmaj" : "") +
                (highlight ? " highlight" : "");
              return (
                <div key={i} className={cls}>
                  {it.text}
                </div>
              );
            }
            const cls =
              "cell" +
              (it.rmaj ? " rmaj" : "") +
              (it.cmaj ? " cmaj" : "") +
              (it.state === 1 ? " filled" : it.state === 2 ? " x" : "");
            return (
              <div
                key={i}
                className={cls}
                data-idx={it.idx}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onCellDown(it.idx);
                  setHoverRow(it.row);
                  setHoverCol(it.col);
                }}
                onMouseEnter={() => {
                  setHoverRow(it.row);
                  setHoverCol(it.col);
                  onCellEnter(it.idx);
                }}
              >
                {it.state === 2 ? "\u00d7" : ""}
              </div>
            );
          })}
        </div>
      </div>

      {!props.readonly && (
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button
            className="btn primary"
            disabled={saving || solved}
            onClick={() => void finishAttempt(false)}
            style={{ padding: "10px 24px", fontSize: 15 }}
          >
            {solved ? "Solved!" : "Check Solution"}
          </button>
        </div>
      )}
    </div>
  );
}
