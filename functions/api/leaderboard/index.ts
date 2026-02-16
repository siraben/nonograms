import type { Env } from "../../lib/auth";
import { requireUser } from "../../lib/auth";
import { json } from "../../lib/http";
import { periodCutoff, queryLeaderboard } from "../../lib/leaderboard";

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;

  const url = new URL(request.url);
  const sizeRaw = url.searchParams.get("size");
  const size = sizeRaw ? Number(sizeRaw) : null;
  const filterSize = size === 5 || size === 10 ? size : null;
  const cutoff = periodCutoff(url.searchParams.get("period"));

  const rows = await queryLeaderboard(env.DB, filterSize, cutoff, 50);

  return json({ leaderboard: rows.results });
};
