// Re-fetch card data WITH release dates (misc=yes), refresh the cache, and update
// all tag columns incl. tcgDate. Run: node prisma/enrich-dates.mjs
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cardExtras } from "./card-tags.mjs";

const prisma = new PrismaClient();
const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, ".cache", "ygoprodeck.json");

async function main() {
  console.log("Fetching card data with release dates (misc=yes)…");
  const data = (await (await fetch("https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes")).json()).data || [];
  writeFileSync(CACHE, JSON.stringify(data)); // refresh cache so it now carries misc/dates
  console.log(`Fetched ${data.length} — updating tags + dates…`);

  let ops = [];
  let n = 0;
  const flush = async () => { if (ops.length) { await prisma.$transaction(ops); ops = []; } };
  for (const c of data) {
    ops.push(prisma.card.updateMany({ where: { id: c.id }, data: cardExtras(c) }));
    if (ops.length >= 500) { await flush(); n += 500; if (n % 2000 === 0) console.log("  ", n); }
  }
  await flush();

  const dated = await prisma.card.count({ where: { NOT: { tcgDate: null } } });
  const goatEra = await prisma.card.count({ where: { tcgDate: { lte: "2005-09-01" } } });
  const edisonEra = await prisma.card.count({ where: { tcgDate: { lte: "2010-04-01" } } });
  console.log(`Done. with tcgDate: ${dated} | goat-era (<=2005-09): ${goatEra} | edison-era (<=2010-04): ${edisonEra}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
