// Enrich already-seeded cards with archetype/banlist/handtrap/edison tags,
// in place (no re-download, no touching collections). Run: node prisma/enrich.mjs
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cardExtras } from "./card-tags.mjs";

const prisma = new PrismaClient();
const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, ".cache", "ygoprodeck.json");

async function main() {
  let data;
  if (existsSync(CACHE)) {
    data = JSON.parse(readFileSync(CACHE, "utf8"));
    console.log(`Enriching from cache (${data.length} cards)…`);
  } else {
    console.log("No cache — fetching from YGOPRODeck…");
    data = (await (await fetch("https://db.ygoprodeck.com/api/v7/cardinfo.php")).json()).data || [];
  }

  let ops = [];
  let n = 0;
  const flush = async () => {
    if (ops.length) {
      await prisma.$transaction(ops);
      ops = [];
    }
  };
  for (const c of data) {
    ops.push(prisma.card.updateMany({ where: { id: c.id }, data: cardExtras(c) }));
    if (ops.length >= 500) {
      await flush();
      n += 500;
      if (n % 2000 === 0) console.log("  enriched", n);
    }
  }
  await flush();

  const arche = await prisma.card.count({ where: { NOT: { archetype: null } } });
  const ht = await prisma.card.count({ where: { handTrap: true } });
  const tcgF = await prisma.card.count({ where: { banTcg: "Forbidden" } });
  const goat = await prisma.card.count({ where: { NOT: { banGoat: null } } });
  console.log(`Done. archetype: ${arche}, hand traps: ${ht}, TCG-forbidden: ${tcgF}, goat-listed: ${goat}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
