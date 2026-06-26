"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { areFriends } from "@/lib/social";
import { displayNameOf, notify } from "@/lib/notify";

export async function getReactions(ownedCardId: string) {
  const session = await auth();
  const me = session?.user?.id;
  const rows = await prisma.reaction.findMany({ where: { ownedCardId } });
  const counts: Record<string, number> = {};
  const mine: string[] = [];
  for (const r of rows) {
    counts[r.emoji] = (counts[r.emoji] || 0) + 1;
    if (r.userId === me) mine.push(r.emoji);
  }
  return { counts, mine };
}

export async function toggleReaction(ownedCardId: string, emoji: string) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return;

  const card = await prisma.ownedCard.findUnique({ where: { id: ownedCardId }, select: { userId: true } });
  if (!card) return;
  // can only react to your own or a friend's card
  if (card.userId !== userId && !(await areFriends(userId, card.userId))) return;

  const existing = await prisma.reaction.findUnique({ where: { userId_ownedCardId_emoji: { userId, ownedCardId, emoji } } });
  if (existing) {
    await prisma.reaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.reaction.create({ data: { userId, ownedCardId, emoji } });
    if (card.userId !== userId) {
      await notify(card.userId, "REACTION", `${await displayNameOf(userId)} reacted ${emoji} to your card`, "/");
    }
  }
  revalidatePath("/");
}
