import type { Env } from "../../lib/auth";
import { destroySession } from "../../lib/auth";
import { json } from "../../lib/http";

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const setCookie = await destroySession(env, request);
  const res = json({ ok: true });
  res.headers.append("Set-Cookie", setCookie);
  return res;
};
