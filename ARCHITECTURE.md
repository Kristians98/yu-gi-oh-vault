# Yu-Gi-Oh! Friends Trading Platform — Architecture

A private, invite-only web app where you and your friends log in, build your
real-card collections (added by **scanning cards with your phone**), browse each
other's binders, keep a wishlist, and trade cards directly. Card rarities drive
rich **visual effects** in the UI. Backed by the full Yu-Gi-Oh! card database
with **live** trade updates. Fully **containerized**.

---

## 1. Design decisions (locked)

| Area | Decision |
|---|---|
| Audience | Private circle of friends — **invite-only**, no public marketplace. |
| Rarity "effects" | **Visual only** — holo/foil/shine/parallax (and optional gyroscope tilt). No scoring, no gameplay, no pack-opening. |
| Card data | **Real cards via API** — full DB imported from [YGOPRODeck](https://ygoprodeck.com/api-guide/). |
| Card images | **Self-hosted** — downloaded at sync into object storage (YGOPRODeck forbids hotlinking). |
| Card entry | **AI phone scan, vision-first** → one model call returns name + passcode + set code → owner confirms. Manual fallback. |
| Trading | **Private friend-to-friend offers** — propose / counter / accept / decline, **two-sided completion**. |
| Wishlists | **Yes, core** — they give trades a demand signal and power "who has my wants" matching. |
| Real-time | **Self-hosted Socket.IO container** (JWT-auth, Redis adapter) — trade status, in-trade chat, notifications, presence. |
| Search | Postgres **`pg_trgm`** fuzzy search — no extra service. |
| Deployment | **Container-first** — identical images local / CI / prod. |

---

## 2. Design analysis — issues found & how they're resolved

The first draft had a handful of real gaps and under-specified choices. Each is
resolved below; the resolutions are reflected in the rest of this document.

| # | Issue / gap | Why it matters | Resolution |
|---|---|---|---|
| 1 | **Card art was hot-linked** from YGOPRODeck's CDN | Their API policy explicitly forbids hotlinking and rate-limits it (~20 req/s); images could break or get us blocked | **Download images once at sync** into object storage; serve via our own CDN. Card art becomes a local asset. |
| 2 | **Friendship rows could duplicate** — `(A,B)` and `(B,A)` both insertable; "my friends" query awkward | Data integrity + every friend query has to check two columns | Store **one canonical row** with `userAId < userBId` (enforced in app code). `@@unique([userAId,userBId])` then truly dedupes. |
| 3 | **`OwnedCard` had no uniqueness key** | Scanning the same card twice silently makes duplicate rows instead of stacking | Key it by **`@@unique([userId, printingId, condition])`**; identical copies stack via `quantity`. |
| 4 | **`TradeItem` only FK'd the live `OwnedCard`** | If a card is traded away, re-conditioned, or re-priced mid-negotiation, the historical trade record mutates | **Snapshot** identity + value into `TradeItem` (printing, name, rarity, condition, value-at-proposal). Trades become immutable records. |
| 5 | **Scanner was "Tesseract *or* vision model"** | Tesseract on stylized passcode/set fonts is unreliable; the branch was unresolved | **Vision-first**: a single Claude Haiku 4.5 call returns structured `{name, passcode, setCode, confidence}`; we do exact DB lookups on passcode/set code. Low volume → cheap; far simpler & more accurate. (Tesseract becomes an optional cost optimization later.) |
| 6 | **Realtime was "managed *or* self-hosted"** | Container-first philosophy + a friend-group's trivial load argue against an external SaaS dependency | **Self-hosted Socket.IO container** with JWT auth and a Redis adapter (adapter only needed if you scale past one instance). Managed (Ably/Pusher) stays a drop-in fallback. |
| 7 | **No registration model** for a "private" app | "Private" is meaningless if anyone can sign up | **Invite-only**: members generate single-use invite links/codes; sign-up requires a valid invite. |
| 8 | **Binder visibility was fuzzy** (`isPublicBinder` comment contradicted itself) | Need a clear rule for who sees what | **Private by default → visible to confirmed friends → optional unguessable public share link.** Three explicit levels. |
| 9 | **No wishlist / demand signal** | Friends can't tell what you're hunting; trades rely on guesswork | Add **`WishlistItem`**; surface "friends who own your wishlist cards" (a delight feature, not auto-trading). |
| 10 | **Trade value was undefined** | "Show price delta" needs a rule, and condition changes value a lot | **`effectiveValue = printing.priceUsd × conditionMultiplier`** (NM 1.0 → DMG 0.3). Powers the fairness meter. |
| 11 | **"Fuzzy search" unspecified** | Implementation choice affects infra | **Postgres `pg_trgm` + GIN index** on card name — fast, fuzzy, no extra service. |
| 12 | **Scan images stored without privacy note** | They're user photos; could leak via guessable URLs | Store in object storage behind **signed, expiring URLs**; the scan photo is private to the owner. |

> Two of these (5 — scanner, 6 — realtime) were genuine forks. I've picked the
> option that best fits a **low-volume private friend group on a container-first
> stack**. If this ever opened up to many users, revisit 5 (add Tesseract pre-pass
> to cut LLM cost) and 6 (managed realtime to offload connection scaling).

---

## 3. Tech stack

**Frontend**
- **Next.js 16** (App Router, React Server Components, Server Actions) — one framework for UI + API.
- **TypeScript** everywhere; **Zod** schemas shared client↔server.
- **Tailwind CSS v4** + **shadcn/ui** component system.
- **Framer Motion** for the rarity visual-effect layer (foil shimmer, parallax/gyro tilt).
- **TanStack Query** for client fetching/caching; **Zustand** for local UI state.
- **react-hook-form** for forms.
- **PWA** — installable on phones, camera access, offline-friendly binder browsing.

**Backend**
- **Next.js Route Handlers + Server Actions** for the API and all mutations.
- **Self-hosted Socket.IO** service (its own container) for WebSockets — see §9.
- **Auth.js (NextAuth v5)** — email magic-link + OAuth (Google/Discord), JWT sessions, **invite-gated** sign-up.

**AI scanning**
- Client captures frames via `getUserMedia` (PWA camera) with a guide overlay.
- **Vision-first**: one **Claude Haiku 4.5** (multimodal) call returns structured
  `{name, passcode, setCode, confidence}`; the server resolves those against the
  card DB for an exact match. See §8.

**Database & storage**
- **PostgreSQL** (primary store) + **Prisma** ORM (type-safe schema + migrations) + **`pg_trgm`** for fuzzy search.
- **Object storage** (S3-compatible — AWS S3 / Cloudflare R2) for **self-hosted card art**, user scan photos (signed URLs), and avatars.
- **Redis** — search cache, rate limiting, and the Socket.IO pub/sub adapter.

**Infra / deployment — fully containerized**
- **Everything runs in Docker containers** — Next.js app, realtime service, Postgres, Redis, supporting tools. Identical images run locally, in CI, and in prod (build once, promote the same artifact).
- **Docker Compose** orchestrates the full stack in dev (and is a valid single-host prod target).
- **Kubernetes / managed container runtime** (GKE, EKS, ECS, Fly.io, Railway, Render) as the scale-out option — same images.
- Managed data services (**Neon / Supabase / RDS** Postgres, **Upstash** Redis) swap in via env vars only.
- **GitHub Actions** CI: typecheck, lint, test, Prisma migrate check, then **build & push images** to a registry (GHCR / ECR).

---

## 4. High-level architecture

```
                         ┌──────────────────────────────────────┐
                         │            Browser / PWA               │
                         │  Next.js client (RSC + Client comps)   │
                         │  • Camera capture  • Rarity FX layer   │
                         │  • TanStack Query  • Socket.IO client  │
                         └───────┬───────────────────┬────────────┘
                                 │ HTTPS             │ WebSocket
                                 ▼                   ▼
        ┌────────────────────────────────┐   ┌────────────────────────┐
        │   Next.js Server (App Router)   │   │  Realtime container     │
        │  • Server Actions (mutations)   │◄──┤  (self-hosted Socket.IO)│
        │  • Route Handlers (REST/cron)   │   │  • trade rooms          │
        │  • Auth.js (invite-gated)       │──►│  • chat, presence,      │
        │  • AI scan orchestration        │   │    notifications        │
        └───┬──────────┬─────────┬────────┘   └───────────┬────────────┘
            │          │         │                        │
            ▼          ▼         ▼                        ▼
     ┌──────────┐ ┌─────────┐ ┌──────────────┐     ┌──────────┐
     │ Postgres │ │  Redis  │ │ Object store │     │  Redis   │
     │ (Prisma, │ │ cache / │ │ card art +   │     │ Socket.IO│
     │  pg_trgm)│ │ ratelmt │ │ scans (signed)│    │ adapter  │
     └──────────┘ └─────────┘ └──────────────┘     └──────────┘
            │
            ▼  (scheduled cron + on-demand)
     ┌─────────────────────┐     ┌─────────────────────┐
     │  YGOPRODeck API     │     │  Claude Haiku 4.5    │
     │  cards + prices +   │     │  (vision scan ID)    │
     │  images (downloaded)│     │                      │
     └─────────────────────┘     └─────────────────────┘
```

---

## 5. Data model — core

Prisma-style sketch — important relationships, not every column.

```prisma
// ---- Identity ----
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  username     String   @unique
  displayName  String?
  avatarUrl    String?
  binderVisibility BinderVisibility @default(FRIENDS) // PRIVATE | FRIENDS | LINK
  shareToken   String?  @unique     // unguessable token for LINK visibility
  createdAt    DateTime @default(now())

  ownedCards       OwnedCard[]
  wishlist         WishlistItem[]
  sentRequests     FriendRequest[] @relation("sender")
  receivedRequests FriendRequest[] @relation("receiver")
  tradesProposed   Trade[] @relation("proposer")
  tradesReceived   Trade[] @relation("receiver")
  notifications    Notification[]
  achievements     UserAchievement[]
  invitesCreated   Invite[]
}

enum BinderVisibility { PRIVATE FRIENDS LINK }

// ---- Canonical card DB (synced from YGOPRODeck; read-only to users) ----
model Card {
  id           Int      @id          // YGOPRODeck id == the 8-digit passcode
  name         String
  type         String                // "Effect Monster", "Spell Card", ...
  frameType    String                // normal/effect/spell/trap/xyz/link...
  desc         String
  atk          Int?
  def          Int?
  level        Int?
  attribute    String?
  race         String?
  imageUrl     String                // SELF-HOSTED (our object storage) — not hotlinked
  imageUrlSmall String
  printings    CardPrinting[]
  // GIN index on name via pg_trgm added in a migration for fuzzy search
}

model CardPrinting {
  id        String  @id @default(cuid())
  cardId    Int
  card      Card    @relation(fields: [cardId], references: [id])
  setName   String                 // "Legend of Blue Eyes White Dragon"
  setCode   String                 // "LOB-EN001"  ← scanned from card
  rarity    Rarity                 // ← drives the visual effect
  priceUsd  Decimal?               // refreshed periodically
  @@index([setCode])
  @@index([cardId])
}

enum Rarity {
  COMMON RARE SUPER_RARE ULTRA_RARE SECRET_RARE ULTIMATE_RARE
  GHOST_RARE STARLIGHT_RARE QUARTER_CENTURY_SECRET_RARE
  // ...full set normalized at ingest time
}

// ---- A user's actual owned copy ----
model OwnedCard {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id])
  printingId   String
  printing     CardPrinting @relation(fields: [printingId], references: [id])
  condition    Condition  @default(NM)   // NM/LP/MP/HP/DMG
  quantity     Int        @default(1)
  forTrade     Boolean    @default(false)
  scanImageUrl String?                    // signed URL; private to owner
  notes        String?
  createdAt    DateTime @default(now())
  @@unique([userId, printingId, condition])   // identical copies stack via quantity
  @@index([userId])
}

// ---- Social graph ----
model FriendRequest {
  id         String   @id @default(cuid())
  senderId   String
  receiverId String
  status     RequestStatus @default(PENDING)
  createdAt  DateTime @default(now())
  @@unique([senderId, receiverId])
}

model Friendship {
  id        String @id @default(cuid())
  userAId   String                       // CONVENTION: userAId < userBId (canonical)
  userBId   String
  createdAt DateTime @default(now())
  @@unique([userAId, userBId])
}

// ---- Trading (items are SNAPSHOTTED, see issue #4) ----
model Trade {
  id         String   @id @default(cuid())
  proposerId String
  receiverId String
  status     TradeStatus @default(PENDING)
  proposerConfirmed Boolean @default(false) // two-sided completion
  receiverConfirmed Boolean @default(false)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  items      TradeItem[]
  messages   TradeMessage[]
  ratings    TradeRating[]
}

model TradeItem {
  id          String  @id @default(cuid())
  tradeId     String
  side        TradeSide          // OFFER (proposer gives) / REQUEST (proposer wants)
  ownedCardId String?            // soft ref to live copy (nullable after transfer)
  // --- snapshot at proposal time ---
  printingId        String
  cardName          String
  setCode           String
  rarity            Rarity
  condition         Condition
  quantity          Int     @default(1)
  valueUsdAtProposal Decimal?
}

model TradeMessage {
  id        String   @id @default(cuid())
  tradeId   String
  senderId  String
  body      String
  createdAt DateTime @default(now())
}

model TradeRating {
  id        String   @id @default(cuid())
  tradeId   String
  raterId   String
  rating    Int                  // 1..5
  comment   String?
  createdAt DateTime @default(now())
  @@unique([tradeId, raterId])
}

enum TradeStatus  { PENDING COUNTERED ACCEPTED DECLINED CANCELLED COMPLETED }
enum TradeSide    { OFFER REQUEST }
enum Condition    { NM LP MP HP DMG }
enum RequestStatus{ PENDING ACCEPTED DECLINED }

model Notification {
  id        String   @id @default(cuid())
  userId    String
  type      String              // FRIEND_REQUEST | TRADE_PROPOSED | TRADE_MESSAGE | WISH_MATCH | ...
  payload   Json
  readAt    DateTime?
  createdAt DateTime @default(now())
  @@index([userId, readAt])
}
```

---

## 6. Data model — feature models

These back the wishlist, invites, and the delight features in §11.

```prisma
// ---- Invite-only registration ----
model Invite {
  id          String   @id @default(cuid())
  code        String   @unique          // goes in the invite link /join/{code}
  createdById String
  createdBy   User     @relation(fields: [createdById], references: [id])
  email       String?                   // optional: bind to one person
  usedById    String?                   // null until redeemed
  expiresAt   DateTime?
  createdAt   DateTime @default(now())
}

// ---- Wishlist (demand signal) ----
model WishlistItem {
  id         String  @id @default(cuid())
  userId     String
  user       User    @relation(fields: [userId], references: [id])
  cardId     Int                        // want the card (any printing) ...
  printingId String?                    // ... or pin an exact set/rarity
  priority   Int     @default(2)        // 1 high .. 3 low
  note       String?
  createdAt  DateTime @default(now())
  @@unique([userId, cardId, printingId])
}

// ---- Achievements / badges (incl. Exodia easter egg) ----
model Achievement {                      // seed table of definitions
  key         String @id                // "FIRST_SECRET", "EXODIA_COMPLETE", "TEN_TRADES"
  name        String
  description String
  icon        String
}
model UserAchievement {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id])
  achievementKey String
  earnedAt      DateTime @default(now())
  meta          Json?
  @@unique([userId, achievementKey])
}

// ---- Social pulse ----
model ActivityEvent {                    // the friends feed
  id        String   @id @default(cuid())
  userId    String                       // actor
  type      String                       // ADDED_CARD | NEW_CHASE | COMPLETED_SET | WISH_ADDED | TRADE_DONE | ACHIEVEMENT
  payload   Json
  createdAt DateTime @default(now())
  @@index([userId, createdAt])
}
model Reaction {                          // 🔥 on a friend's card
  id          String @id @default(cuid())
  userId      String
  ownedCardId String
  emoji       String
  createdAt   DateTime @default(now())
  @@unique([userId, ownedCardId, emoji])
}

// ---- Collection value over time ----
model CollectionSnapshot {
  id            String   @id @default(cuid())
  userId        String
  takenAt       DateTime @default(now())
  totalValueUsd Decimal
  cardCount     Int
  rarityBreakdown Json                    // { SECRET_RARE: 12, ... } for charts
  @@index([userId, takenAt])
}
```

Set-completion (e.g. "47/100 of Legend of Blue Eyes") is **derived** at query
time from `CardPrinting.setName` vs the user's `OwnedCard`s — no stored table
needed.

---

## 7. Card database ingestion

- **Full sync (one-time + occasional):** a script pulls the entire YGOPRODeck card list (~14k cards) and upserts `Card` + `CardPrinting`. Rarities are **normalized** into the `Rarity` enum so the visual layer has a clean, finite set.
- **Image self-hosting:** during sync, **download each card image once** into object storage and store our own URL on `Card.imageUrl` (respects YGOPRODeck policy; immune to their rate limits/outages). Throttle to ≤20 req/s.
- **Price refresh (cron):** scheduled Route Handler (`/api/cron/refresh-prices`, secret-header protected) updates `CardPrinting.priceUsd` weekly, then writes a `CollectionSnapshot` per active user for the value-over-time chart.
- **Search:** `pg_trgm` GIN index on `Card.name`; `/api/cards/search?q=` does fuzzy, case-insensitive matching and returns cards with printings (set + rarity + price). Hot queries cached in Redis.

---

## 8. AI card scanner pipeline (vision-first)

Snap a photo → the app identifies the card → user confirms set/rarity → it lands
in the collection.

```
[Phone camera frame, guide overlay]
        │
        ▼
1. Client captures + lightly crops → POST /api/scan (small JPEG)
        │
        ▼
2. Claude Haiku 4.5 (multimodal), forced structured output:
   { name, passcode (8-digit), setCode (e.g. LOB-EN001), confidence }
        │
        ▼
3. Server resolves against the card DB:
   • passcode → Card  (Card.id == passcode → exact)         ◄ most reliable
   • setCode  → CardPrinting (exact set + RARITY)            ◄ resolves rarity!
   • name     → pg_trgm fuzzy fallback if codes unreadable
        │
        ▼
4. Review screen (always shown):
   • candidate art + name pre-filled, printing/rarity preselected from setCode
   • user adjusts SET / RARITY (dropdown of that card's printings),
     condition, quantity, for-trade
        │
        ▼
5. addToCollection() → OwnedCard (stack via unique key) + store scan photo (signed URL)
   + emit ActivityEvent(ADDED_CARD) + check achievements
```

**Why vision-first (resolves issue #5):** the printed **passcode is YGOPRODeck's
primary key**, so reading it gives a 100% match; the **set code resolves rarity**
(which stylized art cannot). One multimodal call with structured output reads all
three at once — far simpler and more robust on damaged/old/foreign cards than
Tesseract on stylized fonts, and at a friend group's volume the per-scan cost is
fractions of a cent. A Tesseract pre-pass can be added later purely as a cost
optimization if volume ever explodes.

**Batch mode:** capture several cards in a row → review queue → bulk insert (great
for adding a whole binder in one sitting).

---

## 9. Real-time layer (self-hosted Socket.IO)

Used for: trade status changes, in-trade chat, presence ("friend is online"),
the notification bell, and live activity-feed updates.

- A dedicated **`realtime` container** runs Socket.IO. Next.js can't hold long-lived sockets, so realtime is its own service.
- Each trade is a **room** (`trade:{id}`); both participants subscribe. Per-user channel (`user:{id}`) delivers notifications regardless of current page.
- **Flow:** a Server Action commits the DB mutation, then **publishes** an event (Next → Redis → Socket.IO → clients). The realtime service never writes the DB; it only fans out.
- **Auth:** sockets authenticate with the same Auth.js JWT; the server validates room membership (you can only join trades you're part of).
- **Scaling:** a single container needs no adapter. The **Redis adapter** is wired in so you can run N realtime replicas later with zero code change. (Managed Ably/Pusher remains a drop-in fallback if you'd rather not run this.)

---

## 10. Rarity visual-effects system (frontend)

One `<RarityCard rarity={...}>` component maps each `Rarity` to a treatment, so
effects are consistent everywhere a card appears.

- **Common / Rare** → flat or subtle gloss.
- **Super / Ultra Rare** → foil **shine sweep** on hover + light parallax tilt (pointer-tracked CSS transform / `background-position`).
- **Secret / Ultimate** → animated holographic gradient (CSS conic-gradient + `mix-blend-mode`), stronger 3D tilt.
- **Ghost / Starlight / Quarter-Century** → premium prismatic shimmer + subtle sparkle overlay (Framer Motion).
- **Mobile gyroscope tilt** (delight): on phones, `DeviceOrientation` drives the holo highlight so tilting the device makes foils shift like the real card. Pointer does the same on desktop.
- Implemented as **CSS layers + a config map** (`rarityStyles[rarity]`), GPU-accelerated transforms only, `prefers-reduced-motion` respected. Purely presentational — driven by `CardPrinting.rarity`, never touches business logic.

---

## 11. Delightful features

Modular — pick what you want. Tagged **[core]** (high value, low effort) or
**[optional]**. Each notes how it works and what it touches. (Deliberately **no
gacha/pack-opening** — per the brief; the add-card confirmation is just a subtle
rarity-scaled flourish, not a reveal mechanic.)

**Collector delight**
- **Binder Insights** **[core]** — a stats dashboard: total value, card count, rarity breakdown (pie), most valuable card, type/attribute distribution. Collectors love numbers. *Uses `OwnedCard` + `CardPrinting.priceUsd`.*
- **Set completion tracker** **[core]** — "47 / 100 — Legend of Blue Eyes" progress bars per set; surfaces the exact cards you're missing → natural trade targets. *Derived from `setName`.*
- **Collection value over time** **[optional]** — a sparkline/area chart of your binder's worth, fed by weekly `CollectionSnapshot`s written during the price cron.
- **Showcase / chase-card trophy view** **[optional]** — a beautiful, full-bleed page of your rarest cards with the holo FX cranked up; shareable via the LINK-visibility token or a QR code at the table.

**Social pulse**
- **Activity feed** **[core]** — "Sam added a Blue-Eyes (Secret Rare)", "Alex is hunting Dark Magician", "You and Max completed a trade". The heartbeat of the friend group. *Backed by `ActivityEvent`, pushed live via Socket.IO.*
- **Reactions & comments on cards** **[optional]** — friends drop 🔥/😮 or a comment on a sick pull in your binder. *Backed by `Reaction`.*
- **Friends leaderboards** **[optional, opt-in]** — most valuable binder, most cards, most trades, rarest single card. Pure friendly bragging — separate from the (intentionally effect-free) rarity system.

**Trade smarts**
- **Wishlist + "who has my wants"** **[core]** — keep a wishlist; the app shows which friends own a wishlisted card (and have it `forTrade`), and notifies you when a friend adds one (`WISH_MATCH`). The social, non-creepy version of auto-matching.
- **Trade fairness meter** **[core]** — while building a trade, a friendly meter compares `Σ effectiveValue` on each side (`priceUsd × conditionMultiplier`, NM 1.0 → DMG 0.3) and shows the delta: "Even" / "Favours Alex by $12". Informative, not blocking.
- **One-tap counter suggestions** **[optional]** — when a trade is lopsided, suggest a card from the other side's `forTrade` pile that would balance it.

**Playful touches**
- **Achievements & badges** **[optional]** — "First Secret Rare", "Completed a set", "10 trades done", and the **Exodia easter egg**: own all 5 Exodia pieces → a special badge + one-time celebratory animation. *Backed by `Achievement`/`UserAchievement`, evaluated after `addToCollection`/trade completion.*
- **Weekly digest** **[optional]** — opt-in email: "Your binder is up $14 this week · Sam is hunting a card you own · 2 pending trades." Reuses the snapshot + wishlist data.
- **QR "show my binder"** **[optional]** — render a QR to your share-link binder so a friend at the table can open it instantly.

---

## 12. Key surfaces / routes

| Route | Purpose |
|---|---|
| `/login`, `/join/[code]` | Auth.js magic link + OAuth; **invite-gated** sign-up |
| `/` (dashboard) | Activity feed, pending trades, wishlist matches, notifications |
| `/collection` | Your binder — grid with rarity FX, filters, for-trade toggle |
| `/collection/scan` | Camera scanner + review queue |
| `/collection/insights` | Binder Insights: stats, set completion, value-over-time |
| `/wishlist` | Manage wishlist; see which friends own your wants |
| `/friends` | Friend list, requests, search by username, invite links |
| `/u/[username]` | A friend's binder + showcase; "propose trade" CTA; react/comment |
| `/trades` | Active / past trades |
| `/trades/new?to=` | Trade builder — drag cards into Offer / Request; fairness meter |
| `/trades/[id]` | Trade detail — items, live chat, accept/counter/decline, two-sided complete, rate |
| `/leaderboard` | Opt-in friendly rankings |
| `/api/cards/search` | Fuzzy card search (`pg_trgm`) |
| `/api/scan` | Vision scan → identify pipeline |
| `/api/cron/refresh-prices` | Scheduled price refresh + snapshot write |

Mutations (`addToCollection`, `addToWishlist`, `proposeTrade`, `counterTrade`,
`acceptTrade`, `confirmTradeComplete`, `reactToCard`, …) are **Server Actions**
with Zod-validated inputs; each commits, then emits the relevant realtime event /
`ActivityEvent` and runs achievement checks.

---

## 13. Trade lifecycle & valuation

```
PENDING ──accept──► ACCEPTED ──both confirm handoff──► COMPLETED
   │  │                                  (ownership transfers in-app)
   │  └─counter──► COUNTERED ──accept──► ACCEPTED
   │                   └─counter (back and forth, items re-snapshotted)
   ├─decline─► DECLINED
   └─cancel──► CANCELLED   (proposer withdraws)
```

- **Valuation:** `effectiveValue = priceUsd × conditionMultiplier` — `NM 1.0,
  LP 0.85, MP 0.7, HP 0.5, DMG 0.3` (indicative; tune freely). The fairness meter
  sums each side.
- **Two-sided completion (resolves the physical-trade problem):** these are real
  cards swapped in person, so COMPLETED requires **both** `proposerConfirmed` and
  `receiverConfirmed`. On the second confirm, the app transfers/decrements
  `OwnedCard` quantities so both binders stay accurate, emits `TRADE_DONE`, and
  unlocks ratings + the "traded N times with X" counter.
- Trade **items are snapshots** (§5 issue #4), so the record is immutable even if
  the underlying cards later move or re-price.

---

## 14. Security & integrity

- Every mutation checks the session user owns/participates in the resource (offer only cards you own; trade only with confirmed friends).
- **Invite-gated registration**; sign-up requires a valid, unexpired, unused invite.
- **Binder visibility** enforced server-side: PRIVATE (owner only) / FRIENDS / LINK (anyone with the unguessable `shareToken`).
- **Scan photos** are private to the owner via signed, expiring object-storage URLs.
- Rate-limit scan + search endpoints (Redis).
- WebSocket room membership enforced server-side against the JWT.

---

## 15. Containerization

Container-first: every long-running process is its own image, wired by Docker
Compose locally and an orchestrator in prod. Same images everywhere.

| Container | Image | Role |
|---|---|---|
| `web` | Next.js (multi-stage → `output: "standalone"`) | App: RSC, server actions, route handlers, scan orchestration |
| `realtime` | Node + Socket.IO | WebSocket rooms, chat, presence, notifications |
| `postgres` | `postgres:17-alpine` (+ `pg_trgm`) | Primary DB (managed endpoint in prod) |
| `redis` | `redis:7-alpine` | Cache, rate limiting, Socket.IO adapter |
| `migrate` | same as `web`, runs `prisma migrate deploy` | One-shot init container; gates `web` |
| `mailhog` | `mailhog/mailhog` | **Dev only** — catches magic-link / invite emails |

**Dockerfile (web) — multi-stage:**

```dockerfile
# 1) deps
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# 2) build — Prisma client + Next standalone output
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# 3) runtime — minimal, non-root
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
```

**`docker-compose.yml` (dev) — shape:**

```yaml
services:
  web:
    build: .
    env_file: .env
    ports: ["3000:3000"]
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_started }
  realtime:
    build: ./realtime
    env_file: .env
    ports: ["4000:4000"]
    depends_on:
      redis: { condition: service_started }
  postgres:
    image: postgres:17-alpine
    environment: { POSTGRES_DB: ygo, POSTGRES_PASSWORD: dev }
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 5
  redis:
    image: redis:7-alpine
  mailhog:
    image: mailhog/mailhog
    ports: ["8025:8025"]   # web UI
volumes:
  pgdata:
```

**Practices:** `.dockerignore` (exclude `node_modules`, `.next`, `.git`, `.env*`);
non-root user; pinned base tags; healthchecks + `depends_on` ordering; `migrate`
gates the app on a clean schema; 12-factor config (swap to managed DB by changing
`DATABASE_URL` only); CI builds the same image it deploys.

---

## 16. Suggested build phases

1. **Foundation** — Next.js + Auth.js (**invite-gated**) + Prisma + Postgres + Redis + Docker dev; layout shell, binder-visibility model.
2. **Card DB pipeline** — YGOPRODeck full sync, **image self-hosting**, `pg_trgm` search endpoint, price cron + snapshots.
3. **Collection** — manual add (search → pick printing → condition/qty), binder grid, `OwnedCard` unique-key stacking.
4. **Rarity FX** — `<RarityCard>` visual system + pointer/gyroscope tilt across the binder.
5. **Friends** — requests, accept/decline, browse friend binders, share links + QR.
6. **Wishlist + Insights** — wishlist CRUD, "who has my wants", Binder Insights (stats, set completion, value chart). *Demand signal + collector delight before trading.*
7. **Trading + realtime** — trade builder with fairness meter, lifecycle, two-sided completion, live chat & notifications (Socket.IO container), ratings.
8. **AI scanner** — camera capture, vision-first identification, review queue, batch add.
9. **Social pulse** — activity feed (live), reactions/comments, achievements + Exodia easter egg, opt-in leaderboards.
10. **Polish** — PWA install, notification bell, weekly email digest, error monitoring (Sentry), analytics.

> Build the scanner (8) after the collection, trading, and review UIs are solid —
> it's the highest-value feature but depends on everything underneath it working.
```

