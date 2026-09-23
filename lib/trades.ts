"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { areFriends } from "@/lib/social";
import { displayNameOf, logActivity, notify } from "@/lib/notify";
import { planTransfer } from "@/lib/value";

async function me(): Promise<string> {
  const s = await auth();
  if (!s?.user?.id) throw new Error("Not signed in");
  return s.user.id;
}

type OwnedWithCard = {
  printingId: string;
  condition: string;
  printing: { setName: string; setCode: string; rarity: string; card: { id: number; name: string } };
};

export async function proposeTrade(input: {
  receiverId: string;
  offerOwnedIds: string[];
  requestOwnedIds: string[];
}): Promise<string | undefined> {
  const userId = await me();
  if (!(await areFriends(userId, input.receiverId))) return "You can only trade with friends.";
  if (input.offerOwnedIds.length === 0 && input.requestOwnedIds.length === 0) return "Add at least one card to the trade.";

  const offer = await prisma.ownedCard.findMany({
    where: { id: { in: input.offerOwnedIds }, userId },
    include: { printing: { include: { card: true } } },
  });
  const request = await prisma.ownedCard.findMany({
    where: { id: { in: input.requestOwnedIds }, userId: input.receiverId },
    include: { printing: { include: { card: true } } },
  });

  const item = (o: OwnedWithCard, side: string, ownerId: string) => ({
    side,
    ownerId,
    printingId: o.printingId,
    cardId: o.printing.card.id,
    cardName: o.printing.card.name,
    setName: o.printing.setName,
    setCode: o.printing.setCode,
    rarity: o.printing.rarity,
    condition: o.condition,
    quantity: 1,
  });

  const trade = await prisma.trade.create({
    data: {
      proposerId: userId,
      receiverId: input.receiverId,
      status: "PENDING",
      items: {
        create: [
          ...offer.map((o) => item(o, "OFFER", userId)),
          ...request.map((o) => item(o, "REQUEST", input.receiverId)),
        ],
      },
    },
  });

  const meName = await displayNameOf(userId);
  await notify(input.receiverId, "TRADE_PROPOSED", `${meName} proposed a trade`, `/trades/${trade.id}`);
  await logActivity(userId, "TRADE_PROPOSED", `${meName} proposed a trade`, `/trades/${trade.id}`);
  revalidatePath("/trades");
  return undefined;
}

export async function acceptTrade(id: string) {
  const userId = await me();
  const t = await prisma.trade.findFirst({ where: { id, receiverId: userId, status: "PENDING" } });
  if (!t) return;
  await prisma.trade.update({ where: { id }, data: { status: "ACCEPTED" } });
  await notify(t.proposerId, "TRADE_ACCEPTED", `${await displayNameOf(userId)} accepted your trade — confirm the handoff`, `/trades/${id}`);
  revalidatePath(`/trades/${id}`);
  revalidatePath("/trades");
}

export async function declineTrade(id: string) {
  const userId = await me();
  const t = await prisma.trade.findFirst({ where: { id, receiverId: userId, status: "PENDING" } });
  if (!t) return;
  await prisma.trade.update({ where: { id }, data: { status: "DECLINED" } });
  await notify(t.proposerId, "TRADE_DECLINED", `${await displayNameOf(userId)} declined your trade`, `/trades/${id}`);
  revalidatePath(`/trades/${id}`);
  revalidatePath("/trades");
}

export async function cancelTrade(id: string) {
  const userId = await me();
  const t = await prisma.trade.findFirst({ where: { id, proposerId: userId, status: { in: ["PENDING", "ACCEPTED"] } } });
  if (!t) return;
  await prisma.trade.update({ where: { id }, data: { status: "CANCELLED" } });
  await notify(t.receiverId, "TRADE_CANCELLED", `${await displayNameOf(userId)} cancelled a trade`, `/trades/${id}`);
  revalidatePath(`/trades/${id}`);
  revalidatePath("/trades");
}

/** Two-sided completion: each party confirms; when both have, ownership transfers in-app. */
export async function confirmTrade(id: string) {
  const userId = await me();
  const trade = await prisma.trade.findUnique({ where: { id }, include: { items: true } });
  if (!trade || trade.status !== "ACCEPTED") return;
  const isProposer = trade.proposerId === userId;
  const isReceiver = trade.receiverId === userId;
  if (!isProposer && !isReceiver) return;

  const data: { proposerConfirmed?: boolean; receiverConfirmed?: boolean } = {};
  if (isProposer) data.proposerConfirmed = true;
  if (isReceiver) data.receiverConfirmed = true;
  const updated = await prisma.trade.update({ where: { id }, data, include: { items: true } });

  if (updated.proposerConfirmed && updated.receiverConfirmed) {
    await prisma.$transaction(async (tx) => {
      for (const t of planTransfer(updated.items, updated.proposerId, updated.receiverId)) {
        const src = await tx.ownedCard.findFirst({ where: { userId: t.from, printingId: t.printingId, condition: t.condition } });
        if (!src) continue; // owner no longer has it — skip (no phantom cards)
        if (src.quantity <= t.quantity) await tx.ownedCard.delete({ where: { id: src.id } });
        else await tx.ownedCard.update({ where: { id: src.id }, data: { quantity: { decrement: t.quantity } } });
        await tx.ownedCard.upsert({
          where: { userId_printingId_condition: { userId: t.to, printingId: t.printingId, condition: t.condition } },
          update: { quantity: { increment: t.quantity } },
          create: { userId: t.to, printingId: t.printingId, condition: t.condition, quantity: t.quantity, forTrade: false },
        });
      }
      await tx.trade.update({ where: { id }, data: { status: "COMPLETED" } });
    });
    const pName = await displayNameOf(updated.proposerId);
    const rName = await displayNameOf(updated.receiverId);
    await notify(updated.proposerId, "TRADE_DONE", `Your trade with ${rName} is complete`, `/trades/${id}`);
    await notify(updated.receiverId, "TRADE_DONE", `Your trade with ${pName} is complete`, `/trades/${id}`);
    await logActivity(userId, "TRADE_DONE", `${pName} and ${rName} completed a trade`, `/trades/${id}`);
  } else {
    const other = isProposer ? updated.receiverId : updated.proposerId;
    await notify(other, "TRADE_CONFIRM", `${await displayNameOf(userId)} confirmed the swap — your turn`, `/trades/${id}`);
  }
  revalidatePath(`/trades/${id}`);
  revalidatePath("/trades");
  revalidatePath("/");
}

export async function sendTradeMessage(tradeId: string, body: string): Promise<string | undefined> {
  const userId = await me();
  const text = body.trim().slice(0, 1000);
  if (!text) return;
  const t = await prisma.trade.findFirst({ where: { id: tradeId, OR: [{ proposerId: userId }, { receiverId: userId }] } });
  if (!t) return "Not your trade.";
  await prisma.tradeMessage.create({ data: { tradeId, senderId: userId, body: text } });
  const other = t.proposerId === userId ? t.receiverId : t.proposerId;
  await notify(other, "TRADE_MESSAGE", `${await displayNameOf(userId)} messaged you about a trade`, `/trades/${tradeId}`);
  revalidatePath(`/trades/${tradeId}`);
}
