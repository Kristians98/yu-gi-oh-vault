import { prisma } from "@/lib/prisma";
import { cronAuthed } from "@/lib/cron-auth";
import { normRarity } from "@/prisma/card-normalize.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Refreshes prices only for printings someone actually owns (keeps it cheap).
// Protected by the CRON_SECRET header. Schedule with cron / Task Scheduler / Vercel Cron.
export async function GET(req: Request) {
  if (!cronAuthed(req)) return new Response("forbidden", { status: 403 });

  const owned = await prisma.ownedCard.findMany({ select: { printingId: true } });
  const printingIds = [...new Set(owned.map((o) => o.printingId))];
  if (printingIds.length === 0) return Response.json({ updated: 0, owned: 0 });

  const printings = await prisma.cardPrinting.findMany({
    where: { id: { in: printingIds } },
    select: { id: true, cardId: true, setCode: true, rarity: true },
  });
  const cardIds = [...new Set(printings.map((p) => p.cardId))];

  let updated = 0;
  for (let i = 0; i < cardIds.length; i += 40) {
    const batch = cardIds.slice(i, i + 40);
    try {
      const res = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${batch.join(",")}`);
      if (!res.ok) continue;
      const data = (await res.json()).data || [];
      const priceByKey = new Map<string, number>();
      for (const c of data) {
        for (const s of c.card_sets || []) {
          const price = parseFloat(s.set_price);
          if (!Number.isNaN(price)) priceByKey.set(`${c.id}|${s.set_code}|${normRarity(s.set_rarity)}`, price);
        }
      }
      for (const p of printings) {
        if (!batch.includes(p.cardId)) continue;
        const price = priceByKey.get(`${p.cardId}|${p.setCode}|${p.rarity}`);
        if (price != null) {
          await prisma.cardPrinting.update({ where: { id: p.id }, data: { priceUsd: price } });
          updated++;
        }
      }
    } catch {
      /* skip this batch */
    }
  }

  return Response.json({ updated, owned: printingIds.length });
}
