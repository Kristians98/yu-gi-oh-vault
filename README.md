# The Vault — Duelist Binder

A private Yu-Gi-Oh! binder + trading app for you and your friends, built from the
design in [`ARCHITECTURE.md`](./ARCHITECTURE.md). Log in, manage a persistent
collection backed by the full Yu-Gi-Oh! card database, browse friends' binders,
trade cards with a fairness meter, and add cards by scanning them. Rarities drive
a holographic foil/tilt effect throughout.

![login](./login.png)
![binder](./real-binder.png)

## Run it locally

```bash
npm install
npx prisma generate
npx prisma db push        # creates prisma/dev.db (SQLite)
node prisma/seed.mjs      # demo users + full card DB (~14.4k cards) + collections + friends + a sample trade
npm run dev               # http://localhost:3000
```

**Demo accounts** (password `duelist`): `you@vault.gg`, `mai@vault.gg`, `joey@vault.gg`.
They're already friends, and Mai has sent you a trade — log in as `you@vault.gg`. New friends create accounts at `/signup` (or open an invite link you generate on the Friends page).

## Features

- **Login** — Auth.js v5 credentials (bcrypt, JWT). Unauthenticated visits redirect to `/login`.
- **Binder** — your collection in SQLite. Add a single card (search the whole DB → pick set/rarity) **or a whole product** (the Add dialog's *Product* tab — "Add all" dumps every card from a structure deck / Legendary Collection / Speed Duel box into your binder). Remove, change quantity, toggle "for trade". Rarity holo tiers, Binder Insights, Exodia tracker, filters, focus modal.
- **Scan** (`/scan`) — point your camera at a card and **Azure gpt-4o-mini vision** reads its name + 8-digit **passcode** (its exact ID) + **set code** (its rarity) → exact DB match → confirm and add. On-device OCR (Tesseract.js) and manual passcode/name entry are fallbacks. *(Phone camera needs HTTPS — see below.)*
- **Friends** (`/friends`) — send/accept/decline requests by username, **invite links** that auto-friend, see friends with card counts, open a friend's binder at `/u/<username>`.
- **Trades** (`/trades`) — propose a trade from a friend's binder (`/trades/new?to=<username>`): pick from each side's for-trade cards, see a live **fairness meter** (value-weighted by condition). Accept / decline / cancel, then **two-sided confirm** completes the trade and transfers ownership in-app.
- **Wishlist** (`/wishlist`) — track cards you're hunting; instantly see which friends own them for trade. Wanted cards are outlined in gold on friends' binders.
- **Sign up** (`/signup`) — open registration, or invite links (`/signup?invite=…`) that connect you to the inviter automatically.
- **Notifications & Activity** — a notification **bell** with unread counts (friend requests, trades) and an `/feed` activity stream of what friends are doing. Polled, so no websockets required.
- **Mobile + PWA** — responsive layouts with a **bottom tab bar** on phones; installable web-app manifest + generated icons (iOS "Add to Home Screen" works over http).

Accessibility: keyboard focus rings, `Esc`-to-close modals, `prefers-reduced-motion` disables tilt/animation.

## Deploy with Docker + Postgres

For sharing beyond your machine — one command brings up the app + PostgreSQL,
applies the schema, seeds, and serves:

```bash
AUTH_SECRET=$(openssl rand -base64 32) docker compose up --build
# → http://localhost:3000
```

`Dockerfile` builds against `prisma/schema.postgres.prisma`; `docker-compose.yml`
wires the `web` container to a `postgres` service via `DATABASE_URL`. Swapping
SQLite → Postgres needs no app code changes (same Prisma client, models, and seed).

## Phone access

**Same WiFi (http):** the dev server is reachable at `http://<your-LAN-IP>:3000`
(allow inbound TCP 3000 through the firewall once). Browsing, login, trading, and
**manual** card-add work over plain http.

**Camera scanning needs HTTPS.** Two options:
- **Cloudflare Tunnel (recommended — real HTTPS + works off your network):** install once with `winget install Cloudflare.cloudflared`, then run `npm run tunnel` alongside `npm run dev`. It prints a `https://…trycloudflare.com` URL you can open on any phone, anywhere — the camera works there. (Auth uses `trustHost`, so the tunnel domain just works.)
- **Local cert (same WiFi only):** `npm run dev:lan` generates a self-signed cert (approve the prompt), then open `https://<your-LAN-IP>:3000` and accept the warning.

## Price refresh (cron)

`GET /api/cron/refresh-prices` re-fetches prices from YGOPRODeck for printings
anyone owns. It's gated by the `x-cron-secret` header (`CRON_SECRET` in `.env`):

```bash
curl -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/refresh-prices
```

Schedule it weekly with Windows Task Scheduler, cron, or a Vercel Cron job.

## Sign-up

Invite-only by default — a friend generates an invite link on the Friends page
(`/signup?invite=…`) and the new account is auto-friended. Set
`ALLOW_OPEN_SIGNUP="true"` in `.env` to allow open registration instead.

## Stack

Next.js 15 (App Router, Server Actions) · React 19 · TypeScript · Prisma 6
(SQLite dev / **PostgreSQL** prod) · Auth.js v5 · **Azure AI (gpt-4o-mini vision)** ·
Tesseract.js · bcryptjs · Zod · hand-written CSS · PWA · Docker.

## Insights, chat & real-time

- **Insights** (`/insights`) — collection stats, rarity breakdown, set-completion bars, most-valuable card, and derived achievements (Exodia, trade milestones, set master).
- **Card effect text** shows in the focus modal.
- **Filters** — filter the binder by **archetype**, by **format legality** (TCG Advanced / Goat / Edison — "legal" = not Forbidden), and a **hand-traps** toggle. Archetype + TCG + Goat are real YGOPRODeck data; the Edison list and hand-trap set are curated in `prisma/card-tags.mjs` (run `node prisma/enrich.mjs` after editing). Card modal shows archetype + banlist badges.
- **In-trade chat** on `/trades/[id]`, plus **live updates** — a Server-Sent-Events stream pushes notifications + page refreshes instantly (no manual reload).
- **Card images are self-hosted** through `/api/card-image` (proxied + disk-cached, no client hot-linking).
- **Tests** — `npm test` runs the Vitest suite (trade value/fairness/transfer logic).

## How v1 relates to the full design

Implemented: auth + signup/invites, persistent collections, full card DB, AI
scanner, friends, trading + chat, wishlists + matching, notifications + activity
feed, insights + achievements, real-time (SSE), self-hosted images, mobile/PWA,
Docker/Postgres, tests. Still ahead in `ARCHITECTURE.md`: multi-instance real-time
(Redis-backed pub/sub vs. the current in-process bus), card reactions, price-refresh
cron, and Tailwind/shadcn styling.

## Structure

```
auth.ts                        Auth.js (credentials + JWT)
prisma/schema.prisma           dev (SQLite) · schema.postgres.prisma  prod
prisma/seed.mjs                users + YGOPRODeck import + collections + friends + sample trade
lib/      prisma · actions (collection) · friends · trades · social · scan · map · cards (config)
app/      login/ · (app)/{binder, scan, friends, u/[username], trades, trades/new, trades/[id]} · api/auth
components/  app-shell · side-nav · binder · rarity-card · card-modal · add-card-dialog
             insights-strip · filter-bar · friends-panel · friend-binder
             trade-builder · trade-actions · scanner · login-form
Dockerfile · docker-compose.yml · docker-entrypoint.sh
```
