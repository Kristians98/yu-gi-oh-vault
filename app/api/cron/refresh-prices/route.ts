import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Same rarity normalization the seed uses, so fetched prices key to stored printings.
function normRarity(s: string): string {
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

// Refreshes prices only for printings someone actually owns (keeps it cheap).
// Protected by the CRON_SECRET header. Schedule with cron / Task Scheduler / Vercel Cron.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  // Accept Vercel Cron's `Authorization: Bearer <CRON_SECRET>` header, or a manual `x-cron-secret`.
  const authed = !!secret && (req.headers.get("authorization") === `Bearer ${secret}` || req.headers.get("x-cron-secret") === secret);
  if (!authed) return new Response("forbidden", { status: 403 });

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
