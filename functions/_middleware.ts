import { json } from "./lib/http";

export const onRequest: PagesFunction = async ({ request, next }) => {
  if (request.method === "OPTIONS") {
    // Same-origin only; keep OPTIONS predictable.
    return new Response(null, { status: 204 });
  }

  const res = await next();
  const headers = new Headers(res.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");

  // If a function forgets to return JSON for /api routes, make failures clearer.
  if (new URL(request.url).pathname.startsWith("/api/") && !headers.get("Content-Type")) {
    return json({ error: "server misconfigured" }, { status: 500, headers });
  }

  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};

