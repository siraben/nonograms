# nonogram-server

Friends-only nonogram web app on Cloudflare Pages + D1.

## Local dev

Prereqs: `node`, `npm`, `wrangler` (installed via `npm i` in this repo).

1. Install deps:
```sh
npm install
```

2. Configure local vars (optional):
- Copy `.env.example` values into `.dev.vars` (this file is gitignored).
- If you want captcha locally, set `VITE_TURNSTILE_SITE_KEY` in `.env` too (Vite reads `.env*`).

3. Create a local D1 db and run migrations:
```sh
npx wrangler d1 create nonogram-db
# copy the database_id into wrangler.toml
npx wrangler d1 migrations apply DB --local
```

4. Run dev server:
```sh
npm run dev
```

In another terminal, run Pages Functions locally against the built output:
```sh
npm run build
npm run pages:dev
```

## Deploy (Cloudflare Pages)

1. Create a D1 database and apply migrations:
```sh
npx wrangler d1 create nonogram-db
npx wrangler d1 migrations apply DB
```

2. In Cloudflare Pages:
- Set D1 binding `DB` to the database.
- Add env vars:
  - `TURNSTILE_SECRET_KEY` (required if you set `VITE_TURNSTILE_SITE_KEY`)
  - `INVITE_CODE` (optional)
  - `VITE_TURNSTILE_SITE_KEY` (optional; build-time)

3. Deploy:
```sh
npm run build
npm run pages:deploy
```

