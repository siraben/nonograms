# Debugging: Production Register Was HTTP 500

Date: 2026-02-15

## Symptom

On the production site, trying to create a new account (`Register`) consistently returned:

- UI error: `HTTP 500`
- Endpoint: `POST /api/auth/register`

## Goal

Identify the *actual* server-side exception causing the 500 and fix it, then redeploy.

## What I Did

### 1) Confirm the failing request outside the UI

I reproduced the failure with a direct request to the Pages domain:

```bash
curl -i -sS 'https://nonograms.siraben.dev/api/auth/register' \
  -H 'content-type: application/json' \
  --data '{"username":"<random>","password":"password123","captchaToken":""}'
```

This returned `HTTP/2 500` with a generic JSON error body.

At this point, we know:

- the problem is server-side (Pages Functions)
- it is not just a frontend/JS issue

### 2) Tail Cloudflare Pages Functions logs for the current deployment

Wrangler can stream logs from a specific Pages deployment:

```bash
# Important detail for this repo:
# an invalid CLOUDFLARE_API_TOKEN env var can override OAuth and break Wrangler calls.
# Prefixing with CLOUDFLARE_API_TOKEN= forces Wrangler to use the OAuth login.

CLOUDFLARE_API_TOKEN= npx wrangler pages deployment list --project-name nonogram-server

CLOUDFLARE_API_TOKEN= npx wrangler pages deployment tail <deployment-id> \
  --project-name nonogram-server \
  --format pretty \
  --method POST
```

Then I re-ran the `curl` request while `tail` was running.

### 3) Read the stack trace

The tail output showed an unhandled exception for `/api/auth/register`:

```
NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not supported (requested 210000).
    at pbkdf2 (...)
    at async hashPassword (...)
    at async onRequestPost (functions/api/auth/register.ts ...)
```

This told us the 500 was caused by the password hashing code path:

- Registration calls `hashPassword()`
- `hashPassword()` uses WebCrypto PBKDF2
- Cloudflare Workers’ WebCrypto rejects iteration counts greater than `100000`
- Our code requested `210000`, so the runtime threw and the request failed

### 4) Fix: reduce PBKDF2 iterations to the supported limit

I updated the password hashing config:

- File: `functions/lib/password.ts`
- Change: `iters = 210_000` to `iters = 100_000`

Commit that fixed it:

- `fc143ef` "Fix PBKDF2 iteration limit on Workers"

### 5) Deploy

Cloudflare Pages is git-based here, so pushing to `main` triggers the deployment.

```bash
git push origin main
```

Once the production deployment was updated to the new commit, registration should stop throwing and return success/failure normally.

## Why This Happened

The Workers runtime supports PBKDF2, but enforces a maximum iteration count in its WebCrypto implementation. We picked an iteration count that is fine in some environments but not supported on Workers, leading to runtime exceptions in production.

## Follow-ups / Hardening

- Consider adding a small startup/self-check endpoint that verifies critical crypto operations are supported in the runtime.
- Consider making PBKDF2 params explicit constants with a comment about Workers limits (done in the fix).
- If we want stronger hashing than PBKDF2@100k, consider moving to an algorithm/runtime that supports it (or evaluate Workers support for scrypt/argon2 via WASM, with cost tradeoffs).

