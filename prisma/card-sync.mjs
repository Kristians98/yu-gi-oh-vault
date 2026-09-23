// Card DB sync: bring Card + CardPrinting up to date with YGOPRODeck WITHOUT touching
// anything users own. Inserts new cards (new sets) and new printings (reprints of old
// cards), and refreshes the derived tag columns (banlist status, archetype, dates) on
// cards where they changed. Existing printings are left alone (the app holds no price
// data). Safe to run on an empty DB (that is how the seed imports).
import { YGOPRODECK_API, toCardRow, toPrintingRows, printingKey } from "./card-normalize.mjs";

const TAG_FIELDS = ["archetype", "banTcg", "banGoat", "banEdison", "handTrap", "tcgDate", "linkval", "isTuner"];

/** Fetch the card list. `since` (YYYY-MM-DD) narrows it to TCG releases on/after that
 *  date — cheap, but it cannot see reprints of older cards; omit it for a full sync. */
export async function fetchCards({ since } = {}) {
  const url = new URL(YGOPRODECK_API);
  url.searchParams.set("misc", "yes");
  if (since) {
    url.searchParams.set("startdate", since);
    url.searchParams.set("enddate", new Date().toISOString().slice(0, 10));
    url.searchParams.set("dateregion", "tcg");
  }
  const res = await fetch(url, { headers: { "user-agent": "duel-vault card sync" } });
  if (res.status === 400) {
    // YGOPRODeck answers an empty date window with 400 "No card matching your query was found."
    const body = await res.json().catch(() => ({}));
    if (/no card matching/i.test(body?.error || "")) return [];
  }
  if (!res.ok) throw new Error(`YGOPRODeck fetch failed: ${res.status}`);
  return (await res.json()).data || [];
}

/**
 * @param prisma  PrismaClient
 * @param opts.data   pre-fetched YGOPRODeck records (skips the network)
 * @param opts.since  passed to fetchCards when `data` is not given
 * @param opts.log    progress logger (defaults to silent)
 */
export async function syncCards(prisma, { data, since, log = () => {} } = {}) {
  const t0 = Date.now();
  if (!data) {
    log(since ? `Fetching TCG cards released since ${since}…` : "Fetching full card DB from YGOPRODeck…");
    data = await fetchCards({ since });
  }
  log(`${data.length} records from YGOPRODeck.`);

  // Current state — ids only for printings, tag columns for cards (small enough to hold).
  const existingCards = new Map();
  for (const c of await prisma.card.findMany({ select: { id: true, ...Object.fromEntries(TAG_FIELDS.map((f) => [f, true])) } })) {
    existingCards.set(c.id, c);
  }
  const existingPrintings = new Set();
  for (const p of await prisma.cardPrinting.findMany({ select: { cardId: true, setCode: true, rarity: true } })) {
    existingPrintings.add(printingKey(p.cardId, p.setCode, p.rarity));
  }

  const newCards = [];
  const changedTags = []; // { id, data }
  const newPrintings = [];
  const seenIds = new Set();
  for (const c of data) {
    if (!c || typeof c.id !== "number" || seenIds.has(c.id)) continue;
    seenIds.add(c.id);
    const row = toCardRow(c);
    const have = existingCards.get(c.id);
    if (!have) {
      newCards.push(row);
    } else {
      const diff = {};
      for (const f of TAG_FIELDS) if (row[f] !== have[f]) diff[f] = row[f];
      if (Object.keys(diff).length) changedTags.push({ id: c.id, data: diff });
    }
    for (const p of toPrintingRows(c)) {
      const key = printingKey(p.cardId, p.setCode, p.rarity);
      if (existingPrintings.has(key)) continue;
      existingPrintings.add(key);
      newPrintings.push(p);
    }
  }

  log(`New cards: ${newCards.length} · new printings: ${newPrintings.length} · tag updates: ${changedTags.length}`);

  for (let i = 0; i < newCards.length; i += 1000) {
    await prisma.card.createMany({ data: newCards.slice(i, i + 1000) });
  }
  // Printings reference cards, so they go in after all cards exist.
  for (let i = 0; i < newPrintings.length; i += 2000) {
    await prisma.cardPrinting.createMany({ data: newPrintings.slice(i, i + 2000) });
  }
  for (let i = 0; i < changedTags.length; i += 200) {
    await prisma.$transaction(changedTags.slice(i, i + 200).map(({ id, data }) => prisma.card.update({ where: { id }, data })));
  }

  const summary = {
    fetched: data.length,
    newCards: newCards.length,
    newPrintings: newPrintings.length,
    tagUpdates: changedTags.length,
    sampleNewCards: newCards.slice(0, 10).map((c) => c.name),
    ms: Date.now() - t0,
  };
  log(`Sync done in ${(summary.ms / 1000).toFixed(1)}s.`);
  return summary;
}
