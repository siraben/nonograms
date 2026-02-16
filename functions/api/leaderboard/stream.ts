import type { Env } from "../../lib/auth";
import { getSession } from "../../lib/auth";
import { err } from "../../lib/http";
import { periodCutoff, queryLeaderboard } from "../../lib/leaderboard";

async function fetchBoth(db: D1Database, period: string | null) {
  const cutoff = periodCutoff(period);
  const [r5, r10] = await Promise.all([
    queryLeaderboard(db, 5, cutoff, 50),
    queryLeaderboard(db, 10, cutoff, 50),
  ]);
  return { leaderboard5: r5.results, leaderboard10: r10.results };
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const session = await getSession(env, request);
  if (!session) return err(401, "not logged in");

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
