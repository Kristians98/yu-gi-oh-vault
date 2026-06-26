"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { aiConfigured, identifyCardFromImage } from "@/lib/azure-vision";
import { rateLimit } from "@/lib/rate-limit";

function shape(c: { id: number; name: string; frame: string; printings: { id: string; setName: string; setCode: string; rarity: string; priceUsd: number | null }[] }) {
  return {
    id: c.id,
    name: c.name,
    frame: c.frame,
    printings: c.printings.map((p) => ({ id: p.id, setName: p.setName, setCode: p.setCode, rarity: p.rarity, priceUsd: p.priceUsd })),
  };
}

/** The 8-digit passcode IS the YGOPRODeck id — an exact match. */
export async function identifyByPasscode(passcode: number) {
  if (!Number.isFinite(passcode)) return null;
  const c = await prisma.card.findUnique({
    where: { id: passcode },
    include: { printings: { orderBy: [{ priceUsd: "desc" }] } },
  });
  return c ? shape(c) : null;
}

/** The set code (e.g. LOB-EN001) pins the exact printing → resolves set + rarity. */
export async function findPrintingBySetCode(setCode: string) {
  const p = await prisma.cardPrinting.findFirst({ where: { setCode: setCode.toUpperCase() } });
  return p ? p.id : null;
}

/** Ask Azure gpt-4o-mini to read a card photo → { name, passcode, setCode }.
 *  Rate-limited per user so a loop can't run up the (paid) vision bill. */
export async function aiIdentify(dataUrl: string) {
  const s = await auth();
  if (!s?.user?.id) return null;
  if (!rateLimit(`scan:min:${s.user.id}`, 20, 60_000)) return null;
  if (!rateLimit(`scan:day:${s.user.id}`, 300, 86_400_000)) return null;
  return identifyCardFromImage(dataUrl);
}

export async function aiScanEnabled() {
  return aiConfigured();
}
