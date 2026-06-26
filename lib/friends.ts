"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { displayNameOf, notify } from "@/lib/notify";

async function me(): Promise<string> {
  const s = await auth();
  if (!s?.user?.id) throw new Error("Not signed in");
  return s.user.id;
}

export async function sendFriendRequest(username: string): Promise<string | undefined> {
  const userId = await me();
  const target = await prisma.user.findUnique({ where: { username: username.trim().toLowerCase() } });
  if (!target) return "No duelist with that username.";
  if (target.id === userId) return "That's you.";

  const [a, b] = [userId, target.id].sort();
  if (await prisma.friendship.findUnique({ where: { userAId_userBId: { userAId: a, userBId: b } } })) {
    return "You're already friends.";
  }

  // If they already sent you a request, accept it instead.
  const reverse = await prisma.friendRequest.findUnique({
    where: { senderId_receiverId: { senderId: target.id, receiverId: userId } },
  });
  if (reverse && reverse.status === "PENDING") {
    await prisma.$transaction([
      prisma.friendship.create({ data: { userAId: a, userBId: b } }),
      prisma.friendRequest.update({ where: { id: reverse.id }, data: { status: "ACCEPTED" } }),
    ]);
    await notify(target.id, "FRIEND_ACCEPTED", `${await displayNameOf(userId)} accepted your friend request`, "/friends");
    revalidatePath("/friends");
    return undefined;
  }

  await prisma.friendRequest.upsert({
    where: { senderId_receiverId: { senderId: userId, receiverId: target.id } },
    update: { status: "PENDING" },
    create: { senderId: userId, receiverId: target.id, status: "PENDING" },
  });
  await notify(target.id, "FRIEND_REQUEST", `${await displayNameOf(userId)} sent you a friend request`, "/friends");
  revalidatePath("/friends");
  return undefined;
}

export async function acceptFriendRequest(requestId: string) {
  const userId = await me();
  const req = await prisma.friendRequest.findUnique({ where: { id: requestId } });
  if (!req || req.receiverId !== userId) return;
  const [a, b] = [req.senderId, req.receiverId].sort();
  await prisma.$transaction([
    prisma.friendship.upsert({
      where: { userAId_userBId: { userAId: a, userBId: b } },
      update: {},
      create: { userAId: a, userBId: b },
    }),
    prisma.friendRequest.update({ where: { id: requestId }, data: { status: "ACCEPTED" } }),
  ]);
  await notify(req.senderId, "FRIEND_ACCEPTED", `${await displayNameOf(userId)} accepted your friend request`, "/friends");
  revalidatePath("/friends");
}

export async function declineFriendRequest(requestId: string) {
  const userId = await me();
  await prisma.friendRequest.updateMany({
    where: { id: requestId, receiverId: userId },
    data: { status: "DECLINED" },
  });
  revalidatePath("/friends");
}

export async function removeFriend(friendUserId: string) {
  const userId = await me();
  const [a, b] = [userId, friendUserId].sort();
  await prisma.friendship.deleteMany({ where: { userAId: a, userBId: b } });
  revalidatePath("/friends");
}
