import type { Env } from "../../lib/auth";
import { requireUser } from "../../lib/auth";
import { err, json } from "../../lib/http";

const STALE_STARTED_MS = 4 * 60 * 60_000;    // 4 hours
const STALE_UNSTARTED_MS = 60 * 60_000;       // 1 hour

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const authed = await requireUser(env, request);
  if (authed instanceof Response) return authed;
  if (!authed.isAdmin) return err(403, "admin only");

  const now = Date.now();
  const startedCutoff = new Date(now - STALE_STARTED_MS).toISOString();
  const unstartedCutoff = new Date(now - STALE_UNSTARTED_MS).toISOString();

  // Abandon started attempts older than 4 hours
  const abandoned = await env.DB.prepare(
    "UPDATE attempts SET completed = 1, eligible = 0 WHERE completed = 0 AND started_at IS NOT NULL AND started_at < ?"
  ).bind(startedCutoff).run();

  // Delete never-started attempts older than 1 hour
  const deleted = await env.DB.prepare(
    "DELETE FROM attempts WHERE completed = 0 AND started_at IS NULL AND created_at < ?"
  ).bind(unstartedCutoff).run();

  return json({
    abandoned: abandoned.meta?.changes ?? 0,
    deleted: deleted.meta?.changes ?? 0,
  });
};
