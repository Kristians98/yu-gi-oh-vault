"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/notify";

async function requireUser(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  return session.user.id;
}

export async function searchCards(q: string) {
  const needle = (q || "").trim();
  if (needle.length < 2) return [];
  const cards = await prisma.card.findMany({
    where: { name: { contains: needle } },
    take: 16,
    orderBy: { name: "asc" },
    include: { printings: { orderBy: [{ priceUsd: "desc" }] } },
  });
  return cards.map((c) => ({
    id: c.id,
    name: c.name,
    frame: c.frame,
    printings: c.printings.map((p) => ({
      id: p.id,
      setName: p.setName,
      setCode: p.setCode,
      rarity: p.rarity,
      priceUsd: p.priceUsd,
    })),
  }));
}

export async function addToCollection(input: {
  printingId: string;
  condition: string;
  quantity: number;
  forTrade: boolean;
}) {
  const userId = await requireUser();
  const qty = Math.max(1, Math.floor(input.quantity) || 1);
  await prisma.ownedCard.upsert({
    where: { userId_printingId_condition: { userId, printingId: input.printingId, condition: input.condition } },
    update: { quantity: { increment: qty }, forTrade: input.forTrade },
    create: { userId, printingId: input.printingId, condition: input.condition, quantity: qty, forTrade: input.forTrade },
  });

  const printing = await prisma.cardPrinting.findUnique({ where: { id: input.printingId }, include: { card: true } });
  const meUser = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true } });
  if (printing && meUser) {
    await logActivity(userId, "ADDED_CARD", `${meUser.displayName || meUser.username} added ${printing.card.name}`, `/u/${meUser.username}`);
  }
  revalidatePath("/");
}

export async function removeOwnedCard(ownedId: string) {
  const userId = await requireUser();
  await prisma.ownedCard.deleteMany({ where: { id: ownedId, userId } });
  revalidatePath("/");
}

export async function setForTrade(ownedId: string, forTrade: boolean) {
  const userId = await requireUser();
  await prisma.ownedCard.updateMany({ where: { id: ownedId, userId }, data: { forTrade } });
  revalidatePath("/");
}

export async function setQuantity(ownedId: string, quantity: number) {
  const userId = await requireUser();
  if (quantity <= 0) {
    await prisma.ownedCard.deleteMany({ where: { id: ownedId, userId } });
  } else {
    await prisma.ownedCard.updateMany({ where: { id: ownedId, userId }, data: { quantity: Math.floor(quantity) } });
  }
  revalidatePath("/");
}

/** Search products/sets by name → distinct set names with their card counts. */
export async function searchSets(q: string) {
  const needle = (q || "").trim();
  if (needle.length < 2) return [];
  const groups = await prisma.cardPrinting.groupBy({
    by: ["setName"],
    where: { setName: { contains: needle } },
    _count: { _all: true },
  });
  return groups
    .map((g) => ({ setName: g.setName, count: g._count._all }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

/** Add one of every card in a product/set to the collection. */
export async function addSet(setName: string) {
  const userId = await requireUser();
  const printings = await prisma.cardPrinting.findMany({ where: { setName }, select: { id: true } });
  if (printings.length === 0) return { added: 0, setName };
  // Add one copy of every card; STACK quantity on cards already owned, so a product
  // can be added multiple times (own 2 decks → 2 of each). SQLite createMany has no
  // upsert, so split: bump existing, create the rest.
  const ids = printings.map((p) => p.id);
  const existing = await prisma.ownedCard.findMany({ where: { userId, condition: "NM", printingId: { in: ids } }, select: { printingId: true } });
  const have = new Set(existing.map((e) => e.printingId));
  const toCreate = ids.filter((id) => !have.has(id));
  const toBump = ids.filter((id) => have.has(id));
  if (toBump.length) {
    await prisma.ownedCard.updateMany({ where: { userId, condition: "NM", printingId: { in: toBump } }, data: { quantity: { increment: 1 } } });
  }
  if (toCreate.length) {
    await prisma.ownedCard.createMany({ data: toCreate.map((id) => ({ userId, printingId: id, condition: "NM", quantity: 1, forTrade: false })) });
  }
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true } });
  if (me) await logActivity(userId, "ADDED_SET", `${me.displayName || me.username} added ${setName} (${ids.length} cards)`, `/u/${me.username}`);
  revalidatePath("/");
  return { added: ids.length, setName };
}
