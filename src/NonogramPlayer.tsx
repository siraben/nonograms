import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { CellState, Puzzle, Toast } from "./types";
import { MAX_MOVES } from "../functions/lib/limits";

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

function countCorrect(
  state: CellState[], w: number, h: number,
  rowClues: number[][], colClues: number[][],
): { correctRows: number; correctCols: number; allCorrect: boolean } {
  let correctRows = 0;
  for (let r = 0; r < h; r++) {
    const bits = [];
    for (let c = 0; c < w; c++) bits.push(state[r * w + c] === 1 ? 1 : 0);
    const got = lineClue(bits);
    const want = rowClues[r];
    if (got.length === want.length && got.every((v, i) => v === want[i])) correctRows++;
  }
  let correctCols = 0;
  for (let c = 0; c < w; c++) {
    const bits = [];
    for (let r = 0; r < h; r++) bits.push(state[r * w + c] === 1 ? 1 : 0);
    const got = lineClue(bits);
    const want = colClues[c];
    if (got.length === want.length && got.every((v, i) => v === want[i])) correctCols++;
  }
  return { correctRows, correctCols, allCorrect: correctRows === h && correctCols === w };
}

export default function NonogramPlayer(props: {
  attemptId: string;
  eligible: boolean;
  puzzle: Puzzle;
  initialState: CellState[];
  startedAt?: string | null;
  readonly?: boolean;
  offline?: boolean;
  initialMoveCount?: number;
  onToast: (t: Toast | null) => void;
  onSolved?: () => void;
  onAbandoned?: () => void;
}) {
  const { puzzle } = props;
  const [state, setState] = useState<CellState[]>(() => props.initialState);
  const [saving, setSaving] = useState(false);
  const [solved, setSolved] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [hoverRow, setHoverRow] = useState(-1);
  const [hoverCol, setHoverCol] = useState(-1);
  const stateRef = useRef(state);
  stateRef.current = state;
  const inFlight = useRef(0);
  const pendingFlushes = useRef<Promise<unknown>[]>([]);
  const moveBuffer = useRef<{ idx: number; state: CellState; atMs: number }[]>([]);
  const flushTimer = useRef<number | null>(null);
  const startMs = useRef(0);
  const timerRef = useRef<number | null>(null);
  const dragging = useRef(false);
  const paintValue = useRef<CellState>(0);
  const lastTouchIdx = useRef(-1);
  const finishing = useRef(false);
  const autoFinishRetries = useRef(0);
  const moveCount = useRef(props.initialMoveCount ?? 0);
  const [moveLimited, setMoveLimited] = useState(false);

  useEffect(() => {
    setState(props.initialState);
    setSolved(false);
    setMoveLimited(false);
    finishing.current = false;
    autoFinishRetries.current = 0;
    moveCount.current = props.initialMoveCount ?? 0;
    moveBuffer.current = [];
    if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
  }, [props.attemptId, props.initialState]);

  // Timer — starts immediately since startedAt is set at attempt creation
  useEffect(() => {
    if (props.readonly || solved || !props.startedAt) return;
    const start = new Date(props.startedAt).getTime();
    startMs.current = start;
    setElapsed(Date.now() - start);
    timerRef.current = window.setInterval(() => {
      setElapsed(Date.now() - start);
    }, 200);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [props.startedAt, props.readonly, solved]);

  // Global mouseup ends drag
  useEffect(() => {
    const handleUp = () => {
      dragging.current = false;
    };
    document.addEventListener("mouseup", handleUp);
    return () => document.removeEventListener("mouseup", handleUp);
  }, []);

  // Flush buffered moves when tab becomes visible again (mobile browsers
  // throttle/kill timers in background tabs, so the 150ms flush may never fire).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && moveBuffer.current.length > 0) {
        flushMoves();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const progress = useMemo(() =>
    countCorrect(state, puzzle.width, puzzle.height, puzzle.rowClues, puzzle.colClues),
    [state, puzzle],
  );

  // Auto-finish: check clues after state settles (debounced to avoid
  // triggering on transient states while the user cycles a cell)
  useEffect(() => {
    if (solved || props.readonly || finishing.current) return;
    if (!state.some((s) => s === 1)) return;
    if (!progress.allCorrect) return;
    const id = window.setTimeout(() => {
      void finishAttempt(true);
    }, 300);
    return () => window.clearTimeout(id);
  }, [state, progress.allCorrect]);

  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
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
      return next;
    });
    queueMove(idx, newState);
  }

  // Mousedown on a cell: cycle it and start drag-painting
  function onCellDown(idx: number) {
    if (props.readonly || solved || moveLimited) return;
    dragging.current = true;
    const cur = stateRef.current[idx];
    const newVal = cycleState(cur);
    paintValue.current = newVal;
    setState((prev) => {
      const next = prev.slice();
      next[idx] = newVal;
      return next;
    });
    queueMove(idx, newVal);
  }

  // Mouse enters cell while dragging: paint with same value
  function onCellEnter(idx: number) {
    if (!dragging.current || props.readonly || solved || moveLimited) return;
    applyCell(idx, paintValue.current);
  }

  function flushMoves() {
    if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
    const all = moveBuffer.current;
    if (all.length === 0) return;
    // Server accepts at most 50 moves per request; keep the rest buffered.
    const batch = all.slice(0, 50);
    moveBuffer.current = all.slice(50);
    inFlight.current++;
    setSaving(true);
    const p = api<{ ok: boolean; abandoned?: boolean }>(
      `/api/attempts/${encodeURIComponent(props.attemptId)}/moves`,
      { method: "POST", json: { moves: batch } }
    ).then((r) => {
      if (r.abandoned) {
        setMoveLimited(true);
        moveBuffer.current = [];
        props.onAbandoned?.();
        return;
      }
      // If more moves remain, flush the next chunk immediately.
      if (moveBuffer.current.length > 0 && !flushTimer.current) {
        flushTimer.current = window.setTimeout(flushMoves, 0);
      }
    }).catch(() => {
      // Put failed moves back at the front so they retry before newer moves.
      moveBuffer.current = batch.concat(moveBuffer.current);
      if (!flushTimer.current) {
        flushTimer.current = window.setTimeout(flushMoves, 2000);
      }
    }).finally(() => {
      pendingFlushes.current = pendingFlushes.current.filter((x) => x !== p);
      inFlight.current--;
      if (inFlight.current <= 0) setSaving(false);
    });
    pendingFlushes.current.push(p);
  }

  function queueMove(idx: number, st: CellState) {
    if (props.readonly || props.offline) return;
    if (moveLimited) return;
    moveCount.current++;
    const atMs = Math.max(0, Date.now() - startMs.current);
    moveBuffer.current.push({ idx, state: st, atMs });
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(flushMoves, 150);
    if (moveCount.current >= MAX_MOVES) {
      setMoveLimited(true);
      props.onAbandoned?.();
    }
  }

  async function finishAttempt(auto: boolean) {
    if (props.readonly || solved || finishing.current) return;
    if (auto && autoFinishRetries.current >= 5) return;
    finishing.current = true;
    if (auto) autoFinishRetries.current++;
    if (!auto) { props.onToast(null); autoFinishRetries.current = 0; }

    if (props.offline) {
      if (progress.allCorrect) {
        stopTimer();
        setSolved(true);
        const secs = (elapsed / 1000).toFixed(2);
        props.onToast({ kind: "ok", msg: `Solved in ${secs}s (offline)` });
        props.onSolved?.();
      } else if (!auto) {
        props.onToast({ kind: "bad", msg: "Not solved yet" });
      }
      finishing.current = false;
      return;
    }

    // Drain the move buffer completely: flush and wait in a loop until
    // no buffered moves remain (failed flushes re-queue with a 2s retry,
    // so a single flush+await may leave moves still in the buffer).
    for (let tries = 0; tries < 10 && (moveBuffer.current.length > 0 || pendingFlushes.current.length > 0); tries++) {
      flushMoves();
      await Promise.all(pendingFlushes.current);
      if (moveBuffer.current.length > 0) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    try {
      const r = await api<{
        solved: boolean;
        durationMs?: number;
        eligible?: boolean;
        wrongRows?: number;
        wrongCols?: number;
      }>(
        `/api/attempts/${encodeURIComponent(props.attemptId)}/finish`,
        { method: "POST" }
      );
      if (r.solved) {
        stopTimer();
        setSolved(true);
        if (typeof r.durationMs === "number") setElapsed(r.durationMs);
        const t = typeof r.durationMs === "number" ? ` in ${(r.durationMs / 1000).toFixed(2)}s` : "";
        const el = r.eligible === false ? " (replay viewed \u2014 not on leaderboard)" : "";
        props.onToast({ kind: "ok", msg: `Solved${t}${el}` });
        props.onSolved?.();
      } else if (auto) {
        // Server state may lag behind client — retry once after a delay.
        finishing.current = false;
        window.setTimeout(() => void finishAttempt(true), 2000);
        return;
      } else {
        props.onToast({
          kind: "bad",
          msg: `Not solved. Wrong rows: ${r.wrongRows || 0}, Wrong cols: ${r.wrongCols || 0}`,
        });
      }
    } catch (err) {
      if (auto) {
        // Network error during auto-finish — retry after a delay.
        finishing.current = false;
        window.setTimeout(() => void finishAttempt(true), 2000);
        return;
      }
      props.onToast({ kind: "bad", msg: (err as Error).message });
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
    if (props.readonly || solved || moveLimited) return;
    e.preventDefault();
    const touch = e.touches[0];
    const idx = getCellIdx(touch.clientX, touch.clientY);
    if (idx === null || idx < 0) return;
    dragging.current = true;
    lastTouchIdx.current = idx;
    const cur = stateRef.current[idx];
    const newVal = cycleState(cur);
    paintValue.current = newVal;
    setState((prev) => {
      const next = prev.slice();
      next[idx] = newVal;
      return next;
    });
    queueMove(idx, newVal);
    setHoverRow(Math.floor(idx / puzzle.width));
    setHoverCol(idx % puzzle.width);
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!dragging.current || props.readonly || solved || moveLimited) return;
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

  const fadeRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const updateScrollHints = useCallback(() => {
    const wrap = wrapRef.current;
    const fade = fadeRef.current;
    if (!wrap || !fade) return;
    fade.classList.toggle("can-scroll-left", wrap.scrollLeft > 2);
    fade.classList.toggle("can-scroll-right", wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    updateScrollHints();
    wrap.addEventListener("scroll", updateScrollHints, { passive: true });
    window.addEventListener("resize", updateScrollHints);
    return () => { wrap.removeEventListener("scroll", updateScrollHints); window.removeEventListener("resize", updateScrollHints); };
  }, [updateScrollHints]);

  const { gridTemplateColumns, gridTemplateRows, cells } = useMemo(() => {
    const w = puzzle.width;
    const h = puzzle.height;

    const colDepth = Math.max(...puzzle.colClues.map((c) => c.length), 0);
    const rowDepth = Math.max(...puzzle.rowClues.map((c) => c.length), 0);

    const cols = rowDepth + w;
    const rows = colDepth + h;

    type Item =
      | { kind: "empty" }
      | { kind: "clue"; text: string; rmaj: boolean; cmaj: boolean; clueRow?: number; clueCol?: number }
      | { kind: "cell"; idx: number; row: number; col: number; rmaj: boolean; cmaj: boolean; state: CellState };

    const items: Item[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r < colDepth && c < rowDepth) {
          items.push({ kind: "empty" });
          continue;
        }
        if (r < colDepth && c >= rowDepth) {
          const col = c - rowDepth;
          const clue = puzzle.colClues[col];
          const clueIdx = r - (colDepth - clue.length);
          if (clueIdx < 0) {
            items.push({ kind: "empty" });
          } else {
            items.push({ kind: "clue", text: String(clue[clueIdx]), rmaj: false, cmaj: (col + 1) % 5 === 0, clueCol: col });
          }
          continue;
        }
        if (r >= colDepth && c < rowDepth) {
          const row = r - colDepth;
          const clue = puzzle.rowClues[row];
          const clueIdx = c - (rowDepth - clue.length);
          if (clueIdx < 0) {
            items.push({ kind: "empty" });
          } else {
            items.push({ kind: "clue", text: String(clue[clueIdx]), rmaj: (row + 1) % 5 === 0, cmaj: false, clueRow: row });
          }
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

    const track = `repeat(${cols}, minmax(var(--cell-min, 18px), var(--cell-size, 28px)))`;
    return { gridTemplateColumns: track, gridTemplateRows: `repeat(${rows}, minmax(var(--cell-min, 18px), var(--cell-size, 28px)))`, cells: items, colDepth, rows };
  }, [puzzle, state]);

  return (
    <div>
      {!props.readonly && (
        <div className="timer">{fmtTime(elapsed)}</div>
      )}

      {!props.readonly && !props.offline && !props.eligible && (
        <div className="hint" style={{ textAlign: "center" }}>(not ranked)</div>
      )}

      {!props.readonly && (
        <div className="game-status">
          {moveLimited ? "Move limit reached" : saving ? "saving..." : solved ? "solved!" : "\u00A0"}
        </div>
      )}

      <div className="nonogram-fade" ref={fadeRef} style={{ "--fade-top": `${(colDepth / rows) * 100}%` } as React.CSSProperties}>
        <div className="nonogram-wrap" ref={wrapRef}>
          <div
            ref={gridRef}
            className={`nonogram${!props.readonly ? " interactive" : ""}`}
            style={{ gridTemplateColumns, gridTemplateRows }}
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
              if (it.kind === "empty") return <div key={i} className="clue-empty" />;
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
                />
              );
            })}
          </div>
        </div>
      </div>

      {!props.readonly && !solved && state.some((s) => s === 1) && (
        <div className="check-area hint">
          {progress.correctRows}/{puzzle.height} rows, {progress.correctCols}/{puzzle.width} columns
        </div>
      )}
    </div>
  );
}
