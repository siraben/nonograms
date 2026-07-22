type TurnstileResponse = {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
};

export async function verifyTurnstile(opts: {
  secretKey: string | undefined;
  token: string | undefined;
  remoteip?: string | null;
  allowDevBypass?: boolean;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!opts.secretKey) {
    return opts.allowDevBypass
      ? { ok: true }
      : { ok: false, reason: "captcha server not configured" };
  }
  if (!opts.token) return { ok: false, reason: "missing captcha token" };

  const form = new URLSearchParams();
  form.set("secret", opts.secretKey);
  form.set("response", opts.token);
  if (opts.remoteip) form.set("remoteip", opts.remoteip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });
  if (!res.ok) return { ok: false, reason: "captcha verify failed" };
  const data = (await res.json()) as TurnstileResponse;
  if (!data.success) return { ok: false, reason: (data["error-codes"] || ["captcha failed"]).join(", ") };
  return { ok: true };
}
