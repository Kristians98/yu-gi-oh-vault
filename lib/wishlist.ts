"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

async function uid(): Promise<string> {
  const s = await auth();
  if (!s?.user?.id) throw new Error("Not signed in");
  return s.user.id;
}

export async function addToWishlist(cardId: number) {
  const userId = await uid();
  await prisma.wishlistItem.upsert({
    where: { userId_cardId: { userId, cardId } },
    update: {},
    create: { userId, cardId },
  });
  revalidatePath("/wishlist");
}

export async function removeWishlistItem(id: string) {
  const userId = await uid();
  await prisma.wishlistItem.deleteMany({ where: { id, userId } });
  revalidatePath("/wishlist");
}
