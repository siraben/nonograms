import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Attempt, CellState, LeaderboardEntry, Puzzle, ReplayMove, User } from "./types";
import { api } from "./api";
import * as Auth from "./auth";
import NonogramPlayer from "./NonogramPlayer";
import { getTurnstile } from "./turnstile";
import { useOnline } from "./useOnline";
import { genPuzzle } from "../functions/lib/puzzle";
import { randomU32 } from "../functions/lib/rng";

type Route =
  | { name: "login" }
  | { name: "register" }
  | { name: "home" }
  | { name: "admin" }
  | { name: "play"; attemptId: string }
  | { name: "replay"; attemptId: string }
  | { name: "offline-play"; size: number };

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseRoute(): Route {
  const h = (location.hash || "#/").replace(/^#/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "login") return { name: "login" };
  if (parts[0] === "register") return { name: "register" };
  if (parts[0] === "admin") return { name: "admin" };
  if (parts[0] === "a" && parts[1]) return { name: "play", attemptId: parts[1] };
  if (parts[0] === "replay" && parts[1]) return { name: "replay", attemptId: parts[1] };
  if (parts[0] === "offline" && parts[1]) {
    const size = parseInt(parts[1], 10);
    if (size === 5 || size === 10) return { name: "offline-play", size };
  }
  return { name: "home" };
}

function nav(to: string) {
  location.hash = to;
}

function SunIcon(props: { title?: string }) {
  return (
    <svg
      aria-hidden={props.title ? undefined : true}
      role={props.title ? "img" : "presentation"}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
    >
      {props.title ? <title>{props.title}</title> : null}
      <path
        d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon(props: { title?: string }) {
  return (
    <svg
      aria-hidden={props.title ? undefined : true}
      role={props.title ? "img" : "presentation"}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
    >
      {props.title ? <title>{props.title}</title> : null}
      <path
        d="M21 14.2A8.6 8.6 0 0 1 9.8 3a7.2 7.2 0 1 0 11.2 11.2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Based on Lucide "circle-help" (ISC license): https://lucide.dev/icons/circle-help
function HelpIcon(props: { title?: string }) {
  return (
    <svg
      aria-hidden={props.title ? undefined : true}
      role={props.title ? "img" : "presentation"}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
    >
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path
        d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 2-3 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const S = 24; // help diagram cell size
const G = 1;  // gap between cells

function HelpDiagram(props: {
  caption: string;
  cols: number;
  cells: number[];
  clueLabels: string[];
  clueDir: "row" | "col";
}) {
  const { cols, cells, clueLabels, clueDir } = props;
  const rows = Math.ceil(cells.length / cols);
  const clueW = clueDir === "row" ? clueLabels.length * S : 0;
  const clueH = clueDir === "col" ? clueLabels.length * S : 0;
  const w = clueW + cols * (S + G) - G;
  const h = clueH + rows * (S + G) - G;

  return (
    <div className="help-diagram">
      <svg width={w} height={h} aria-label={props.caption}>
        {clueDir === "row" && clueLabels.map((lbl, i) => (
          <text
            key={i}
            x={i * S + S / 2}
            y={h / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--text)"
            fontSize="12"
            fontWeight="700"
          >
            {lbl}
          </text>
        ))}
        {clueDir === "col" && clueLabels.map((lbl, i) => (
          <text
            key={i}
            x={w / 2}
            y={i * S + S / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--text)"
            fontSize="12"
            fontWeight="700"
          >
            {lbl}
          </text>
        ))}
        {cells.map((c, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const x = clueW + col * (S + G);
          const y = clueH + row * (S + G);
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={S}
              height={S}
              rx={3}
              fill={c === 1 ? "var(--cell-filled)" : "var(--cell-bg)"}
              stroke="var(--cell-border)"
              strokeWidth={1}
            />
          );
        })}
      </svg>
    </div>
  );
}

function HelpGrid(props: {
  w: number;
  h: number;
  cells: number[];
  rowClues: string[];
  colClues: string[];
}) {
  const { w, h, cells, rowClues, colClues } = props;
  const clueColW = 40;
  const clueRowH = 20;
  const totalW = clueColW + w * (S + G) - G;
  const totalH = clueRowH + h * (S + G) - G;

  return (
    <div className="help-diagram">
      <svg width={totalW} height={totalH} aria-label="Solved example">
        {colClues.map((lbl, c) => (
          <text
            key={`c${c}`}
            x={clueColW + c * (S + G) + S / 2}
            y={clueRowH / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--muted)"
            fontSize="10"
            fontWeight="700"
          >
            {lbl}
          </text>
        ))}
        {rowClues.map((lbl, r) => (
          <text
            key={`r${r}`}
            x={clueColW - 6}
            y={clueRowH + r * (S + G) + S / 2}
            textAnchor="end"
            dominantBaseline="central"
            fill="var(--muted)"
            fontSize="10"
            fontWeight="700"
          >
            {lbl}
          </text>
        ))}
        {cells.map((c, i) => {
          const col = i % w;
          const row = Math.floor(i / w);
          const x = clueColW + col * (S + G);
          const y = clueRowH + row * (S + G);
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={S}
              height={S}
              rx={3}
              fill={c === 1 ? "var(--cell-filled)" : "var(--cell-bg)"}
              stroke="var(--cell-border)"
              strokeWidth={1}
            />
          );
        })}
      </svg>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute());
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(true);
  const [toast, setToast] = useState<{ kind: "ok" | "bad"; msg: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const online = useOnline();
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("nonogram-theme");
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("nonogram-theme", theme);
  }, [theme]);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!helpOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHelpOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [helpOpen]);

  useEffect(() => {
    (async () => {
      try {
        setUser(await Auth.me());
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  const authedRoute = useMemo(() => {
    if (busy) return route;
    if (!user && route.name !== "login" && route.name !== "register" && route.name !== "offline-play" && route.name !== "replay") return { name: "login" } as Route;
    if (user && (route.name === "login" || route.name === "register")) return { name: "home" } as Route;
    if (route.name === "admin" && (!user || !user.isAdmin)) return { name: "home" } as Route;
    return route;
  }, [busy, route, user]);

  async function doLogout() {
    await Auth.logout();
    setUser(null);
    nav("/login");
  }

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand" onClick={() => nav("/")}>
          <h1>nonogram</h1>
          <div className="tag">friends-only puzzle room</div>
        </div>
        <div className="row">
          <button
            className="theme-toggle icon-btn"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            {theme === "light" ? <SunIcon /> : <MoonIcon />}
          </button>
          <button
            className="theme-toggle icon-btn"
            onClick={() => setHelpOpen(true)}
            aria-label="Help"
            title="Help"
          >
            <HelpIcon />
          </button>
          {!online && <div className="pill pill-muted">offline</div>}
          {user && (
            <>
              {user.isAdmin && (
                <button className="btn sm" onClick={() => nav("/admin")}>
                  admin
                </button>
              )}
              <div className="pill">{user.username}</div>
              <button className="btn danger" onClick={doLogout}>
                logout
              </button>
            </>
          )}
        </div>
      </div>

      {helpOpen && (
        <div
          className="modal-overlay"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setHelpOpen(false);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-label="Help">
            <div className="modal-head">
              <div className="modal-title">Help</div>
              <button className="modal-close" onClick={() => setHelpOpen(false)} aria-label="Close help">
                ×
              </button>
            </div>
            <div className="modal-body">
              <h3>How to play</h3>
              <p className="help-text">
                Fill in cells to match the clue numbers. Each number tells you the length
                of a consecutive run of filled cells in that row or column. Runs must
                appear in the given order, separated by at least one empty cell.
              </p>

              <h3>Reading clues</h3>
              <p className="help-text">
                A clue of <b>3 1</b> means: a run of 3 filled cells, then a gap, then 1 filled cell.
              </p>
              <HelpDiagram
                caption="Row clue: 3 1"
                cols={6}
                cells={[1,1,1,0,1,0]}
                clueLabels={["3","1"]}
                clueDir="row"
              />
              <p className="help-text">
                A clue of <b>2 2</b> means two separate runs of 2.
              </p>
              <HelpDiagram
                caption="Column clue: 2 2"
                cols={1}
                cells={[1,1,0,1,1,0]}
                clueLabels={["2","2"]}
                clueDir="col"
              />

              <h3>Solving example</h3>
              <p className="help-text">
                Here is a solved 5×5 puzzle (a heart). The clue <b>5</b> means
                the entire row is filled. The clue <b>1 1</b> means two single cells
                with a gap between them.
              </p>
              <HelpGrid
                w={5} h={5}
                cells={[
                  0,1,0,1,0,
                  1,1,1,1,1,
                  1,1,1,1,1,
                  0,1,1,1,0,
                  0,0,1,0,0,
                ]}
                rowClues={["1 1","5","5","3","1"]}
                colClues={["2","4","4","4","2"]}
              />

              <h3>Controls</h3>
              <ul>
                <li>Click to cycle: empty → filled → X → empty</li>
                <li>Click and drag to paint multiple cells</li>
                <li>Touch and drag works on mobile</li>
              </ul>

              <h3>Timer &amp; Leaderboard</h3>
              <ul>
                <li>Timer starts when you click Start</li>
                <li>Puzzle auto-submits when solved correctly</li>
                <li>Leaderboard is per puzzle size</li>
                <li>Watching a replay means your times won't count for that puzzle's leaderboard</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}

      {authedRoute.name === "login" && (
        <>
          <AuthCard
            mode="login"
            onAuthed={async () => {
              setUser(await Auth.me());
              nav("/");
            }}
            onToast={setToast}
          />
          {online && <PublicLeaderboard />}
        </>
      )}

      {authedRoute.name === "register" && (
        <>
          <AuthCard
            mode="register"
            onAuthed={async () => {
              setUser(await Auth.me());
              nav("/");
            }}
            onToast={setToast}
          />
          {online && <PublicLeaderboard />}
        </>
      )}

      {authedRoute.name === "admin" && <AdminDashboard onToast={setToast} />}

      {authedRoute.name === "home" && <Home online={online} onToast={setToast} />}

      {authedRoute.name === "offline-play" && (
        <OfflinePlay size={authedRoute.size} onToast={setToast} />
      )}

      {authedRoute.name === "play" && (
        <Play attemptId={authedRoute.attemptId} onToast={setToast} />
      )}

      {authedRoute.name === "replay" && (
        <Replay attemptId={authedRoute.attemptId} onToast={setToast} />
      )}
    </div>
  );
}

function AuthCard(props: {
  mode: "login" | "register";
  onAuthed: () => void;
  onToast: (t: { kind: "ok" | "bad"; msg: string } | null) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaReady, setCaptchaReady] = useState(false);

  useEffect(() => {
    if (props.mode !== "register") return;
    const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
    if (!siteKey) return;

    let cancelled = false;
    let widgetId: string | null = null;

    const tryRender = () => {
      if (cancelled) return;
      const t = getTurnstile();
      const el = document.getElementById("turnstile");
      if (!t || !el) {
        window.setTimeout(tryRender, 50);
        return;
      }
      el.innerHTML = "";
      widgetId = t.render(el, {
        sitekey: siteKey,
        theme: "auto" as any,
        callback: (token) => {
          setCaptchaToken(token);
          setCaptchaReady(true);
        },
        "expired-callback": () => {
          setCaptchaToken("");
          setCaptchaReady(false);
          if (widgetId) t.reset(widgetId);
        },
      });
    };

    setCaptchaToken("");
    setCaptchaReady(false);
    tryRender();

    return () => {
      cancelled = true;
    };
  }, [props.mode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    props.onToast(null);
    setSubmitting(true);
    try {
      if (props.mode === "login") {
        await Auth.login(username, password, remember);
      } else {
        const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
        if (siteKey && !captchaToken) throw new Error("Complete captcha first");
        await Auth.register(username, password, captchaToken, inviteCode);
      }
      props.onToast({
        kind: "ok",
        msg: props.mode === "login" ? "Logged in" : "Account created",
      });
      props.onAuthed();
    } catch (err) {
      props.onToast({ kind: "bad", msg: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card card-narrow">
      <h2>{props.mode === "login" ? "Login" : "Register"}</h2>
      <form onSubmit={submit}>
        <div className="field">
          <label>Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete={props.mode === "login" ? "current-password" : "new-password"}
          />
        </div>
        {props.mode === "register" && (
          <div className="field">
            <label>Invite code (if required)</label>
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              autoComplete="off"
              placeholder="XXXX-XXXX-XXXX-XXXX"
            />
          </div>
        )}
        {props.mode === "register" && (
          <div className="field">
            <label>Captcha</label>
            {(import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ? (
              <>
                <div id="turnstile" className="turnstile-wrap" />
                <div className="hint">
                  {captchaReady ? "Verified" : "Pending..."}
                </div>
              </>
            ) : (
              <div className="hint">
                Captcha disabled in dev
              </div>
            )}
          </div>
        )}
        {props.mode === "login" && (
          <label className="row muted remember-field">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Remember me
          </label>
        )}
        <div className="row">
          <button
            className="btn primary"
            disabled={
              submitting ||
              (props.mode === "register" &&
                Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY) &&
                !captchaReady)
            }
          >
            {props.mode === "login" ? "Login" : "Create Account"}
          </button>
          {props.mode === "login" ? (
            <button type="button" className="btn" onClick={() => nav("/register")}>
              Register
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => nav("/login")}>
              Back to Login
            </button>
          )}
        </div>
      </form>
      <div className="offline-promo">
        <div className="hint">Or play offline without an account:</div>
        <div className="btn-group" style={{ marginTop: 6 }}>
          <button type="button" className="btn sm" onClick={() => nav("/offline/5")}>
            Offline 5x5
          </button>
          <button type="button" className="btn sm" onClick={() => nav("/offline/10")}>
            Offline 10x10
          </button>
        </div>
      </div>
    </div>
  );
}

type PublicEntry = { username: string; durationMs: number; finishedAt: string; width: number; height: number };

function PublicLeaderboard() {
  const [entries5, setEntries5] = useState<PublicEntry[]>([]);
  const [entries10, setEntries10] = useState<PublicEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [signupPrompt, setSignupPrompt] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api<{ leaderboard5: PublicEntry[]; leaderboard10: PublicEntry[] }>("/api/leaderboard/public");
        setEntries5(r.leaderboard5);
        setEntries10(r.leaderboard10);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading || (entries5.length === 0 && entries10.length === 0)) return null;

  const medal = (i: number) => i === 0 ? "\u{1F947}" : i === 1 ? "\u{1F948}" : "\u{1F949}";

  const renderColumn = (label: string, entries: PublicEntry[]) => (
    <div className="card">
      <h2>{label} Leaderboard</h2>
      {entries.length === 0 ? (
        <div className="muted">No runs yet</div>
      ) : (
        <div className="list">
          {entries.map((e, i) => (
            <div key={i} className="item">
              <div className="title">
                {medal(i)} {e.username}
                <span className="muted" style={{ marginLeft: 8 }}>
                  {(e.durationMs / 1000).toFixed(2)}s
                </span>
              </div>
              <div className="meta">{fmtTime(e.finishedAt)}</div>
              <div className="row item-actions">
                <button className="btn sm" onClick={() => setSignupPrompt(true)}>play</button>
                <button className="btn sm" onClick={() => setSignupPrompt(true)}>watch replay</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="leaderboard-cols">
        {renderColumn("5x5", entries5)}
        {renderColumn("10x10", entries10)}
      </div>
      {signupPrompt && (
        <div
          className="modal-overlay"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSignupPrompt(false); }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-label="Sign up required">
            <div className="modal-head">
              <div className="modal-title">Sign up to play</div>
              <button className="modal-close" onClick={() => setSignupPrompt(false)} aria-label="Close">&times;</button>
            </div>
            <div className="modal-body">
              <p className="help-text">
                Create an account to play online puzzles, compete on the leaderboard, and watch replays.
              </p>
              <div className="btn-group" style={{ marginTop: 12 }}>
                <button className="btn primary" onClick={() => { setSignupPrompt(false); nav("/register"); }}>Register</button>
                <button className="btn" onClick={() => { setSignupPrompt(false); nav("/login"); }}>Login</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Home(props: { online: boolean; onToast: (t: { kind: "ok" | "bad"; msg: string } | null) => void }) {
  const [leader5, setLeader5] = useState<LeaderboardEntry[]>([]);
  const [leader10, setLeader10] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!props.online) return;
    const es = new EventSource("/api/leaderboard/stream");
    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as { leaderboard5: LeaderboardEntry[]; leaderboard10: LeaderboardEntry[] };
      setLeader5(data.leaderboard5);
      setLeader10(data.leaderboard10);
      setLoading(false);
    };
    es.onerror = () => {
      // EventSource auto-reconnects; just mark loaded so UI isn't stuck
      setLoading(false);
    };
    return () => es.close();
  }, [props.online]);

  async function newGame(puzzleId?: string, size?: number) {
    props.onToast(null);
    try {
      const json: Record<string, unknown> = {};
      if (puzzleId) json.puzzleId = puzzleId;
      if (size) json.size = size;
      const r = await api<{ attempt: { id: string } }>("/api/attempts/new", {
        method: "POST",
        json,
      });
      nav(`/a/${r.attempt.id}`);
    } catch (err) {
      props.onToast({ kind: "bad", msg: (err as Error).message });
    }
  }

  return (
    <>
      <div className="card text-center">
        {!props.online && (
          <div className="hint" style={{ marginBottom: 8 }}>
            <strong>Offline mode</strong> — puzzles generated locally, no leaderboard.
          </div>
        )}
        <div className="btn-group">
          <button
            className="btn primary lg"
            onClick={() => props.online ? void newGame(undefined, 5) : nav("/offline/5")}
          >
            New 5x5
          </button>
          <button
            className="btn primary lg"
            onClick={() => props.online ? void newGame(undefined, 10) : nav("/offline/10")}
          >
            New 10x10
          </button>
        </div>
        {props.online && (
          <div className="hint" style={{ marginTop: 8 }}>
            Watching a replay means your times won't count for that puzzle's leaderboard.
          </div>
        )}
      </div>

      {props.online && (
        <div className="leaderboard-cols">
          {([["5x5", leader5], ["10x10", leader10]] as const).map(([label, entries]) => (
            <div key={label} className="card">
              <h2>{label} Leaderboard</h2>
              {loading ? (
                <div className="muted">Loading...</div>
              ) : entries.length === 0 ? (
                <div className="muted">No runs yet. Be the first!</div>
              ) : (
                <div className="list">
                  {entries.map((e, i) => (
                    <div key={e.attemptId} className="item">
                      <div className="title">
                        <span className="muted" style={{ marginRight: 6 }}>#{i + 1}</span>
                        {e.username}
                        <span className="muted" style={{ marginLeft: 8 }}>
                          {(e.durationMs / 1000).toFixed(2)}s
                        </span>
                      </div>
                      <div className="meta">
                        {e.puzzleId.slice(0, 8)} &mdash; {fmtTime(e.finishedAt)}
                      </div>
                      <div className="row item-actions">
                        <button
                          className="btn sm"
                          onClick={() => void newGame(e.puzzleId)}
                        >
                          play
                        </button>
                        <button
                          className="btn sm"
                          onClick={() => nav(`/replay/${e.attemptId}`)}
                        >
                          watch replay
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function OfflinePlay(props: {
  size: number;
  onToast: (t: { kind: "ok" | "bad"; msg: string } | null) => void;
}) {
  const [key, setKey] = useState(0);
  const puzzle = useMemo(() => {
    const seed = randomU32();
    const p = genPuzzle(props.size, props.size, seed);
    return { width: p.width, height: p.height, rowClues: p.rowClues, colClues: p.colClues };
  }, [props.size, key]);

  const initialState = useMemo(
    () => Array.from({ length: puzzle.width * puzzle.height }, () => 0 as CellState),
    [puzzle],
  );

  const startedAt = useMemo(() => new Date().toISOString(), [puzzle]);

  return (
    <>
      <div className="back-nav">
        <button className="btn" onClick={() => nav("/")}>
          &larr; Back
        </button>
      </div>
      <div className="card">
        <NonogramPlayer
          attemptId={`offline-${key}`}
          eligible={false}
          puzzle={puzzle}
          initialState={initialState}
          startedAt={startedAt}
          offline
          onToast={props.onToast}
        />
        <div className="check-area" style={{ marginTop: 8 }}>
          <button
            className="btn"
            onClick={() => { props.onToast(null); setKey((k) => k + 1); }}
          >
            New puzzle
          </button>
        </div>
      </div>
    </>
  );
}

function Play(props: {
  attemptId: string;
  onToast: (t: { kind: "ok" | "bad"; msg: string } | null) => void;
}) {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await api<{ puzzle: Puzzle | { width: number; height: number }; attempt: Attempt }>(
          `/api/attempts/${encodeURIComponent(props.attemptId)}`
        );
        setAttempt(r.attempt);
        if ("rowClues" in r.puzzle) {
          setPuzzle(r.puzzle as Puzzle);
        } else {
          setDims(r.puzzle);
        }
      } catch (err) {
        props.onToast({ kind: "bad", msg: (err as Error).message });
      } finally {
        setLoading(false);
      }
    })();
  }, [props.attemptId]);

  async function startAttempt() {
    setStarting(true);
    try {
      const r = await api<{ startedAt: string; puzzle: Puzzle }>(
        `/api/attempts/${encodeURIComponent(props.attemptId)}/start`,
        { method: "POST" }
      );
      setPuzzle(r.puzzle);
      setAttempt((prev) => prev ? { ...prev, startedAt: r.startedAt } : prev);
    } catch (err) {
      props.onToast({ kind: "bad", msg: (err as Error).message });
    } finally {
      setStarting(false);
    }
  }

  // Redirect away from abandoned attempts (completed with no finishedAt)
  useEffect(() => {
    if (attempt?.completed && !attempt.finishedAt) {
      props.onToast({ kind: "bad", msg: "Attempt abandoned — start a new game" });
      nav("/");
    }
  }, [attempt?.completed, attempt?.finishedAt]);

  // Abandon attempt on page unload (close tab, refresh, navigate away)
  useEffect(() => {
    if (!attempt?.startedAt || attempt.completed) return;
    const url = `/api/attempts/${encodeURIComponent(props.attemptId)}/abandon`;
    const onUnload = () => navigator.sendBeacon(url);
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [props.attemptId, attempt?.startedAt, attempt?.completed]);

  // Abandon attempt on SPA navigation away from play route
  useEffect(() => {
    if (!attempt?.startedAt || attempt.completed) return;
    return () => {
      navigator.sendBeacon(`/api/attempts/${encodeURIComponent(props.attemptId)}/abandon`);
    };
  }, [props.attemptId, attempt?.startedAt, attempt?.completed]);

  const notStarted = attempt && !attempt.startedAt;

  return (
    <>
      <div className="back-nav">
        <button className="btn" onClick={() => nav("/")}>
          &larr; Back
        </button>
      </div>
      <div className="card">
        {loading && <div className="muted">Loading puzzle...</div>}
        {notStarted && dims && (
          <div className="start-gate">
            <div className="start-grid" style={{
              gridTemplateColumns: `repeat(${dims.width}, 28px)`,
            }}>
              {Array.from({ length: dims.width * dims.height }, (_, i) => (
                <div key={i} className="start-cell" />
              ))}
            </div>
            <div className="start-overlay">
              <button
                className="btn primary start-btn"
                disabled={starting}
                onClick={startAttempt}
              >
                {starting ? "Starting..." : `Start ${dims.width}×${dims.height}`}
              </button>
            </div>
          </div>
        )}
        {puzzle && attempt?.startedAt && (
          <NonogramPlayer
            attemptId={attempt.id}
            eligible={attempt.eligible}
            puzzle={puzzle}
            initialState={attempt.state}
            startedAt={attempt.startedAt}
            onToast={props.onToast}
          />
        )}
      </div>
    </>
  );
}

function Replay(props: {
  attemptId: string;
  onToast: (t: { kind: "ok" | "bad"; msg: string } | null) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [moves, setMoves] = useState<ReplayMove[]>([]);
  const [meta, setMeta] = useState<{ username: string; durationMs: number | null } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [replayElapsed, setReplayElapsed] = useState(0);
  const [realtime, setRealtime] = useState(false);
  const realtimeRef = useRef(false);
  const [state, setState] = useState<CellState[]>(
    Array.from({ length: 100 }, () => 0 as CellState)
  );
  const [dragPct, setDragPct] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirmed) return;
    (async () => {
      setPlaying(false);
      setPos(0);
      if (timer.current) clearTimeout(timer.current);
      try {
        const r = await api<{
          puzzle: Puzzle;
          moves: ReplayMove[];
          attempt: { username: string; durationMs: number | null };
        }>(`/api/replay/${encodeURIComponent(props.attemptId)}`);
        setPuzzle(r.puzzle);
        setMoves(r.moves);
        setMeta({ username: r.attempt.username, durationMs: r.attempt.durationMs });
        setState(
          Array.from({ length: r.puzzle.width * r.puzzle.height }, () => 0 as CellState)
        );
        setReplayElapsed(0);
      } catch (err) {
        props.onToast({ kind: "bad", msg: (err as Error).message });
      }
    })();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [props.attemptId, confirmed]);

  // Auto-scroll timeline to current move
  useEffect(() => {
    const container = timelineRef.current;
    if (!container) return;
    const active = container.querySelector("[data-active]") as HTMLElement | null;
    if (active) {
      active.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [pos]);

  function applyTo(k: number) {
    if (!puzzle) return;
    const next = Array.from(
      { length: puzzle.width * puzzle.height },
      () => 0 as CellState
    );
    for (let i = 0; i < k; i++) {
      const m = moves[i];
      if (!m) break;
      next[m.idx] = m.state;
    }
    setState(next);
    setPos(k);
    setReplayElapsed(k > 0 && moves[k - 1] ? moves[k - 1].atMs : 0);
  }

  function play() {
    if (!puzzle || !moves.length) return;
    if (timer.current) clearTimeout(timer.current);
    setPlaying(true);

    // Scale replay: cap total duration between 10s and 45s
    const totalMs = moves[moves.length - 1].atMs - moves[0].atMs;
    const scale = totalMs < 10000 ? 10000 / Math.max(totalMs, 1) :
                  totalMs > 45000 ? 45000 / totalMs : 1;

    let i = pos;
    function step() {
      i++;
      if (i > moves.length) {
        setPlaying(false);
        if (meta?.durationMs) setReplayElapsed(meta.durationMs);
        return;
      }
      applyTo(i);
      if (i < moves.length) {
        const raw = moves[i].atMs - moves[i - 1].atMs;
        let delay = realtimeRef.current ? raw : Math.min(raw * scale, 1000);
        timer.current = window.setTimeout(step, delay);
      } else {
        // Last move applied, finish
        setPlaying(false);
        if (meta?.durationMs) setReplayElapsed(meta.durationMs);
      }
    }
    step();
  }

  function pause() {
    if (timer.current) clearTimeout(timer.current);
    setPlaying(false);
  }

  if (!confirmed) {
    return (
      <>
        <div className="back-nav">
          <button className="btn" onClick={() => nav("/")}>
            &larr; Back
          </button>
        </div>
        <div className="card text-center">
          <h2>Watch Replay</h2>
          <p className="help-text">
            If you watch this replay, your times for this puzzle won't count for the leaderboard.
          </p>
          <div className="btn-group" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => setConfirmed(true)}>
              Watch anyway
            </button>
            <button className="btn" onClick={() => nav("/")}>
              Go back
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="back-nav">
        <button className="btn" onClick={() => nav("/")}>
          &larr; Back
        </button>
      </div>
      <div className="card">
        <div className="row replay-controls">
          <button
            className="btn"
            onClick={() => (playing ? pause() : play())}
            disabled={!moves.length}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <button className="btn" onClick={() => applyTo(0)} disabled={!moves.length}>
            Reset
          </button>
          <label className="row muted realtime-toggle">
            <input
              type="checkbox"
              checked={realtime}
              onChange={(e) => { setRealtime(e.target.checked); realtimeRef.current = e.target.checked; }}
            />
            Real time
          </label>
          <span className="muted">
            {meta ? (
              <>
                {meta.username} &mdash;{" "}
                {(replayElapsed / 1000).toFixed(1)}s
                {meta.durationMs ? ` / ${(meta.durationMs / 1000).toFixed(1)}s` : ""} &mdash;{" "}
                {pos}/{moves.length} moves
              </>
            ) : (
              "Loading..."
            )}
          </span>
        </div>
        {puzzle && (
          <NonogramPlayer
            attemptId="_replay"
            eligible={false}
            puzzle={puzzle}
            initialState={state}
            readonly
            onToast={props.onToast}
          />
        )}
        {moves.length > 0 && puzzle && (
          <>
            <div
              className="scrubber"
              onMouseDown={(e) => {
                const track = e.currentTarget;
                if (playing) pause();
                const scrub = (clientX: number) => {
                  const rect = track.getBoundingClientRect();
                  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                  setDragPct(pct);
                  const totalMs = moves[moves.length - 1].atMs || 1;
                  const targetMs = pct * totalMs;
                  let idx = 0;
                  for (let j = 0; j < moves.length; j++) {
                    if (moves[j].atMs <= targetMs) idx = j + 1;
                    else break;
                  }
                  applyTo(idx);
                };
                scrub(e.clientX);
                const onMove = (ev: MouseEvent) => scrub(ev.clientX);
                const onUp = () => { setDragPct(null); document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              }}
              onTouchStart={(e) => {
                const track = e.currentTarget;
                if (playing) pause();
                const scrub = (clientX: number) => {
                  const rect = track.getBoundingClientRect();
                  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                  setDragPct(pct);
                  const totalMs = moves[moves.length - 1].atMs || 1;
                  const targetMs = pct * totalMs;
                  let idx = 0;
                  for (let j = 0; j < moves.length; j++) {
                    if (moves[j].atMs <= targetMs) idx = j + 1;
                    else break;
                  }
                  applyTo(idx);
                };
                scrub(e.touches[0].clientX);
                const onMove = (ev: TouchEvent) => { ev.preventDefault(); scrub(ev.touches[0].clientX); };
                const onEnd = () => { setDragPct(null); document.removeEventListener("touchmove", onMove); document.removeEventListener("touchend", onEnd); };
                document.addEventListener("touchmove", onMove, { passive: false });
                document.addEventListener("touchend", onEnd);
              }}
            >
              <div className="scrubber-track">
                {(() => {
                  const totalMs = moves[moves.length - 1].atMs || 1;
                  const fillPct = dragPct != null
                    ? dragPct * 100
                    : pos > 0 ? (moves[pos - 1].atMs / totalMs) * 100 : 0;
                  return <div className="scrubber-fill" style={{ width: `${fillPct}%` }} />;
                })()}
                {moves.map((m, i) => {
                  const totalMs = moves[moves.length - 1].atMs || 1;
                  const pct = (m.atMs / totalMs) * 100;
                  return (
                    <div
                      key={m.seq}
                      className={`scrubber-dot${i + 1 <= pos ? " scrubber-dot-past" : ""}${i + 1 === pos && dragPct == null ? " scrubber-dot-active" : ""}`}
                      style={{ left: `${pct}%` }}
                      title={`${(m.atMs / 1000).toFixed(1)}s — ${m.state === 1 ? "fill" : m.state === 2 ? "X" : "clear"} r${Math.floor(m.idx / puzzle.width) + 1}c${(m.idx % puzzle.width) + 1}`}
                    />
                  );
                })}
                <div
                  className="scrubber-handle"
                  style={{ left: `${dragPct != null ? dragPct * 100 : pos > 0 ? (moves[pos - 1].atMs / (moves[moves.length - 1].atMs || 1)) * 100 : 0}%` }}
                />
              </div>
            </div>
            <div className="timeline" ref={timelineRef}>
              {moves.map((m, i) => {
                const active = i + 1 === pos;
                const past = i + 1 <= pos;
                const r = Math.floor(m.idx / puzzle.width) + 1;
                const c = (m.idx % puzzle.width) + 1;
                const action = m.state === 1 ? "fill" : m.state === 2 ? "X" : "clear";
                return (
                  <div
                    key={m.seq}
                    className={`tl-item${active ? " tl-active" : ""}${past ? " tl-past" : ""}`}
                    data-active={active ? "" : undefined}
                    onClick={() => {
                      if (playing) pause();
                      applyTo(i + 1);
                    }}
                  >
                    <span className="tl-time">{(m.atMs / 1000).toFixed(1)}s</span>
                    <span className="tl-action">{action}</span>
                    <span className="tl-cell">r{r}c{c}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}

type AdminStats = {
  totalUsers: number;
  totalPuzzles: number;
  totalCompleted: number;
  inProgress: number;
  activeSessions: number;
  recentSignups: { id: string; username: string; createdAt: string }[];
  recentCompletions: { attemptId: string; username: string; durationMs: number; finishedAt: string; width: number; height: number }[];
};

type InviteCode = {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  disabled: boolean;
};

function AdminDashboard(props: { onToast: (t: { kind: "ok" | "bad"; msg: string } | null) => void }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [invites, setInvites] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCode, setNewCode] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [creating, setCreating] = useState(false);
  const [lastCreatedCode, setLastCreatedCode] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    try {
      const [s, inv] = await Promise.all([
        api<AdminStats>("/api/admin/stats"),
        api<{ invites: InviteCode[] }>("/api/admin/invites"),
      ]);
      setStats(s);
      setInvites(inv.invites);
    } catch (err) {
      props.onToast({ kind: "bad", msg: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadData(); }, []);

  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    props.onToast(null);
    setCreating(true);
    setLastCreatedCode(null);
    try {
      const body: Record<string, unknown> = {};
      if (newCode.trim()) body.code = newCode.trim();
      if (maxUses.trim()) body.maxUses = parseInt(maxUses.trim(), 10);
      if (expiresInDays.trim()) body.expiresInDays = parseInt(expiresInDays.trim(), 10);
      const r = await api<{ invite: { id: string; code: string } }>("/api/admin/invites", {
        method: "POST",
        json: body,
      });
      setLastCreatedCode(r.invite.code);
      setNewCode("");
      setMaxUses("");
      setExpiresInDays("");
      void loadData();
    } catch (err) {
      props.onToast({ kind: "bad", msg: (err as Error).message });
    } finally {
      setCreating(false);
    }
  }

  async function runCleanup() {
    props.onToast(null);
    try {
      const r = await api<{ abandoned: number; deleted: number }>("/api/admin/cleanup", { method: "POST" });
      props.onToast({ kind: "ok", msg: `Cleaned up: ${r.abandoned} abandoned, ${r.deleted} deleted` });
      void loadData();
    } catch (err) {
      props.onToast({ kind: "bad", msg: (err as Error).message });
    }
  }

  async function disableInvite(id: string) {
    props.onToast(null);
    try {
      await api("/api/admin/invites", { method: "PUT", json: { id } });
      props.onToast({ kind: "ok", msg: "Invite disabled" });
      void loadData();
    } catch (err) {
      props.onToast({ kind: "bad", msg: (err as Error).message });
    }
  }

  return (
    <>
      <div className="back-nav">
        <button className="btn" onClick={() => nav("/")}>
          &larr; Back
        </button>
      </div>

      <div className="card">
        <div className="card-header-row">
          <h2>Admin Dashboard</h2>
          <button className="btn sm" onClick={runCleanup}>
            Cleanup stale
          </button>
        </div>
        {loading ? (
          <div className="muted">Loading...</div>
        ) : stats ? (
          <div className="admin-stats-grid">
            {([
              ["Users", stats.totalUsers],
              ["Puzzles", stats.totalPuzzles],
              ["Completed", stats.totalCompleted],
              ["In Progress", stats.inProgress],
              ["Active Sessions", stats.activeSessions],
            ] as const).map(([label, value]) => (
              <div key={label} className="admin-stat">
                <div className="admin-stat-value">{value}</div>
                <div className="admin-stat-label">{label}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {stats && (
        <>
          <div className="card">
            <h2>Recent Signups</h2>
            {stats.recentSignups.length === 0 ? (
              <div className="muted">No signups yet</div>
            ) : (
              <div className="list">
                {stats.recentSignups.map((u) => (
                  <div key={u.id} className="item">
                    <div className="title">{u.username}</div>
                    <div className="meta">{fmtTime(u.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h2>Recent Completions</h2>
            {stats.recentCompletions.length === 0 ? (
              <div className="muted">No completions yet</div>
            ) : (
              <div className="list">
                {stats.recentCompletions.map((c) => (
                  <div key={c.attemptId} className="item">
                    <div className="title">
                      {c.username}
                      <span className="muted" style={{ marginLeft: 8 }}>
                        {(c.durationMs / 1000).toFixed(2)}s
                      </span>
                    </div>
                    <div className="meta">
                      {c.width}x{c.height} &mdash; {fmtTime(c.finishedAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="card">
        <h2>Invite Codes</h2>
        <form className="admin-invite-form" onSubmit={createInvite}>
          <input
            className="admin-input"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="Code (blank = random)"
          />
          <input
            className="admin-input admin-input-sm"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            placeholder="Max uses"
            type="number"
            min="1"
          />
          <input
            className="admin-input admin-input-sm"
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            placeholder="Expires (days)"
            type="number"
            min="1"
          />
          <button className="btn primary sm" disabled={creating}>
            {creating ? "..." : "Create"}
          </button>
        </form>
        {lastCreatedCode && (
          <div className="toast ok" style={{ marginTop: 8 }}>
            Created: <code>{lastCreatedCode}</code>
          </div>
        )}
        {invites.length === 0 ? (
          <div className="muted" style={{ marginTop: 8 }}>No invite codes</div>
        ) : (
          <div className="list" style={{ marginTop: 8 }}>
            {invites.map((inv) => (
              <div key={inv.id} className="item invite-item">
                <div style={{ flex: 1 }}>
                  <span className="title">
                    {inv.id.slice(0, 8)}
                    {inv.disabled && <span className="muted" style={{ marginLeft: 6 }}>(disabled)</span>}
                  </span>
                  <span className="meta" style={{ marginLeft: 8 }}>
                    {inv.uses}{inv.maxUses != null ? `/${inv.maxUses}` : ""} uses &mdash; {fmtTime(inv.createdAt)}
                    {inv.expiresAt && <> &mdash; exp {fmtTime(inv.expiresAt)}</>}
                  </span>
                </div>
                {!inv.disabled && (
                  <button className="btn sm danger" onClick={() => disableInvite(inv.id)}>
                    disable
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
