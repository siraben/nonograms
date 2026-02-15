export type ApiError = { error: string };

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set("Content-Type", "application/json");

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body
  });

  if (!res.ok) {
    const data = (await readJson(res)) as ApiError | null;
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return (await readJson(res)) as T;
}

