// Backfill Card.linkval (Link Rating) and Card.isTuner from the cached YGOPRODeck dump
// (or the API if no cache). Run: node prisma/enrich-links.mjs
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const prisma = new PrismaClient();
const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, ".cache", "ygoprodeck.json");

async function main() {
  let data;
  if (existsSync(CACHE)) {
    data = JSON.parse(readFileSync(CACHE, "utf8"));
    console.log(`Using cache: ${data.length} cards`);
  } else {
    console.log("No cache — fetching from YGOPRODeck…");
    data = (await (await fetch("https://db.ygoprodeck.com/api/v7/cardinfo.php")).json()).data || [];
  }
  console.log("Setting linkval + isTuner…");

  let ops = [];
  let done = 0;
  const flush = async () => { if (ops.length) { await prisma.$transaction(ops); done += ops.length; ops = []; } };
  for (const c of data) {
    ops.push(prisma.card.updateMany({ where: { id: c.id }, data: { linkval: c.linkval ?? null, isTuner: /tuner/i.test(c.type || "") } }));
    if (ops.length >= 500) { await flush(); if (done % 2000 === 0) console.log("  ", done); }
  }
  await flush();

  const links = await prisma.card.count({ where: { NOT: { linkval: null } } });
  const tuners = await prisma.card.count({ where: { isTuner: true } });
  console.log(`Done. linkval set: ${links} | Tuners: ${tuners}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
