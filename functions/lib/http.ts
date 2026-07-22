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

const MAX_JSON_BYTES = 64 * 1024;

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJson<T>(req: Request, validate: (value: unknown) => value is T): Promise<T> {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("application/json")) throw new Error("expected application/json");
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    throw new Error("request body too large");
  }
  if (!req.body) throw new Error("missing request body");

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_JSON_BYTES) {
      await reader.cancel("request body too large");
      throw new Error("request body too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!validate(parsed)) throw new Error("invalid json shape");
  return parsed;
}

export function getCookie(req: Request, name: string): string | null {
  const h = req.headers.get("Cookie") || "";
  const parts = h.split(";").map((s) => s.trim());
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    const k = p.slice(0, eq);
    if (k !== name) continue;
    try {
      return decodeURIComponent(p.slice(eq + 1));
    } catch {
      return null;
    }
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
