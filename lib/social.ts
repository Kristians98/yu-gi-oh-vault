import { prisma } from "@/lib/prisma";

/** All user ids that `userId` is friends with. */
export async function getFriendIds(userId: string): Promise<string[]> {
  const fs = await prisma.friendship.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
  });
  return fs.map((f) => (f.userAId === userId ? f.userBId : f.userAId));
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  const [userAId, userBId] = [a, b].sort();
  const f = await prisma.friendship.findUnique({ where: { userAId_userBId: { userAId, userBId } } });
  return !!f;
}

export async function getFriendsWithCounts(userId: string) {
  const ids = await getFriendIds(userId);
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: ids } } });
  const out = [];
  for (const u of users) {
    const sum = await prisma.ownedCard.aggregate({ where: { userId: u.id }, _sum: { quantity: true } });
    const forTradeCount = await prisma.ownedCard.count({ where: { userId: u.id, forTrade: true } });
    out.push({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      cardCount: sum._sum.quantity || 0,
      forTradeCount,
    });
  }
  return out.sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username));
}

export async function getIncomingRequests(userId: string) {
  const reqs = await prisma.friendRequest.findMany({
    where: { receiverId: userId, status: "PENDING" },
    include: { sender: true },
    orderBy: { createdAt: "desc" },
  });
  return reqs.map((r) => ({ id: r.id, username: r.sender.username, displayName: r.sender.displayName }));
}
