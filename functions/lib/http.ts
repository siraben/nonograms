export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  // APIs should be dynamic; avoid caching surprises.
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function err(status: number, message: string): Response {
  return json({ error: message }, { status });
}

export async function readJson<T>(req: Request): Promise<T> {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("application/json")) throw new Error("expected application/json");
  return (await req.json()) as T;
}

export function getCookie(req: Request, name: string): string | null {
  const h = req.headers.get("Cookie") || "";
  const parts = h.split(";").map((s) => s.trim());
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    const k = p.slice(0, eq);
    if (k !== name) continue;
    return decodeURIComponent(p.slice(eq + 1));
  }
  return null;
}

export function setCookieHeader(opts: {
  name: string;
  value: string;
  maxAgeSeconds?: number;
  expires?: Date;
  httpOnly?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  path?: string;
  secure?: boolean;
}): string {
  const parts: string[] = [];
  parts.push(`${opts.name}=${encodeURIComponent(opts.value)}`);
  parts.push(`Path=${opts.path || "/"}`);
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  parts.push(`SameSite=${opts.sameSite || "Lax"}`);
  if (opts.secure) parts.push("Secure");
  if (opts.maxAgeSeconds !== undefined) parts.push(`Max-Age=${opts.maxAgeSeconds}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  return parts.join("; ");
}

