// Seed: 3 demo users + the real YGOPRODeck card DB + starter collections.
// Run: node prisma/seed.mjs   (idempotent — skips card import if already seeded)
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cardExtras } from "./card-tags.mjs";

const prisma = new PrismaClient();
const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, ".cache");
const CACHE_FILE = join(CACHE_DIR, "ygoprodeck.json");
const API = "https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes";

function normRarity(s) {
  const x = (s || "").toLowerCase();
  if (x.includes("quarter century")) return "QUARTER_CENTURY_SECRET_RARE";
  if (x.includes("starlight")) return "STARLIGHT_RARE";
  if (x.includes("ghost")) return "GHOST_RARE";
  if (x.includes("ultimate")) return "ULTIMATE_RARE";
  if (x.includes("secret")) return "SECRET_RARE";
  if (x.includes("ultra")) return "ULTRA_RARE";
  if (x.includes("super")) return "SUPER_RARE";
  if (x.includes("rare")) return "RARE";
  return "COMMON";
}

function normFrame(frameType, race, type) {
  const f = (frameType || "").toLowerCase();
  const t = (type || "").toLowerCase();
  if (race === "Divine-Beast" || t.includes("divine")) return "divine";
  if (f.includes("pendulum")) {
    if (f.includes("normal")) return "normal";
    if (f.includes("ritual")) return "ritual";
    if (f.includes("fusion")) return "fusion";
    if (f.includes("synchro")) return "synchro";
    if (f.includes("xyz")) return "xyz";
    return "effect";
  }
  if (f.includes("xyz")) return "xyz";
  if (f.includes("link")) return "link";
  if (f.includes("synchro")) return "synchro";
  if (f.includes("fusion")) return "fusion";
  if (f.includes("ritual")) return "ritual";
  if (f.includes("spell")) return "spell";
  if (f.includes("trap")) return "trap";
  if (f.includes("normal")) return "normal";
  return "effect";
}

function buildTypeLine(card, frame) {
  if (frame === "spell") return `${card.race || "Normal"} Spell`;
  if (frame === "trap") return `${card.race || "Normal"} Trap`;
  return [card.race, frame.charAt(0).toUpperCase() + frame.slice(1)].filter(Boolean).join(" / ");
}

async function loadCards() {
  if (existsSync(CACHE_FILE)) {
    console.log("Using cached card data.");
    return JSON.parse(readFileSync(CACHE_FILE, "utf8"));
  }
  console.log("Fetching full card DB from YGOPRODeck…");
  const res = await fetch(API);
  if (!res.ok) throw new Error("YGOPRODeck fetch failed: " + res.status);
  const json = await res.json();
  const data = json.data || [];
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(data));
  console.log(`Fetched ${data.length} cards.`);
  return data;
}

// Curated starter binder for the main user (rarities chosen to show off the holo tiers).
const STARTER = [
  { id: 89631139, rarity: "ULTRA_RARE", condition: "NM", quantity: 1, forTrade: false },
  { id: 46986414, rarity: "SECRET_RARE", condition: "NM", quantity: 1, forTrade: false },
  { id: 38033121, rarity: "GHOST_RARE", condition: "LP", quantity: 1, forTrade: false },
  { id: 74677422, rarity: "SUPER_RARE", condition: "NM", quantity: 1, forTrade: false },
  { id: 33396948, rarity: "ULTIMATE_RARE", condition: "NM", quantity: 1, forTrade: false },
  { id: 70903634, rarity: "RARE", condition: "LP", quantity: 1, forTrade: false },
  { id: 7902349, rarity: "RARE", condition: "LP", quantity: 1, forTrade: false },
  { id: 8124921, rarity: "RARE", condition: "LP", quantity: 1, forTrade: false },
  { id: 44519536, rarity: "RARE", condition: "LP", quantity: 1, forTrade: false },
  { id: 10000020, rarity: "SECRET_RARE", condition: "NM", quantity: 1, forTrade: false },
  { id: 10000000, rarity: "STARLIGHT_RARE", condition: "NM", quantity: 1, forTrade: false },
  { id: 10000010, rarity: "QUARTER_CENTURY_SECRET_RARE", condition: "NM", quantity: 1, forTrade: false },
  { id: 70781052, rarity: "ULTRA_RARE", condition: "NM", quantity: 1, forTrade: false },
  { id: 44095762, rarity: "SUPER_RARE", condition: "NM", quantity: 2, forTrade: true },
  { id: 83764718, rarity: "RARE", condition: "LP", quantity: 1, forTrade: false },
  { id: 55144522, rarity: "COMMON", condition: "LP", quantity: 3, forTrade: true },
  { id: 40640057, rarity: "COMMON", condition: "MP", quantity: 2, forTrade: true },
  { id: 77585513, rarity: "ULTRA_RARE", condition: "NM", quantity: 1, forTrade: false },
  { id: 5405694, rarity: "ULTRA_RARE", condition: "NM", quantity: 1, forTrade: false },
  { id: 44508094, rarity: "ULTRA_RARE", condition: "NM", quantity: 1, forTrade: true },
  { id: 71625222, rarity: "SUPER_RARE", condition: "LP", quantity: 1, forTrade: false },
  { id: 6368038, rarity: "RARE", condition: "NM", quantity: 1, forTrade: false },
];
const FRIEND_CARDS = [89631139, 46986414, 74677422, 40640057, 55144522, 70781052, 6368038, 44095762];
const COND_MULT = { NM: 1, LP: 0.85, MP: 0.7, HP: 0.5, DMG: 0.3 };

async function main() {
  const pw = await bcrypt.hash("duelist", 10);
  const defs = [
    { email: "you@vault.gg", username: "kristians", displayName: "Kristians" },
    { email: "mai@vault.gg", username: "mai", displayName: "Mai Valentine" },
    { email: "joey@vault.gg", username: "joey", displayName: "Joey Wheeler" },
  ];
  const users = {};
  for (const u of defs) {
    users[u.username] = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash: pw },
    });
  }
  console.log("Users ready:", Object.keys(users).join(", "));

  const have = await prisma.card.count();
  if (have > 0) {
    console.log(`Cards already present (${have}); skipping import.`);
  } else {
    const data = await loadCards();
    const cardRows = [];
    const printingRows = [];
    const seen = new Set();
    for (const c of data) {
      const frame = normFrame(c.frameType, c.race, c.type);
      cardRows.push({
        id: c.id,
        name: c.name,
        frame,
        attribute: c.attribute ?? null,
        typeLine: buildTypeLine(c, frame),
        race: c.race ?? null,
        atk: typeof c.atk === "number" ? c.atk : null,
        def: typeof c.def === "number" ? c.def : null,
        level: typeof c.level === "number" ? c.level : typeof c.rank === "number" ? c.rank : typeof c.linkval === "number" ? c.linkval : null,
        desc: c.desc ?? "",
        ...cardExtras(c),
      });
      for (const s of c.card_sets || []) {
        const rarity = normRarity(s.set_rarity);
        const key = `${c.id}|${s.set_code}|${rarity}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const price = parseFloat(s.set_price);
        printingRows.push({
          cardId: c.id,
          setName: s.set_name || "Unknown Set",
          setCode: s.set_code || "—",
          rarity,
          priceUsd: Number.isNaN(price) ? null : price,
        });
      }
    }
    console.log(`Inserting ${cardRows.length} cards, ${printingRows.length} printings…`);
    for (let i = 0; i < cardRows.length; i += 1000) await prisma.card.createMany({ data: cardRows.slice(i, i + 1000) });
    for (let i = 0; i < printingRows.length; i += 2000) await prisma.cardPrinting.createMany({ data: printingRows.slice(i, i + 2000) });
    console.log("Card import done.");
  }

  async function pickPrinting(cardId, preferRarity) {
    if (preferRarity) {
      const m = await prisma.cardPrinting.findFirst({ where: { cardId, rarity: preferRarity } });
      if (m) return m;
    }
    const any = await prisma.cardPrinting.findFirst({ where: { cardId }, orderBy: { priceUsd: "desc" } });
    if (any) return any;
    // synthetic printing so curated showcase cards always appear with the intended rarity
    const card = await prisma.card.findUnique({ where: { id: cardId } });
    if (!card) return null;
    return prisma.cardPrinting.create({ data: { cardId, setName: "Showcase", setCode: "DEMO", rarity: preferRarity || "COMMON", priceUsd: null } });
  }

  async function give(user, entries) {
    let n = 0;
    for (const e of entries) {
      const p = await pickPrinting(e.id, e.rarity);
      if (!p) continue;
      await prisma.ownedCard.upsert({
        where: { userId_printingId_condition: { userId: user.id, printingId: p.id, condition: e.condition || "NM" } },
        update: {},
        create: { userId: user.id, printingId: p.id, condition: e.condition || "NM", quantity: e.quantity || 1, forTrade: !!e.forTrade },
      });
      n++;
    }
    return n;
  }

  const kn = await give(users.kristians, STARTER);
  const mn = await give(users.mai, FRIEND_CARDS.map((id, i) => ({ id, condition: "NM", quantity: 1, forTrade: i % 3 === 0 })));
  const jn = await give(users.joey, FRIEND_CARDS.slice(2).map((id, i) => ({ id, condition: "LP", quantity: 1, forTrade: i % 2 === 0 })));
  console.log(`Collections — kristians: ${kn}, mai: ${mn}, joey: ${jn}`);

  // friendships (canonical userAId < userBId)
  async function befriend(a, b) {
    const [userAId, userBId] = [a.id, b.id].sort();
    await prisma.friendship.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      update: {},
      create: { userAId, userBId },
    });
  }
  await befriend(users.kristians, users.mai);
  await befriend(users.kristians, users.joey);
  await befriend(users.mai, users.joey);
  console.log("Friendships ready.");

  // a sample pending trade: Mai offers a for-trade card for one of Kristians' for-trade cards
  if ((await prisma.trade.count()) === 0) {
    const offer = await prisma.ownedCard.findFirst({
      where: { userId: users.mai.id, forTrade: true },
      include: { printing: { include: { card: true } } },
    });
    const request = await prisma.ownedCard.findFirst({
      where: { userId: users.kristians.id, forTrade: true },
      include: { printing: { include: { card: true } } },
    });
    if (offer && request) {
      const toItem = (o, side, ownerId) => ({
        side,
        ownerId,
        printingId: o.printingId,
        cardId: o.printing.card.id,
        cardName: o.printing.card.name,
        setName: o.printing.setName,
        setCode: o.printing.setCode,
        rarity: o.printing.rarity,
        condition: o.condition,
        quantity: 1,
        valueUsd: (o.printing.priceUsd || 0) * (COND_MULT[o.condition] || 1),
      });
      await prisma.trade.create({
        data: {
          proposerId: users.mai.id,
          receiverId: users.kristians.id,
          status: "PENDING",
          items: { create: [toItem(offer, "OFFER", users.mai.id), toItem(request, "REQUEST", users.kristians.id)] },
        },
      });
      console.log("Sample trade created (Mai -> Kristians).");
    }
  }

  if ((await prisma.notification.count()) === 0) {
    await prisma.notification.create({
      data: { userId: users.kristians.id, type: "TRADE_PROPOSED", body: "Mai Valentine proposed a trade", href: "/trades" },
    });
  }
  if ((await prisma.activityEvent.count()) === 0) {
    await prisma.activityEvent.createMany({
      data: [
        { userId: users.mai.id, type: "ADDED_CARD", body: "Mai Valentine added Blue-Eyes White Dragon", href: "/u/mai" },
        { userId: users.joey.id, type: "ADDED_CARD", body: "Joey Wheeler added Red-Eyes Black Dragon", href: "/u/joey" },
        { userId: users.mai.id, type: "TRADE_PROPOSED", body: "Mai Valentine proposed a trade to you", href: "/trades" },
      ],
    });
  }
  console.log("Sample notifications + activity ready.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
