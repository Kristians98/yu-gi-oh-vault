// Pull new cards / reprints from YGOPRODeck into the DB. Collections are untouched.
//   node prisma/sync-cards.mjs                    full sync (new sets + reprints + tag refresh)
//   node prisma/sync-cards.mjs --since 2026-01-01 only TCG releases since that date (fast; no reprints)
// A full sync also refreshes prisma/.cache/ygoprodeck.json for the enrich scripts.
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCards, syncCards } from "./card-sync.mjs";

const prisma = new PrismaClient();
const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, ".cache");

const sinceIdx = process.argv.indexOf("--since");
const since = sinceIdx > -1 ? process.argv[sinceIdx + 1] : undefined;
if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error("--since expects YYYY-MM-DD");
  process.exit(2);
}

async function main() {
  const data = await fetchCards({ since });
  if (!since) {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(join(CACHE_DIR, "ygoprodeck.json"), JSON.stringify(data));
    console.log("Cache refreshed.");
  }
  const s = await syncCards(prisma, { data, log: console.log });
  if (s.sampleNewCards.length) console.log("e.g.", s.sampleNewCards.join(", "));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
