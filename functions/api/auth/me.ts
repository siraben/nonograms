import type { Env } from "../../lib/auth";
import { getSession } from "../../lib/auth";
import { json } from "../../lib/http";

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const s = await getSession(env, request);
  if (!s) return json({ user: null });
  return json({ user: { id: s.userId, username: s.username, isAdmin: s.isAdmin } });
};

