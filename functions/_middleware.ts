import type { Env } from "./lib/auth";
import { json } from "./lib/http";

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    // Same-origin only; keep OPTIONS predictable.
    return new Response(null, { status: 204 });
  }

  try {
    // Fail fast with a useful message if the D1 binding wasn't configured for this environment.
    if (url.pathname.startsWith("/api/") && !env?.DB) {
      return json({ error: "D1 binding 'DB' is missing (Pages -> Settings -> Functions -> D1 bindings)" }, { status: 500 });
    }

    const res = await next();
    const headers = new Headers(res.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Referrer-Policy", "no-referrer");

    // If a function forgets to return JSON for /api routes, make failures clearer.
    if (url.pathname.startsWith("/api/") && !headers.get("Content-Type")) {
      return json({ error: "server misconfigured" }, { status: 500, headers });
    }

    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  } catch (e) {
    // Make sure the frontend gets JSON instead of the default HTML error page.
    console.error("Unhandled exception", { path: url.pathname, method: request.method, error: (e as Error)?.stack || String(e) });
    return json({ error: "internal error" }, { status: 500 });
  }
};
