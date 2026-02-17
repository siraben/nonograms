import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Attempt, CellState, LeaderboardEntry, Puzzle, ReplayMove, User } from "./types";
import { api } from "./api";
import { computeKdePath } from "../lib/kde";
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
  | { name: "offline-play"; size: number }
  | { name: "privacy" }
  | { name: "my-games" };

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
  if (parts[0] === "privacy") return { name: "privacy" };
  if (parts[0] === "my-games") return { name: "my-games" };
  if (parts[0] === "offline" && parts[1]) {
    const size = parseInt(parts[1], 10);
    if (size === 5 || size === 10 || size === 15 || size === 20) return { name: "offline-play", size };
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

// Based on Lucide "share" (ISC license): https://lucide.dev/icons/share
function ShareIcon(props: { title?: string }) {
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
        d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="16 6 12 2 8 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="12" y1="2" x2="12" y2="15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
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
  const [changePwOpen, setChangePwOpen] = useState(false);
  const online = useOnline();
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("nonogram-theme");
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    if (!toast) return;
    const ms = toast.kind === "ok" ? 3000 : 5000;
    const id = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(id);
  }, [toast]);

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
    if (!user && route.name !== "login" && route.name !== "register" && route.name !== "offline-play" && route.name !== "replay" && route.name !== "privacy") return { name: "login" } as Route;
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
            className="btn icon-btn"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            {theme === "light" ? <SunIcon /> : <MoonIcon />}
          </button>
          <button
            className="btn icon-btn"
            onClick={() => setHelpOpen(true)}
            aria-label="Help"
            title="Help"
          >
            <HelpIcon />
          </button>
          {!online && <div className="pill pill-muted">offline</div>}
          {user && (
            <>
              <button className="btn sm" onClick={() => nav("/my-games")}>
                my games
              </button>
              {user.isAdmin && (
                <button className="btn sm" onClick={() => nav("/admin")}>
                  admin
                </button>
              )}
              <div className="pill pill-clickable" onClick={() => setChangePwOpen(true)}>{user.username}</div>
              <button className="btn danger icon-btn" onClick={doLogout} aria-label="Log out" title="Log out">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5 1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h2M9 10l3-3-3-3M12 7H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
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

      {changePwOpen && (
        <ChangePasswordModal
          onClose={() => setChangePwOpen(false)}
          onToast={setToast}
        />
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}

      {busy && route.name !== "login" && route.name !== "register" && route.name !== "offline-play" && route.name !== "replay" && route.name !== "privacy" && (
        <div className="card"><div className="muted">Loading...</div></div>
      )}

      {authedRoute.name === "login" && (
        <div className={online ? "login-layout" : undefined}>
          <AuthCard
            mode="login"
            onAuthed={async () => {
              setUser(await Auth.me());
              nav("/");
            }}
            onToast={setToast}
          />
          {online && <PublicLeaderboard />}
        </div>
      )}

      {authedRoute.name === "register" && (
        <div className={online ? "login-layout" : undefined}>
          <AuthCard
            mode="register"
            onAuthed={async () => {
              setUser(await Auth.me());
              nav("/");
            }}
            onToast={setToast}
          />
          {online && <PublicLeaderboard />}
        </div>
      )}

      {!busy && authedRoute.name === "admin" && <AdminDashboard onToast={setToast} />}

      {!busy && authedRoute.name === "my-games" && <MyGames onToast={setToast} />}

      {!busy && authedRoute.name === "home" && <Home online={online} onToast={setToast} />}

      {authedRoute.name === "offline-play" && (
        <OfflinePlay size={authedRoute.size} onToast={setToast} />
      )}

      {!busy && authedRoute.name === "play" && (
        <Play attemptId={authedRoute.attemptId} onToast={setToast} currentUser={user?.username} />
      )}

      {authedRoute.name === "replay" && (
        <Replay attemptId={authedRoute.attemptId} onToast={setToast} currentUser={user?.username} />
      )}

      {authedRoute.name === "privacy" && <PrivacyPolicy />}

      <footer className="site-footer hint">
        <a href="#/privacy">Privacy</a>
        <span>&middot;</span>
        <a href="https://github.com/siraben/nonograms" target="_blank" rel="noopener noreferrer">Source</a>
      </footer>
    </div>
  );
}

function ChangePasswordModal(props: {
  onClose: () => void;
  onToast: (t: { kind: "ok" | "bad"; msg: string } | null) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    props.onToast(null);
    setSubmitting(true);
    try {
      await Auth.changePassword(currentPassword, newPassword);
      props.onToast({ kind: "ok", msg: "Password changed" });
      props.onClose();
    } catch (err) {
      props.onToast({ kind: "bad", msg: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Change password">
        <div className="modal-head">
          <div className="modal-title">Change password</div>
          <button className="modal-close" onClick={props.onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <div className="modal-body">
          <form onSubmit={submit}>
            <div className="field">
              <label>Current password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="field">
              <label>New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="row">
              <button className="btn primary" disabled={submitting}>
                {submitting ? "Saving..." : "Save"}
              </button>
              <button type="button" className="btn" onClick={props.onClose}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function PrivacyPolicy() {
  return (
    <div className="card card-narrow">
      <h2>Privacy Policy</h2>
      <div className="help-text">
        <p><strong>What we store</strong></p>
        <ul>
          <li>Your username and a salted hash of your password (we never store your password in plain text)</li>
          <li>Session tokens to keep you logged in</li>
          <li>Your puzzle attempts, moves, and solve times</li>
        </ul>

        <p style={{ marginTop: 12 }}><strong>What we don't store</strong></p>
        <ul>
          <li>Your IP address is not stored in our database. During registration, it is passed to Cloudflare Turnstile for captcha verification but is not retained by us.</li>
          <li>No cookies are used for tracking. The only stored credential is a session token in localStorage.</li>
          <li>No analytics or third-party tracking scripts are loaded.</li>
        </ul>

        <p style={{ marginTop: 12 }}><strong>Hosting</strong></p>
        <ul>
          <li>This site is hosted on Cloudflare Pages. Cloudflare may collect standard web server logs (IP addresses, request timestamps) as part of their infrastructure. See <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>Cloudflare's privacy policy</a>.</li>
        </ul>

        <p style={{ marginTop: 12 }}><strong>Data deletion</strong></p>
        <ul>
          <li>Contact the site administrator to request deletion of your account and all associated data.</li>
        </ul>

      </div>
      <div className="gap-above">
        <button className="btn" onClick={() => history.back()}>&larr; Back</button>
      </div>
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
        theme: "auto",
        appearance: "interaction-only",
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
          (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ? (
            <div id="turnstile" className="turnstile-wrap" />
          ) : (
            <div className="hint gap-below">
              Captcha disabled in dev
            </div>
          )
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
            5x5
          </button>
          <button type="button" className="btn sm" onClick={() => nav("/offline/10")}>
            10x10
          </button>
          <button type="button" className="btn sm" onClick={() => nav("/offline/15")}>
            15x15
          </button>
          <button type="button" className="btn sm" onClick={() => nav("/offline/20")}>
            20x20
          </button>
        </div>
      </div>
    </div>
  );
}

type PublicEntry = { username: string; durationMs: number; finishedAt: string; width: number; height: number; kdePath?: string };

function PublicLeaderboard() {
  const [entries5, setEntries5] = useState<PublicEntry[]>([]);
  const [entries10, setEntries10] = useState<PublicEntry[]>([]);
  const [entries15, setEntries15] = useState<PublicEntry[]>([]);
  const [entries20, setEntries20] = useState<PublicEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [signupPrompt, setSignupPrompt] = useState(false);
  const [tab, setTab] = useState<"5" | "10" | "15" | "20">("5");

  useEffect(() => {
    (async () => {
      try {
        const r = await api<{ leaderboard5: PublicEntry[]; leaderboard10: PublicEntry[]; leaderboard15: PublicEntry[]; leaderboard20: PublicEntry[] }>("/api/leaderboard/public?period=day");
        setEntries5(r.leaderboard5);
        setEntries10(r.leaderboard10);
        setEntries15(r.leaderboard15);
        setEntries20(r.leaderboard20);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const medal = (i: number) => i === 0 ? "\u{1F947}" : i === 1 ? "\u{1F948}" : "\u{1F949}";
  const entries = tab === "5" ? entries5 : tab === "10" ? entries10 : tab === "15" ? entries15 : entries20;
  const label = tab === "5" ? "5x5" : tab === "10" ? "10x10" : tab === "15" ? "15x15" : "20x20";

  return (
    <>
      <div className="card">
        <h2>Today's Leaderboard</h2>
        <div className="btn-group" style={{ marginBottom: 8 }}>
          <button className={`btn sm${tab === "5" ? " primary" : ""}`} onClick={() => setTab("5")}>5x5</button>
          <button className={`btn sm${tab === "10" ? " primary" : ""}`} onClick={() => setTab("10")}>10x10</button>
          <button className={`btn sm${tab === "15" ? " primary" : ""}`} onClick={() => setTab("15")}>15x15</button>
          <button className={`btn sm${tab === "20" ? " primary" : ""}`} onClick={() => setTab("20")}>20x20</button>
        </div>
        {loading ? (
          <div className="muted">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="muted" style={{ textAlign: "center" }}>Sign up to be the first!</div>
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
                  {e.kdePath && (
                    <svg className="mini-kde" viewBox="0 0 100 28" preserveAspectRatio="none"><path d={e.kdePath} /></svg>
                  )}
                </div>
              </div>
            ))}
            <div className="item blurred-item" aria-hidden="true" onClick={() => setSignupPrompt(true)}>
              <div className="title">#4 Mysterious Player <span className="muted" style={{ marginLeft: 8 }}>??:??s</span></div>
              <div className="meta">Sign up to see more</div>
            </div>
          </div>
        )}
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

type Period = "day" | "week" | "month" | "all";
const PERIOD_LABELS: Record<Period, string> = { day: "Daily", week: "Weekly", month: "Monthly", all: "All time" };

function Home(props: { online: boolean; onToast: (t: { kind: "ok" | "bad"; msg: string } | null) => void }) {
  const [leader5, setLeader5] = useState<LeaderboardEntry[]>([]);
  const [leader10, setLeader10] = useState<LeaderboardEntry[]>([]);
  const [leader15, setLeader15] = useState<LeaderboardEntry[]>([]);
  const [leader20, setLeader20] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>(() => {
    const saved = localStorage.getItem("leaderboard-period");
    return saved === "day" || saved === "week" || saved === "month" || saved === "all" ? saved : "day";
  });
  const [page5, setPage5] = useState(0);
  const [page10, setPage10] = useState(0);
  const [page15, setPage15] = useState(0);
  const [page20, setPage20] = useState(0);
  const PAGE_SIZE = 10;
  const leaderColsRef = useRef<HTMLDivElement>(null);
  const leaderWrapRef = useRef<HTMLDivElement>(null);

  const updateScrollHints = useCallback(() => {
    const el = leaderColsRef.current;
    const wrap = leaderWrapRef.current;
    if (!el || !wrap) return;
    wrap.classList.toggle("can-scroll-left", el.scrollLeft > 2);
    wrap.classList.toggle("can-scroll-right", el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = leaderColsRef.current;
    if (!el) return;
    updateScrollHints();
    el.addEventListener("scroll", updateScrollHints, { passive: true });
    window.addEventListener("resize", updateScrollHints);
    return () => { el.removeEventListener("scroll", updateScrollHints); window.removeEventListener("resize", updateScrollHints); };
  }, [updateScrollHints]);

  useEffect(() => {
    if (!props.online) return;
    setLoading(true);
    const es = new EventSource(`/api/leaderboard/stream?period=${period}`);
    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as { leaderboard5: LeaderboardEntry[]; leaderboard10: LeaderboardEntry[]; leaderboard15: LeaderboardEntry[]; leaderboard20: LeaderboardEntry[] };
      setLeader5(data.leaderboard5);
      setLeader10(data.leaderboard10);
      setLeader15(data.leaderboard15);
      setLeader20(data.leaderboard20);
      setLoading(false);
      requestAnimationFrame(updateScrollHints);
    };
    es.onerror = () => {
      setLoading(false);
    };
    return () => es.close();
  }, [props.online, period]);

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
          <div className="hint gap-below">
            <strong>Offline mode</strong> — puzzles generated locally, no leaderboard.
          </div>
        )}
        <div className="btn-group">
          <button
            className="btn primary lg"
            onClick={() => props.online ? void newGame(undefined, 5) : nav("/offline/5")}
          >
            5x5
          </button>
          <button
            className="btn primary lg"
            onClick={() => props.online ? void newGame(undefined, 10) : nav("/offline/10")}
          >
            10x10
          </button>
          <button
            className="btn primary lg"
            onClick={() => props.online ? void newGame(undefined, 15) : nav("/offline/15")}
          >
            15x15
          </button>
          <button
            className="btn primary lg"
            onClick={() => props.online ? void newGame(undefined, 20) : nav("/offline/20")}
          >
            20x20
          </button>
        </div>
        {props.online && (
          <div className="hint gap-above">
            Watching a replay means your times won't count for that puzzle's leaderboard.
          </div>
        )}
      </div>

      {props.online && (
        <>
        <div className="btn-group period-toggle">
          {(["day", "week", "month", "all"] as const).map((p) => (
            <button
              key={p}
              className={`btn sm${period === p ? " primary" : ""}`}
              onClick={() => { setPeriod(p); localStorage.setItem("leaderboard-period", p); setPage5(0); setPage10(0); setPage15(0); setPage20(0); }}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        <div className="leaderboard-nav">
          <button
            className="btn sm icon-btn"
            onClick={() => { const el = leaderColsRef.current; if (el) el.scrollBy({ left: -el.clientWidth, behavior: "smooth" }); }}
            aria-label="Scroll leaderboard left"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <span className="muted">Leaderboards</span>
          <button
            className="btn sm icon-btn"
            onClick={() => { const el = leaderColsRef.current; if (el) el.scrollBy({ left: el.clientWidth, behavior: "smooth" }); }}
            aria-label="Scroll leaderboard right"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
        <div className="leaderboard-wrap" ref={leaderWrapRef}>
        <div className="leaderboard-cols" ref={leaderColsRef}>
          {([["5x5", leader5, page5, setPage5], ["10x10", leader10, page10, setPage10], ["15x15", leader15, page15, setPage15], ["20x20", leader20, page20, setPage20]] as [string, LeaderboardEntry[], number, (n: number) => void][]).map(([label, entries, page, setPage]) => {
            const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
            const pageEntries = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
            const rankOffset = page * PAGE_SIZE;
            return (
            <div key={label} className="card">
              <div className="card-header-row">
                <h2>{label} Leaderboard</h2>
                {entries.length > PAGE_SIZE && (
                  <div className="pagination">
                    <button className="btn sm icon-btn" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                    <span className="pagination-info">{page + 1}/{totalPages}</span>
                    <button className="btn sm icon-btn" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} aria-label="Next page">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                  </div>
                )}
              </div>
              {loading ? (
                <div className="muted">Loading...</div>
              ) : entries.length === 0 ? (
                <div className="muted">No runs yet. Be the first!</div>
              ) : (
                <div className="list">
                  {pageEntries.map((e, i) => {
                    const rank = rankOffset + i;
                    return (
                    <div key={e.attemptId} className="item">
                      <div className="title">
                        <span style={{ marginRight: 6 }}>{rank < 3 ? ["\u{1F947}", "\u{1F948}", "\u{1F949}"][rank] : `#${rank + 1}`}</span>
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
                        {e.kdePath && (
                          <svg className="mini-kde" viewBox="0 0 100 28" preserveAspectRatio="none"><path d={e.kdePath} /></svg>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
            );
          })}
        </div>
        </div>
        </>
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
        <h2>Offline</h2>
        <NonogramPlayer
          attemptId={`offline-${key}`}
          eligible={false}
          puzzle={puzzle}
          initialState={initialState}
          startedAt={startedAt}
          offline
          onToast={props.onToast}
        />
        <div className="check-area">
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
  currentUser?: string;
}) {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [finished, setFinished] = useState(false);

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

  if (finished && puzzle) {
    return (
      <Replay
        attemptId={props.attemptId}
        onToast={props.onToast}
        skipConfirm
        autoPlay
        finishedSize={puzzle.width}
        currentUser={props.currentUser}
      />
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
        <h2>Play</h2>
        {loading && <div className="muted">Loading...</div>}
        {notStarted && dims && (
          <div className="start-gate">
            <div className="start-grid" style={{
              gridTemplateColumns: `repeat(${dims.width}, auto)`,
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
            onSolved={() => setFinished(true)}
          />
        )}
      </div>
    </>
  );
}

function ScrubberKDE(props: { moves: ReplayMove[] }) {
  const path = useMemo(() => {
    const { moves } = props;
    if (moves.length < 2) return "";
    const totalMs = moves[moves.length - 1].atMs || 1;
    return computeKdePath(moves.map((m) => m.atMs), totalMs);
  }, [props.moves]);

  if (!path) return null;
  return (
    <svg
      className="scrubber-kde"
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
    >
      <path d={path} />
    </svg>
  );
}

function Replay(props: {
  attemptId: string;
  onToast: (t: { kind: "ok" | "bad"; msg: string } | null) => void;
  skipConfirm?: boolean;
  autoPlay?: boolean;
  finishedSize?: number;
  currentUser?: string;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [checking, setChecking] = useState(true);
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
  const [shouldAutoPlay, setShouldAutoPlay] = useState(false);
  const wantAutoPlay = useRef(false);
  const raf = useRef<number | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Check if user already viewed this puzzle's replay
  useEffect(() => {
    if (props.skipConfirm) {
      wantAutoPlay.current = !!props.autoPlay;
      setConfirmed(true);
      setChecking(false);
      return;
    }
    (async () => {
      setChecking(true);
      try {
        const r = await api<{ alreadyViewed: boolean; isOwn: boolean }>(
          `/api/replay/${encodeURIComponent(props.attemptId)}/check`
        );
        if (r.alreadyViewed || r.isOwn) {
          setConfirmed(true);
        } else {
          setShowConfirmModal(true);
        }
      } catch {
        // If check fails (e.g. not logged in for public replays), skip the modal
        setConfirmed(true);
      } finally {
        setChecking(false);
      }
    })();
  }, [props.attemptId]);

  useEffect(() => {
    if (!confirmed) return;
    (async () => {
      setPlaying(false);
      setPos(0);
      if (raf.current) cancelAnimationFrame(raf.current);
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
        if (wantAutoPlay.current) {
          wantAutoPlay.current = false;
          setShouldAutoPlay(true);
        }
      } catch (err) {
        props.onToast({ kind: "bad", msg: (err as Error).message });
      }
    })();
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [props.attemptId, confirmed]);

  // Auto-play replay when arriving from a just-finished game
  useEffect(() => {
    if (shouldAutoPlay && moves.length > 0 && puzzle) {
      setShouldAutoPlay(false);
      play();
    }
  }, [shouldAutoPlay, moves, puzzle]);

  // Auto-scroll timeline to current move (within the timeline container only)
  useEffect(() => {
    const container = timelineRef.current;
    if (!container) return;
    const active = container.querySelector("[data-active]") as HTMLElement | null;
    if (active) {
      const ct = container.getBoundingClientRect();
      const at = active.getBoundingClientRect();
      if (at.top < ct.top) {
        container.scrollTop += at.top - ct.top;
      } else if (at.bottom > ct.bottom) {
        container.scrollTop += at.bottom - ct.bottom;
      }
    }
  }, [pos]);

  function applyTo(k: number, timeMs?: number) {
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
    setReplayElapsed(timeMs ?? (k > 0 && moves[k - 1] ? moves[k - 1].atMs : 0));
  }

  // Find the move index for a given time (number of moves with atMs <= timeMs)
  function moveIdxAtTime(timeMs: number): number {
    let idx = 0;
    for (let j = 0; j < moves.length; j++) {
      if (moves[j].atMs <= timeMs) idx = j + 1;
      else break;
    }
    return idx;
  }

  function play() {
    if (!puzzle || !moves.length) return;
    if (raf.current) cancelAnimationFrame(raf.current);
    setPlaying(true);

    const endMs = moves[moves.length - 1].atMs;
    // Scale replay: cap total duration between 10s and 45s, but never slower than real-time
    const span = endMs - moves[0].atMs;
    const baseScale = Math.min(1, span < 10000 ? 10000 / Math.max(span, 1) :
                      span > 45000 ? 45000 / span : 1);

    // If replay already finished, reset to beginning
    let simMs = replayElapsed;
    let lastIdx = pos;
    if (simMs >= endMs) {
      applyTo(0);
      simMs = 0;
      lastIdx = 0;
    }
    let prev: number | null = null;

    function frame(ts: number) {
      if (prev === null) { prev = ts; raf.current = requestAnimationFrame(frame); return; }
      const dt = ts - prev;
      prev = ts;
      const scale = realtimeRef.current ? 1 : baseScale;
      simMs += dt / scale;
      if (simMs >= endMs) {
        applyTo(moves.length, endMs);
        setPlaying(false);
        setReplayElapsed(endMs);
        return;
      }
      setReplayElapsed(simMs);
      const idx = moveIdxAtTime(simMs);
      if (idx !== lastIdx) { lastIdx = idx; applyTo(idx, simMs); }
      raf.current = requestAnimationFrame(frame);
    }
    raf.current = requestAnimationFrame(frame);
  }

  function pause() {
    if (raf.current) cancelAnimationFrame(raf.current);
    setPlaying(false);
  }

  async function shareReplay() {
    const url = `${location.origin}/s/${props.attemptId}`;
    const size = puzzle ? `${puzzle.width}x${puzzle.height}` : "?x?";
    const time = meta?.durationMs ? `${(meta.durationMs / 1000).toFixed(2)}s` : "?s";
    const isOwn = props.currentUser && meta?.username === props.currentUser;
    const who = isOwn ? "I" : (meta?.username ?? "Someone");
    const verb = isOwn ? "Try to beat my time or watch my replay" : "Watch the replay";
    const text = `${who} solved a ${size} nonogram in ${time}! ${verb} at ${url}`;
    await navigator.clipboard.writeText(text);
    props.onToast({ kind: "ok", msg: "Copied to clipboard!" });
  }

  async function startNewGame() {
    try {
      const r = await api<{ attempt: { id: string } }>("/api/attempts/new", {
        method: "POST",
        json: { size: props.finishedSize },
      });
      nav(`/a/${r.attempt.id}`);
    } catch (err) {
      props.onToast({ kind: "bad", msg: (err as Error).message });
    }
  }

  if (checking) {
    return (
      <>
        <div className="back-nav">
          <button className="btn" onClick={() => nav("/")}>
            &larr; Back
          </button>
        </div>
        <div className="card"><div className="muted">Loading...</div></div>
      </>
    );
  }

  return (
    <>
      {showConfirmModal && (
        <div
          className="modal-overlay"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) { setShowConfirmModal(false); nav("/"); } }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-label="Watch replay">
            <div className="modal-head">
              <div className="modal-title">Watch replay?</div>
              <button className="modal-close" onClick={() => { setShowConfirmModal(false); nav("/"); }} aria-label="Close">&times;</button>
            </div>
            <div className="modal-body">
              <p className="help-text">
                If you watch this replay, your times for this puzzle won't count for the leaderboard.
              </p>
              <div className="btn-group" style={{ marginTop: 12 }}>
                <button className="btn primary" onClick={() => { setShowConfirmModal(false); setConfirmed(true); }}>
                  Watch anyway
                </button>
                <button className="btn" onClick={() => { setShowConfirmModal(false); nav("/"); }}>
                  Go back
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="back-nav">
        <button className="btn" onClick={() => nav("/")}>
          &larr; Back
        </button>
      </div>
      <div className="card">
        <div className="card-header-row">
          <h2>{meta ? `${meta.username}'s Replay` : "Replay"}</h2>
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn icon-btn"
              onClick={shareReplay}
              aria-label="Share replay"
              title="Share replay"
            >
              <ShareIcon />
            </button>
            {props.finishedSize && (
              <button className="btn primary sm" onClick={startNewGame}>
                Play {props.finishedSize}&times;{props.finishedSize}
              </button>
            )}
          </div>
        </div>
        {meta && (
          <div className="replay-meta">
            <span>{(replayElapsed / 1000).toFixed(1)}s{meta.durationMs ? ` / ${(meta.durationMs / 1000).toFixed(1)}s` : ""}</span>
            <span className="muted">{pos}/{moves.length} moves</span>
          </div>
        )}
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
            <div className="scrubber-row">
              <div className="transport-btns">
                <button
                  className="btn icon-btn"
                  onClick={() => { applyTo(0); if (playing) play(); }}
                  disabled={!moves.length}
                  aria-label="Reset"
                  title="Reset"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 3v8M5 7l5-4v8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                <button
                  className="btn icon-btn"
                  onClick={() => (playing ? pause() : play())}
                  disabled={!moves.length}
                  aria-label={playing ? "Pause" : "Play"}
                  title={playing ? "Pause" : "Play"}
                >
                  {playing ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M4 2v10M10 2v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 2l9 5-9 5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  )}
                </button>
              </div>
            <div
              className="scrubber"
              onMouseDown={(e) => {
                const track = e.currentTarget;
                if (playing) pause();
                let lastIdx = pos;
                const scrub = (clientX: number) => {
                  const rect = track.getBoundingClientRect();
                  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                  const totalMs = moves[moves.length - 1].atMs || 1;
                  const timeMs = pct * totalMs;
                  setReplayElapsed(timeMs);
                  const idx = moveIdxAtTime(timeMs);
                  if (idx !== lastIdx) { lastIdx = idx; applyTo(idx, timeMs); }
                };
                scrub(e.clientX);
                const onMove = (ev: MouseEvent) => scrub(ev.clientX);
                const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              }}
              onTouchStart={(e) => {
                const track = e.currentTarget;
                if (playing) pause();
                let lastIdx = pos;
                const scrub = (clientX: number) => {
                  const rect = track.getBoundingClientRect();
                  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                  const totalMs = moves[moves.length - 1].atMs || 1;
                  const timeMs = pct * totalMs;
                  setReplayElapsed(timeMs);
                  const idx = moveIdxAtTime(timeMs);
                  if (idx !== lastIdx) { lastIdx = idx; applyTo(idx, timeMs); }
                };
                scrub(e.touches[0].clientX);
                const onMove = (ev: TouchEvent) => { ev.preventDefault(); scrub(ev.touches[0].clientX); };
                const onEnd = () => { document.removeEventListener("touchmove", onMove); document.removeEventListener("touchend", onEnd); };
                document.addEventListener("touchmove", onMove, { passive: false });
                document.addEventListener("touchend", onEnd);
              }}
            >
              <div className="scrubber-track">
                <ScrubberKDE moves={moves} />
                {(() => {
                  const totalMs = moves[moves.length - 1].atMs || 1;
                  const fillPct = (replayElapsed / totalMs) * 100;
                  return <div className="scrubber-fill" style={{ width: `${fillPct}%` }} />;
                })()}
                {moves.map((m, i) => {
                  const totalMs = moves[moves.length - 1].atMs || 1;
                  const pct = (m.atMs / totalMs) * 100;
                  return (
                    <div
                      key={m.seq}
                      className={`scrubber-dot${i + 1 <= pos ? " scrubber-dot-past" : ""}`}
                      style={{ left: `${pct}%` }}
                    />
                  );
                })}
                <div
                  className="scrubber-handle"
                  style={{ left: `${moves.length ? (replayElapsed / (moves[moves.length - 1].atMs || 1)) * 100 : 0}%` }}
                />
              </div>
            </div>
              <label className="realtime-toggle muted">
                <input
                  type="checkbox"
                  checked={realtime}
                  onChange={(e) => { setRealtime(e.target.checked); realtimeRef.current = e.target.checked; }}
                />
                1x
              </label>
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

type GameEntry = {
  attemptId: string;
  puzzleId: string;
  width: number;
  height: number;
  status: "in_progress" | "completed" | "abandoned";
  durationMs: number | null;
  createdAt: string;
  finishedAt: string | null;
};

function MyGames(props: { onToast: (t: { kind: "ok" | "bad"; msg: string } | null) => void }) {
  const [games, setGames] = useState<GameEntry[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const r = await api<{ games: GameEntry[]; hasMore: boolean; page: number }>(
          `/api/games?page=${page}`
        );
        setGames(r.games);
        setHasMore(r.hasMore);
      } catch (err) {
        props.onToast({ kind: "bad", msg: (err as Error).message });
      } finally {
        setLoading(false);
      }
    })();
  }, [page]);

  async function newGame(puzzleId: string) {
    props.onToast(null);
    try {
      const r = await api<{ attempt: { id: string } }>("/api/attempts/new", {
        method: "POST",
        json: { puzzleId },
      });
      nav(`/a/${r.attempt.id}`);
    } catch (err) {
      props.onToast({ kind: "bad", msg: (err as Error).message });
    }
  }

  const statusLabel = (s: GameEntry["status"]) =>
    s === "in_progress" ? "In progress" : s === "completed" ? "Completed" : "Abandoned";

  return (
    <>
      <div className="back-nav">
        <button className="btn" onClick={() => nav("/")}>
          &larr; Back
        </button>
      </div>
      <div className="card">
        <div className="card-header-row">
          <h2>My Games</h2>
          {(hasMore || page > 0) && (
            <div className="pagination">
              <button
                className="btn sm icon-btn"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
                aria-label="Previous page"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <span className="pagination-info">{page + 1}</span>
              <button
                className="btn sm icon-btn"
                disabled={!hasMore}
                onClick={() => setPage(page + 1)}
                aria-label="Next page"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </div>
          )}
        </div>
        {loading ? (
          <div className="muted">Loading...</div>
        ) : games.length === 0 ? (
          <div className="muted">No games yet. Start one from the home page!</div>
        ) : (
          <div className="list">
            {games.map((g) => (
              <div key={g.attemptId} className="item">
                <div className="title">
                  {g.width}x{g.height}
                  <span className="muted" style={{ marginLeft: 8 }}>
                    {statusLabel(g.status)}
                  </span>
                  {g.status === "completed" && g.durationMs != null && (
                    <span className="muted" style={{ marginLeft: 8 }}>
                      {(g.durationMs / 1000).toFixed(2)}s
                    </span>
                  )}
                </div>
                <div className="meta">{fmtTime(g.createdAt)}</div>
                <div className="row item-actions">
                  {g.status === "in_progress" && (
                    <button className="btn sm" onClick={() => nav(`/a/${g.attemptId}`)}>
                      continue
                    </button>
                  )}
                  {g.status === "completed" && (
                    <>
                      <button className="btn sm" onClick={() => nav(`/replay/${g.attemptId}`)}>
                        watch replay
                      </button>
                      <button className="btn sm" onClick={() => void newGame(g.puzzleId)}>
                        play again
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
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
  inProgressAttempts: { attemptId: string; username: string; startedAt: string; width: number; height: number }[];
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

      {stats && stats.inProgressAttempts.length > 0 && (
        <div className="card">
          <h2>In Progress</h2>
          <div className="list">
            {stats.inProgressAttempts.map((a) => (
              <div key={a.attemptId} className="item">
                <div className="title">
                  {a.username}
                  <span className="muted" style={{ marginLeft: 8 }}>
                    {a.width}x{a.height}
                  </span>
                </div>
                <div className="meta">started {fmtTime(a.startedAt)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

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
            className="input"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="Code (blank = random)"
          />
          <input
            className="input input-sm"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            placeholder="Max uses"
            type="number"
            min="1"
          />
          <input
            className="input input-sm"
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
          <div className="toast ok gap-above">
            Created: <code>{lastCreatedCode}</code>
          </div>
        )}
        {invites.length === 0 ? (
          <div className="muted gap-above">No invite codes</div>
        ) : (
          <div className="list gap-above">
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
