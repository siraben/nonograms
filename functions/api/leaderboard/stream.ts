import type { Env } from "../../lib/auth";
import { getSession } from "../../lib/auth";
import { err } from "../../lib/http";
import { periodCutoff, queryLeaderboard } from "../../lib/leaderboard";

async function fetchBoth(db: D1Database, period: string | null) {
  const cutoff = periodCutoff(period);
  const [r5, r10, r15, r20] = await Promise.all([
    queryLeaderboard(db, 5, cutoff, 50),
    queryLeaderboard(db, 10, cutoff, 50),
    queryLeaderboard(db, 15, cutoff, 50),
    queryLeaderboard(db, 20, cutoff, 50),
  ]);
  return { leaderboard5: r5.results, leaderboard10: r10.results, leaderboard15: r15.results, leaderboard20: r20.results };
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const session = await getSession(env, request);
  if (!session) return err(401, "not logged in");

  const url = new URL(request.url);
  const period = url.searchParams.get("period");

  const data = await fetchBoth(env.DB, period);

  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=10",
    },
  });
};
