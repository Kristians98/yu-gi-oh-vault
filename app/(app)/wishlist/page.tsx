import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getFriendIds } from "@/lib/social";
import { WishlistPanel } from "@/components/wishlist-panel";

export default async function WishlistPage() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const userId = session.user.id;

  const items = await prisma.wishlistItem.findMany({
    where: { userId },
    include: { card: true },
    orderBy: { createdAt: "desc" },
  });

  const friendIds = await getFriendIds(userId);
  const cardIds = items.map((i) => i.cardId);

  const owned =
    cardIds.length && friendIds.length
      ? await prisma.ownedCard.findMany({
          where: { userId: { in: friendIds }, forTrade: true, printing: { cardId: { in: cardIds } } },
          include: { user: true, printing: true },
        })
      : [];

  const matchMap = new Map<number, { username: string; displayName: string | null; rarity: string; condition: string }[]>();
  for (const o of owned) {
    const list = matchMap.get(o.printing.cardId) ?? [];
    list.push({ username: o.user.username, displayName: o.user.displayName, rarity: o.printing.rarity, condition: o.condition });
    matchMap.set(o.printing.cardId, list);
  }

  const data = items.map((i) => ({
    id: i.id,
    cardId: i.cardId,
    name: i.card.name,
    matches: matchMap.get(i.cardId) ?? [],
  }));

  return (
    <>
      <header className="topbar">
        <div>
          <span className="page-eyebrow">Collection</span>
          <h1 className="page-title">Wishlist</h1>
        </div>
      </header>
      <div className="content">
        <WishlistPanel items={data} />
      </div>
    </>
  );
}
