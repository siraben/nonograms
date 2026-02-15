import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { CellState, Puzzle } from "./types";

type Tool = "fill" | "x" | "clear";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export default function NonogramPlayer(props: {
  attemptId: string;
  eligible: boolean;
  puzzle: Puzzle;
  initialState: CellState[];
  readonly?: boolean;
  onToast: (t: { kind: "ok" | "bad"; msg: string } | null) => void;
}) {
  const { puzzle } = props;
  const [tool, setTool] = useState<Tool>("fill");
  const [state, setState] = useState<CellState[]>(() => props.initialState);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(0);

  useEffect(() => {
    setState(props.initialState);
  }, [props.attemptId, props.initialState]);

  function applyTool(cur: CellState, t: Tool): CellState {
    if (t === "fill") return cur === 1 ? 0 : 1;
    if (t === "x") return cur === 2 ? 0 : 2;
    return 0;
  }

  function onCell(idx: number) {
    if (props.readonly) return;
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
      await api(`/api/attempts/${encodeURIComponent(props.attemptId)}/move`, { method: "POST", json: { idx, state: st } });
    } catch (err) {
      props.onToast({ kind: "bad", msg: (err as Error).message });
    } finally {
      inFlight.current--;
      if (inFlight.current <= 0) setSaving(false);
    }
  }

  async function check() {
    if (props.readonly) return;
    props.onToast(null);
    try {
      const r = await api<{ solved: boolean; durationMs?: number; eligible?: boolean; wrongFilled?: number; missingFilled?: number }>(
        `/api/attempts/${encodeURIComponent(props.attemptId)}/finish`,
        { method: "POST", json: { state } }
      );
      if (r.solved) {
        const t = typeof r.durationMs === "number" ? ` in ${(r.durationMs / 1000).toFixed(2)}s` : "";
        const el = r.eligible === false ? " (not eligible for leaderboard)" : "";
        props.onToast({ kind: "ok", msg: `solved${t}${el}` });
      } else {
        props.onToast({
          kind: "bad",
          msg: `not solved. wrong filled: ${r.wrongFilled || 0}, missing filled: ${r.missingFilled || 0}`
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

    const items: Array<
      | { kind: "blank" }
      | { kind: "clue"; text: string; major: boolean }
      | { kind: "cell"; idx: number; major: boolean; state: CellState }
    > = [];

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
          items.push({ kind: "clue", text, major: (col + 1) % 5 === 0 });
          continue;
        }
        if (r >= colDepth && c < rowDepth) {
          const row = r - colDepth;
          const clue = puzzle.rowClues[row];
          const clueIdx = c - (rowDepth - clue.length);
          const text = clueIdx >= 0 ? String(clue[clueIdx]) : "";
          items.push({ kind: "clue", text, major: (row + 1) % 5 === 0 });
          continue;
        }
        const row = r - colDepth;
        const col = c - rowDepth;
        const idx = row * w + col;
        const major = (row + 1) % 5 === 0 || (col + 1) % 5 === 0;
        items.push({ kind: "cell", idx, major, state: state[idx] });
      }
    }

    return {
      gridTemplateColumns: `repeat(${cols}, 28px)`,
      cells: items
    };
  }, [puzzle, state]);

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <div className="row">
          <button className={`btn tool ${tool === "fill" ? "on" : ""}`} onClick={() => setTool("fill")} disabled={props.readonly}>
            fill
          </button>
          <button className={`btn tool ${tool === "x" ? "on" : ""}`} onClick={() => setTool("x")} disabled={props.readonly}>
            x
          </button>
          <button className={`btn tool ${tool === "clear" ? "on" : ""}`} onClick={() => setTool("clear")} disabled={props.readonly}>
            clear
          </button>
        </div>
        <div className="row">
          <button className="btn primary" disabled={saving || props.readonly} onClick={check}>
            check
          </button>
          <span className="muted">{saving ? "saving..." : "\u00A0"}</span>
        </div>
      </div>
      {!props.eligible ? (
        <div className="muted" style={{ marginBottom: 10 }}>
          This run will not count for the leaderboard (you have viewed a replay for this puzzle).
        </div>
      ) : null}

      <div className="nonogram-wrap">
        <div className="nonogram" style={{ gridTemplateColumns }}>
          {cells.map((it, i) => {
            if (it.kind === "blank") return <div key={i} className="clue" />;
            if (it.kind === "clue") return <div key={i} className={`clue ${it.major ? "major" : ""}`}>{it.text}</div>;
            const cls =
              "cell " +
              (it.major ? "major " : "") +
              (it.state === 1 ? "filled" : it.state === 2 ? "x" : "");
            return (
              <div
                key={i}
                className={cls}
                onClick={() => onCell(it.idx)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (props.readonly) return;
                  // quick right-click toggle between X and unknown
                  setState((prev) => {
                    const next = prev.slice();
                    next[it.idx] = clamp((next[it.idx] === 2 ? 0 : 2) as number, 0, 2) as CellState;
                    void postMove(it.idx, next[it.idx]);
                    return next;
                  });
                }}
                title={`r${Math.floor(it.idx / puzzle.width) + 1} c${(it.idx % puzzle.width) + 1}`}
              >
                {it.state === 2 ? "×" : ""}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
