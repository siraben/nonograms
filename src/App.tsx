import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Attempt, CellState, LeaderboardEntry, Puzzle, ReplayMove, User } from "./types";
import { api } from "./api";
import * as Auth from "./auth";
import NonogramPlayer from "./NonogramPlayer";
import { getTurnstile } from "./turnstile";

type Route =
  | { name: "login" }
  | { name: "register" }
  | { name: "home" }
  | { name: "play"; attemptId: string }
  | { name: "replay"; attemptId: string };

function parseRoute(): Route {
  const h = (location.hash || "#/").replace(/^#/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "login") return { name: "login" };
  if (parts[0] === "register") return { name: "register" };
  if (parts[0] === "a" && parts[1]) return { name: "play", attemptId: parts[1] };
  if (parts[0] === "replay" && parts[1]) return { name: "replay", attemptId: parts[1] };
  return { name: "home" };
}

function nav(to: string) {
  location.hash = to;
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute());
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(true);
  const [toast, setToast] = useState<{ kind: "ok" | "bad"; msg: string } | null>(null);
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
    if (!user && route.name !== "login" && route.name !== "register") return { name: "login" } as Route;
    if (user && (route.name === "login" || route.name === "register")) return { name: "home" } as Route;
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
            className="theme-toggle"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          >
            {theme === "light" ? "dark" : "light"}
          </button>
          {user && (
            <>
              <div className="pill">{user.username}</div>
              <button className="btn danger" onClick={doLogout}>
                logout
              </button>
            </>
          )}
        </div>
      </div>

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}

      {authedRoute.name === "login" && (
        <AuthCard
          mode="login"
          onAuthed={async () => {
            setUser(await Auth.me());
            nav("/");
          }}
          onToast={setToast}
        />
      )}

      {authedRoute.name === "register" && (
        <AuthCard
          mode="register"
          onAuthed={async () => {
            setUser(await Auth.me());
            nav("/");
          }}
          onToast={setToast}
        />
      )}

      {authedRoute.name === "home" && <Home onToast={setToast} />}

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
        await Auth.register(username, password, captchaToken);
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
    <div className="card" style={{ maxWidth: 400, margin: "0 auto" }}>
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
            <label>Captcha</label>
            <div id="turnstile" style={{ minHeight: 70 }} />
            {(import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ? (
              <div className="muted" style={{ fontSize: 12 }}>
                {captchaReady ? "Verified" : "Pending..."}
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>
                Captcha disabled in dev
              </div>
            )}
          </div>
        )}
        {props.mode === "login" && (
          <label className="row muted" style={{ marginBottom: 12, fontSize: 13 }}>
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
    </div>
  );
}

function Home(props: { onToast: (t: { kind: "ok" | "bad"; msg: string } | null) => void }) {
  const [leader, setLeader] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  async function refreshLeader() {
    setLoading(true);
    try {
      const r = await api<{ leaderboard: LeaderboardEntry[] }>("/api/leaderboard");
      setLeader(r.leaderboard);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshLeader();
  }, []);

  async function newGame(puzzleId?: string) {
    props.onToast(null);
    try {
      const r = await api<{ attempt: { id: string } }>("/api/attempts/new", {
        method: "POST",
        json: puzzleId ? { puzzleId } : {},
      });
      nav(`/a/${r.attempt.id}`);
    } catch (err) {
      props.onToast({ kind: "bad", msg: (err as Error).message });
    }
  }

  return (
    <>
      <div className="card" style={{ textAlign: "center" }}>
        <button
          className="btn primary"
          style={{ fontSize: 16, padding: "12px 28px" }}
          onClick={() => void newGame()}
        >
          New Random 10x10
        </button>
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          Viewing a replay disqualifies you from that puzzle's leaderboard.
        </div>
      </div>

      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <h2 style={{ margin: 0 }}>Leaderboard</h2>
          <button
            className="btn"
            onClick={() => void refreshLeader()}
            style={{ fontSize: 12, padding: "4px 10px" }}
          >
            refresh
          </button>
        </div>
        {loading ? (
          <div className="muted">Loading...</div>
        ) : leader.length === 0 ? (
          <div className="muted">No runs yet. Be the first!</div>
        ) : (
          <div className="list">
            {leader.map((e, i) => (
              <div key={e.attemptId} className="item">
                <div className="title">
                  <span style={{ color: "var(--muted)", marginRight: 6 }}>#{i + 1}</span>
                  {e.username}
                  <span className="muted" style={{ marginLeft: 8 }}>
                    {(e.durationMs / 1000).toFixed(2)}s
                  </span>
                </div>
                <div className="meta">
                  puzzle {e.puzzleId.slice(0, 8)} &mdash;{" "}
                  {new Date(e.finishedAt).toLocaleDateString()}
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <button
                    className="btn"
                    style={{ fontSize: 12, padding: "4px 10px" }}
                    onClick={() => void newGame(e.puzzleId)}
                  >
                    play
                  </button>
                  <button
                    className="btn"
                    style={{ fontSize: 12, padding: "4px 10px" }}
                    onClick={() => nav(`/replay/${e.attemptId}`)}
                  >
                    replay
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await api<{ puzzle: Puzzle; attempt: Attempt }>(
          `/api/attempts/${encodeURIComponent(props.attemptId)}`
        );
        setPuzzle(r.puzzle);
        setAttempt(r.attempt);
      } catch (err) {
        props.onToast({ kind: "bad", msg: (err as Error).message });
      } finally {
        setLoading(false);
      }
    })();
  }, [props.attemptId]);

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <button className="btn" onClick={() => nav("/")}>
          &larr; Back
        </button>
      </div>
      <div className="card">
        {loading && <div className="muted">Loading puzzle...</div>}
        {puzzle && attempt && (
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
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [moves, setMoves] = useState<ReplayMove[]>([]);
  const [meta, setMeta] = useState<{ username: string; durationMs: number | null } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [state, setState] = useState<CellState[]>(
    Array.from({ length: 100 }, () => 0 as CellState)
  );
  const timer = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      setPlaying(false);
      setPos(0);
      if (timer.current) window.clearInterval(timer.current);
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
      } catch (err) {
        props.onToast({ kind: "bad", msg: (err as Error).message });
      }
    })();
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [props.attemptId]);

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
  }

  function play() {
    if (!puzzle) return;
    if (timer.current) window.clearInterval(timer.current);
    setPlaying(true);
    let i = pos;
    timer.current = window.setInterval(() => {
      i++;
      if (i > moves.length) {
        if (timer.current) window.clearInterval(timer.current);
        setPlaying(false);
        return;
      }
      applyTo(i);
    }, 120);
  }

  function pause() {
    if (timer.current) window.clearInterval(timer.current);
    setPlaying(false);
  }

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <button className="btn" onClick={() => nav("/")}>
          &larr; Back
        </button>
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
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
          <span className="muted" style={{ fontSize: 13 }}>
            {meta ? (
              <>
                {meta.username} &mdash;{" "}
                {meta.durationMs ? `${(meta.durationMs / 1000).toFixed(2)}s` : "?"} &mdash;{" "}
                {pos}/{moves.length} moves
              </>
            ) : (
              "Loading..."
            )}
          </span>
        </div>
        <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>
          Viewing a replay disqualifies future leaderboard runs for this puzzle.
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
      </div>
    </>
  );
}
