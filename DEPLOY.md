# Deploying The Vault (Vercel + Supabase + Cloudflare — all free tiers)

The app already runs serverless-clean: images serve via Vercel's edge cache, real-time
is light polling, and the Postgres schema (`prisma/schema.postgres.prisma`) mirrors the
dev SQLite one. This is the one-time setup.

## 0. Topology
- **Vercel** — the Next.js app (SSR, server actions, API routes, cron).
- **Supabase** — managed Postgres.
- **Cloudflare** — DNS for your domain (point it at Vercel). (R2 optional, see bottom.)

## 1. Supabase (database)
1. Create a free project. Note the DB password.
2. Project → **Connect** → grab two connection strings:
   - **Pooled** (Supavisor, port **6543**) → this is `DATABASE_URL`. Append `?pgbouncer=true&connection_limit=1`.
   - **Direct** (port **5432**) → this is `DIRECT_URL`.
3. Free projects **pause after ~7 days idle** — the first request after that wakes it (a few seconds of cold start). Fine for a friends app.

## 2. Seed the database (run once, locally, pointed at Supabase)
```bash
# from the project root, with the two URLs exported (PowerShell: $env:DATABASE_URL=...)
export DATABASE_URL="postgres://...6543/postgres?pgbouncer=true&connection_limit=1"
export DIRECT_URL="postgres://...5432/postgres"

npx prisma db push --schema=prisma/schema.postgres.prisma   # create tables
node prisma/seed.mjs          # demo users + full card DB (~14k cards) + starter collections
node prisma/enrich-dates.mjs  # tcg_date (format eras)
node prisma/enrich-links.mjs  # linkval + isTuner (deck-builder summonability)
```
(The seed pulls the whole card DB from YGOPRODeck — it's a one-time ~minute job and fits
well within Supabase's 500 MB free limit.)

## 3. Vercel (app)
1. Push the repo to GitHub and **Import** it in Vercel.
2. Build command is automatic: `package.json` has a `vercel-build` script that runs
   `prisma generate --schema=prisma/schema.postgres.prisma && next build`.
3. **Environment variables** (Project → Settings → Environment Variables):
   ```
   DATABASE_URL              pooled 6543 string (?pgbouncer=true&connection_limit=1)
   DIRECT_URL                direct 5432 string
   AUTH_SECRET               openssl rand -base64 32
   AUTH_TRUST_HOST           true
   AZURE_AI_ENDPOINT         https://…services.ai.azure.com
   AZURE_AI_KEY              (rotate this — it was shared in chat)
   AZURE_AI_DEPLOYMENT       gpt-4o-mini      (scanner)
   AZURE_AI_DECK_DEPLOYMENT  gpt-5.4          (deck builder)
   AZURE_AI_API_VERSION      2024-05-01-preview
   CRON_SECRET               openssl rand -hex 16
   ALLOW_OPEN_SIGNUP         false
   AUTH_GOOGLE_ID            (optional) Google OAuth client ID — enables "Continue with Google"
   AUTH_GOOGLE_SECRET        (optional) its client secret
   ```
4. Deploy.

### Google sign-in (optional)
1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) create an
   **OAuth client ID** of type *Web application* (set up the OAuth consent screen first if
   asked; External, then add yourself as a test user or publish it).
2. **Authorized redirect URIs**: `https://<your-vercel-domain>/api/auth/callback/google`
   and, for local dev, `http://localhost:3000/api/auth/callback/google`.
3. Put the client ID / secret into `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` and redeploy.
   Without them the Google button simply does not render.

Behaviour: a Google email that matches an existing account signs into that account. A new
email gets an account only when `ALLOW_OPEN_SIGNUP=true` or the person came through an
invite link (`/signup?invite=…` → "Sign up with Google"); otherwise they are sent back to
sign-up with an explanation. Google-created accounts have no password.

## 4. Cron (price refresh)
`vercel.json` registers one cron: a weekly `GET /api/cron/sync-cards` (new sets +
reprints from YGOPRODeck, collections untouched). Vercel sends
`Authorization: Bearer $CRON_SECRET`, which the route checks. Nothing else to do. The
route declares `maxDuration = 60`, the ceiling on every plan; a full sync takes a few
seconds (the YGOPRODeck list is CDN-cached). If a run ever does time out,
`node prisma/sync-cards.mjs` against the prod `DATABASE_URL` does the same work.

**Schema change (prices removed):** `CardPrinting.priceUsd` and `TradeItem.valueUsd` are
gone. Pushing the schema drops those columns, which Prisma treats as data loss, so run it
once with the flag: `npx prisma db push --schema=prisma/schema.postgres.prisma --accept-data-loss`.

## 5. Cloudflare (domain)
Add your domain in Vercel (Settings → Domains), then in Cloudflare DNS add the CNAME/A
records Vercel shows. Easiest first pass: set those records to **DNS-only (grey cloud)**
to avoid double-proxying; turn the orange cloud on later if you want Cloudflare's WAF/cache.
HTTPS is automatic on Vercel — so the scanner camera works with no tunnel.

## ⚠️ The one free-tier gotcha: function timeout
The deck builder calls **gpt-5.4 (~15–20s)**. Pages that invoke it set `maxDuration = 60`
(`app/(app)/decks/page.tsx`, `app/(app)/scan/page.tsx`). Vercel Hobby with Fluid Compute
(now the default) allows up to 60s — **after the first deploy, build one deck and confirm
it doesn't 504.** If it does time out on your plan, the fix that stays free is to move the
raw Azure call to a **Cloudflare Worker** (key as a Worker secret; the client calls the
Worker for the completion, then a fast Vercel action validates/scores it) — ask and I'll wire it.

## Optional upgrades (still free)
- **Cloudflare R2 for images** — currently each card art is fetched from YGOPRODeck once
  per edge node then served from Vercel's cache (works, but hotlinks on cold edges). To
  fully self-host: make `app/api/card-image/[id]` read-through to an R2 bucket.
- **Upstash Redis** — only needed if you want a shared scanner rate-limit or true push
  real-time instead of polling.
