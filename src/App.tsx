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

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const u = await Auth.me();
        setUser(u);
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
        <div className="brand">
          <h1>nonogram</h1>
          <div className="tag">friends-only puzzle room</div>
        </div>
        <div className="row">
          {user ? (
            <>
              <div className="pill">
                <span className="muted">user</span>
                <span>{user.username}</span>
              </div>
              <button className="btn danger" onClick={doLogout}>
                logout
              </button>
            </>
          ) : (
            <div className="pill muted">not logged in</div>
          )}
        </div>
      </div>

      {toast ? <div className={`toast ${toast.kind}`}>{toast.msg}</div> : null}

      {authedRoute.name === "login" ? (
        <AuthCard
          mode="login"
          onAuthed={async () => {
            const u = await Auth.me();
            setUser(u);
            nav("/");
          }}
          onToast={setToast}
        />
      ) : null}

      {authedRoute.name === "register" ? (
        <AuthCard
          mode="register"
          onAuthed={async () => {
            const u = await Auth.me();
            setUser(u);
            nav("/");
          }}
          onToast={setToast}
        />
      ) : null}

      {authedRoute.name === "home" ? <Home onToast={setToast} /> : null}

      {authedRoute.name === "play" ? (
        <Play attemptId={authedRoute.attemptId} onToast={setToast} />
      ) : null}

      {authedRoute.name === "replay" ? (
        <Replay attemptId={authedRoute.attemptId} onToast={setToast} />
      ) : null}
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
  const [captchaToken, setCaptchaToken] = useState<string>("");
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
        theme: "dark",
        callback: (token) => {
          setCaptchaToken(token);
          setCaptchaReady(true);
        },
        "expired-callback": () => {
          setCaptchaToken("");
          setCaptchaReady(false);
          if (widgetId) t.reset(widgetId);
        }
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
        if (siteKey && !captchaToken) throw new Error("complete captcha");
        await Auth.register(username, password, captchaToken);
      }
      props.onToast({ kind: "ok", msg: props.mode === "login" ? "logged in" : "account created" });
      props.onAuthed();
    } catch (err) {
      props.onToast({ kind: "bad", msg: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid2">
      <div className="card">
        <h2>{props.mode === "login" ? "Login" : "Register"}</h2>
        <form onSubmit={submit}>
          <div className="field">
            <label>username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </div>
          <div className="field">
            <label>password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete={props.mode === "login" ? "current-password" : "new-password"}
            />
          </div>
          {props.mode === "register" ? (
            <div className="field">
              <label className="row">
                <span>captcha</span>
                <span className="muted">(turnstile)</span>
              </label>
              <div id="turnstile" style={{ minHeight: 70 }} />
              {(import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ? (
                <div className="muted">{captchaReady ? "ok" : "pending..."}</div>
              ) : (
                <div className="muted">VITE_TURNSTILE_SITE_KEY not set (captcha disabled in dev)</div>
              )}
            </div>
          ) : null}
          {props.mode === "login" ? (
            <label className="row muted" style={{ marginBottom: 10 }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              remember me
            </label>
          ) : null}

          <div className="row">
            <button
              className="btn primary"
              disabled={
                submitting ||
                (props.mode === "register" && Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY) && !captchaReady)
              }
            >
              {props.mode === "login" ? "login" : "create account"}
            </button>
            {props.mode === "login" ? (
              <button type="button" className="btn" onClick={() => nav("/register")}>
                register
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => nav("/login")}>
                back to login
              </button>
            )}
          </div>
        </form>
      </div>

	      <div className="card">
	        <h2>Notes</h2>
	        <div className="muted">
	          <div>Passwords are stored as salted PBKDF2 hashes.</div>
	        </div>
	      </div>
    </div>
  );
}

function Home(props: { onToast: (t: { kind: "ok" | "bad"; msg: string } | null) => void }) {
  const [leader, setLeader] = useState<LeaderboardEntry[]>([]);
  const [loadingLeader, setLoadingLeader] = useState(true);

  async function refreshLeader() {
    setLoadingLeader(true);
    try {
      const r = await api<{ leaderboard: LeaderboardEntry[] }>("/api/leaderboard");
      setLeader(r.leaderboard);
    } finally {
      setLoadingLeader(false);
    }
  }

  useEffect(() => {
    void refreshLeader();
  }, []);

  async function newGame(puzzleId?: string) {
    props.onToast(null);
    try {
      const r = await api<{ attempt: { id: string } }>("/api/attempts/new", { method: "POST", json: puzzleId ? { puzzleId } : {} });
      nav(`/a/${r.attempt.id}`);
    } catch (err) {
      props.onToast({ kind: "bad", msg: (err as Error).message });
    }
  }

  return (
    <div className="grid2">
      <div className="card">
        <h2>Play</h2>
        <div className="row">
          <button className="btn primary" onClick={() => void newGame()}>
            new random 10x10
          </button>
        </div>
        <div className="muted" style={{ marginTop: 10 }}>
          Leaderboard runs are disabled if you have viewed a replay for that puzzle.
        </div>
      </div>

      <div className="card">
        <h2>Leaderboard</h2>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="muted">{loadingLeader ? "loading..." : `${leader.length} runs`}</div>
          <button className="btn" onClick={() => void refreshLeader()}>
            refresh
          </button>
        </div>
        <div className="list" style={{ marginTop: 10 }}>
          {leader.map((e) => (
            <div key={e.attemptId} className="item">
              <div className="title">
                {e.username}{" "}
                <span className="muted">
                  {(e.durationMs / 1000).toFixed(2)}s
                </span>
              </div>
              <div className="meta">
                puzzle {e.puzzleId.slice(0, 8)} · finished {new Date(e.finishedAt).toLocaleString()}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn" onClick={() => void newGame(e.puzzleId)}>
                  play this puzzle
                </button>
                <button className="btn" onClick={() => nav(`/replay/${e.attemptId}`)}>
                  view replay
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Play(props: { attemptId: string; onToast: (t: { kind: "ok" | "bad"; msg: string } | null) => void }) {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await api<{ puzzle: Puzzle; attempt: Attempt }>(`/api/attempts/${encodeURIComponent(props.attemptId)}`);
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
    <div className="grid2">
      <div className="card">
        <h2>Navigation</h2>
        <div className="row">
          <button className="btn" onClick={() => nav("/")}>
            back
          </button>
        </div>
      </div>
      <div className="card">
        <h2>Play</h2>
        {loading ? <div className="muted">loading...</div> : null}
        {puzzle && attempt ? (
          <NonogramPlayer
            attemptId={attempt.id}
            eligible={attempt.eligible}
            puzzle={puzzle}
            initialState={attempt.state}
            onToast={props.onToast}
          />
        ) : null}
      </div>
    </div>
  );
}

function Replay(props: { attemptId: string; onToast: (t: { kind: "ok" | "bad"; msg: string } | null) => void }) {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [moves, setMoves] = useState<ReplayMove[]>([]);
  const [meta, setMeta] = useState<{ username: string; durationMs: number | null } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0); // move index
  const [state, setState] = useState<CellState[]>(Array.from({ length: 100 }, () => 0 as CellState));
  const timer = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      setPlaying(false);
      setPos(0);
      if (timer.current) window.clearInterval(timer.current);
      try {
        const r = await api<{ puzzle: Puzzle; moves: ReplayMove[]; attempt: { username: string; durationMs: number | null } }>(
          `/api/replay/${encodeURIComponent(props.attemptId)}`
        );
        setPuzzle(r.puzzle);
        setMoves(r.moves);
        setMeta({ username: r.attempt.username, durationMs: r.attempt.durationMs });
        setState(Array.from({ length: r.puzzle.width * r.puzzle.height }, () => 0 as CellState));
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
    const next = Array.from({ length: puzzle.width * puzzle.height }, () => 0 as CellState);
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
    <div className="grid2">
      <div className="card">
        <h2>Replay</h2>
        <div className="row">
          <button className="btn" onClick={() => nav("/")}>
            back
          </button>
          <button className="btn" onClick={() => (playing ? pause() : play())} disabled={!moves.length}>
            {playing ? "pause" : "play"}
          </button>
          <button className="btn" onClick={() => applyTo(0)} disabled={!moves.length}>
            reset
          </button>
        </div>
        <div className="muted" style={{ marginTop: 10 }}>
          {meta ? (
            <>
              {meta.username} · {meta.durationMs ? `${(meta.durationMs / 1000).toFixed(2)}s` : "?"} · moves {pos}/{moves.length}
            </>
          ) : (
            "loading..."
          )}
        </div>
        <div className="muted" style={{ marginTop: 10 }}>
          Viewing a replay disqualifies you from leaderboard runs for this puzzle.
        </div>
      </div>
      <div className="card">
        <h2>Board</h2>
        {puzzle ? (
          <NonogramPlayer
            attemptId={"_replay"}
            eligible={false}
            puzzle={puzzle}
            initialState={state}
            readonly
            onToast={props.onToast}
          />
        ) : null}
      </div>
    </div>
  );
}
