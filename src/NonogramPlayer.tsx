import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { CellState, Puzzle } from "./types";

type Tool = "fill" | "x" | "clear";

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
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
  const [tool, setTool] = useState<Tool>("fill");
  const [state, setState] = useState<CellState[]>(() => props.initialState);
  const [saving, setSaving] = useState(false);
  const [solved, setSolved] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const inFlight = useRef(0);
  const timerStart = useRef(0);
  const timerRef = useRef<number | null>(null);
  const lastTap = useRef<{ idx: number; time: number }>({ idx: -1, time: 0 });

  useEffect(() => {
    setState(props.initialState);
  }, [props.attemptId, props.initialState]);

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

  function applyTool(cur: CellState, t: Tool): CellState {
    if (t === "fill") return cur === 1 ? 0 : 1;
    if (t === "x") return cur === 2 ? 0 : 2;
    return 0;
  }

  function toggleX(idx: number) {
    if (props.readonly || solved) return;
    startTimerIfNeeded();
    setState((prev) => {
      const next = prev.slice();
      next[idx] = (next[idx] === 2 ? 0 : 2) as CellState;
      void postMove(idx, next[idx]);
      return next;
    });
  }

  function onCell(idx: number) {
    if (props.readonly || solved) return;
    const now = Date.now();
    if (lastTap.current.idx === idx && now - lastTap.current.time < 300) {
      lastTap.current = { idx: -1, time: 0 };
      toggleX(idx);
      return;
    }
    lastTap.current = { idx, time: now };
    startTimerIfNeeded();
    setState((prev) => {
      const next = prev.slice();
      next[idx] = applyTool(next[idx], tool);
      void postMove(idx, next[idx]);
      return next;
    });
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

  async function check() {
    if (props.readonly || solved) return;
    props.onToast(null);
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
      } else {
        props.onToast({
          kind: "bad",
          msg: `Not solved. Wrong: ${r.wrongFilled || 0}, Missing: ${r.missingFilled || 0}`,
        });
      }
    } catch (err) {
      props.onToast({ kind: "bad", msg: (err as Error).message });
    }
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
      | { kind: "clue"; text: string; rmaj: boolean; cmaj: boolean }
      | { kind: "cell"; idx: number; rmaj: boolean; cmaj: boolean; state: CellState };

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
          items.push({ kind: "clue", text, rmaj: false, cmaj: (col + 1) % 5 === 0 });
          continue;
        }
        if (r >= colDepth && c < rowDepth) {
          const row = r - colDepth;
          const clue = puzzle.rowClues[row];
          const clueIdx = c - (rowDepth - clue.length);
          const text = clueIdx >= 0 ? String(clue[clueIdx]) : "";
          items.push({ kind: "clue", text, rmaj: (row + 1) % 5 === 0, cmaj: false });
          continue;
        }
        const row = r - colDepth;
        const col = c - rowDepth;
        const idx = row * w + col;
        items.push({
          kind: "cell",
          idx,
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
        <div className="game-controls">
          <div className="row">
            {(["fill", "x", "clear"] as Tool[]).map((t) => (
              <button
                key={t}
                className={`btn tool ${tool === t ? "on" : ""}`}
                onClick={() => setTool(t)}
                disabled={solved}
              >
                {t}
              </button>
            ))}
          </div>
          <span className="game-status">
            {saving ? "saving..." : solved ? "solved!" : "\u00A0"}
          </span>
        </div>
      )}

      {!props.eligible && !props.readonly && (
        <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>
          Not eligible for leaderboard (viewed replay).
        </div>
      )}

      <div className="nonogram-wrap">
        <div className="nonogram" style={{ gridTemplateColumns }}>
          {cells.map((it, i) => {
            if (it.kind === "blank") return <div key={i} className="clue" />;
            if (it.kind === "clue") {
              const cls = `clue${it.rmaj ? " rmaj" : ""}${it.cmaj ? " cmaj" : ""}`;
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
                onClick={() => onCell(it.idx)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  toggleX(it.idx);
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
            onClick={check}
            style={{ padding: "10px 24px", fontSize: 15 }}
          >
            {solved ? "Solved!" : "Check Solution"}
          </button>
        </div>
      )}
    </div>
  );
}
