function b64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number, length: number): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    length * 8
  );
}

export async function hashPassword(password: string): Promise<{ saltB64: string; hashB64: string; iters: number }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iters = 210_000;
  const derived = await pbkdf2(password, salt, iters, 32);
  return { saltB64: b64(salt.buffer), hashB64: b64(derived), iters };
}

export async function verifyPassword(password: string, saltB64: string, hashB64: string, iters: number): Promise<boolean> {
  const salt = unb64(saltB64);
  const expected = unb64(hashB64);
  const derived = new Uint8Array(await pbkdf2(password, salt, iters, expected.length));
  // constant-time compare
  if (derived.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < derived.length; i++) diff |= derived[i] ^ expected[i];
  return diff === 0;
}

