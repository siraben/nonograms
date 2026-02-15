export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const u8 = new Uint8Array(digest);
  let out = "";
  for (const b of u8) out += b.toString(16).padStart(2, "0");
  return out;
}

export function randomInviteCode(): string {
  // Human-ish, case-insensitive, avoids ambiguous chars.
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  // xxxx-xxxx-xxxx-xxxx
  return out.replace(/(.{4})/g, "$1-").replace(/-$/, "");
}

