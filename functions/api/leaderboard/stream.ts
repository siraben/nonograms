import type { Env } from "../../lib/auth";
import { getSession } from "../../lib/auth";

type Row = {
  attemptId: string;
  puzzleId: string;
  durationMs: number;
  finishedAt: string;
  username: string;
  width: number;
  height: number;
};

function periodCutoff(period: string | null): string | null {
  const now = new Date();
  switch (period) {
    case "day":
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    case "week": {
      const daysSinceMonday = (now.getUTCDay() + 6) % 7;
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday)).toISOString();
    }
    case "month":
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    default: return null;
  }
}

async function fetchBoth(db: D1Database, period: string | null) {
  const cutoff = periodCutoff(period);
  const q = (size: number) =>
    db.prepare(
      `SELECT a.id as attemptId,
              a.puzzle_id as puzzleId,
              a.duration_ms as durationMs,
              a.finished_at as finishedAt,
              u.username as username,
              p.width as width,
              p.height as height
       FROM attempts a
       JOIN users u ON u.id = a.user_id
       JOIN puzzles p ON p.id = a.puzzle_id
       WHERE a.completed = 1 AND a.eligible = 1 AND a.duration_ms IS NOT NULL
         AND p.width = ?1 AND p.height = ?1
         AND (?2 IS NULL OR a.finished_at >= ?2)
       ORDER BY a.duration_ms ASC
       LIMIT 50`
    ).bind(size, cutoff).all<Row>();

  const [r5, r10] = await Promise.all([q(5), q(10)]);
  return { leaderboard5: r5.results, leaderboard10: r10.results };
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const session = await getSession(env, request);
  if (!session) {
    return new Response(JSON.stringify({ error: "not logged in" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const period = url.searchParams.get("period");

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Send initial data and record it for dedup
      let lastJson: string;
      try {
        const initial = await fetchBoth(env.DB, period);
        lastJson = JSON.stringify(initial);
        send(initial);
      } catch {
        closed = true;
        controller.close();
        return;
      }

      // Poll every 10 seconds, up to 5 minutes
      const INTERVAL = 10_000;
      const MAX_DURATION = 5 * 60_000;
      let elapsed = 0;

      const poll = async () => {
        if (closed) return;
        elapsed += INTERVAL;
        if (elapsed >= MAX_DURATION) {
          if (!closed) { closed = true; controller.close(); }
          return;
        }
        try {
          const data = await fetchBoth(env.DB, period);
          const json = JSON.stringify(data);
          if (json !== lastJson) {
            lastJson = json;
            send(data);
          }
        } catch {
          // ignore transient errors
        }
        if (!closed) setTimeout(poll, INTERVAL);
      };

      setTimeout(poll, INTERVAL);
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
};
