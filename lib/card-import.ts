// On-demand import: when a scan or search finds nothing locally, ask YGOPRODeck for cards
// matching the name and add the ones we do not have yet (card + printings), using the
// same row mapping as the weekly sync. Keeps brand-new releases scannable between syncs.
import { prisma } from "@/lib/prisma";
import { YGOPRODECK_API, toCardRow, toPrintingRows, printingKey } from "@/prisma/card-normalize.mjs";

type Record_ = { id: number; name: string };

/** Fuzzy name lookup on YGOPRODeck (`fname`), import missing cards. Returns imported ids. */
export async function importCardsByName(name: string): Promise<number[]> {
  const q = name.trim();
  if (q.length < 3) return [];
  let data: Record_[] = [];
  try {
    const url = new URL(YGOPRODECK_API);
    url.searchParams.set("fname", q);
    url.searchParams.set("misc", "yes");
    const res = await fetch(url, { headers: { "user-agent": "virtual-binder on-demand import" }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return []; // 400 = "no card matching" — nothing to import
    data = ((await res.json()).data || []).slice(0, 40);
  } catch {
    return [];
  }
  if (data.length === 0) return [];

  const have = new Set((await prisma.card.findMany({ where: { id: { in: data.map((c) => c.id) } }, select: { id: true } })).map((c) => c.id));
  const fresh = data.filter((c) => !have.has(c.id));
  if (fresh.length === 0) return [];

  const rows = fresh.map(toCardRow);
  const printings = fresh.flatMap(toPrintingRows);
  const seen = new Set<string>();
  const uniq = printings.filter((p) => {
    const k = printingKey(p.cardId, p.setCode, p.rarity);
    return seen.has(k) ? false : (seen.add(k), true);
  });
  await prisma.card.createMany({ data: rows });
  if (uniq.length) await prisma.cardPrinting.createMany({ data: uniq });
  return fresh.map((c) => c.id);
}
