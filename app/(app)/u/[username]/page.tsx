import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { areFriends } from "@/lib/social";
import { toDisplayCard } from "@/lib/map";
import { FriendBinder } from "@/components/friend-binder";

export default async function FriendBinderPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const session = await auth();
  if (!session?.user?.id) return null;

  const owner = await prisma.user.findUnique({ where: { username } });
  if (!owner) notFound();

  const isSelf = owner.id === session.user.id;
  if (!isSelf && !(await areFriends(session.user.id, owner.id))) {
    return (
      <>
        <header className="topbar">
          <div>
            <span className="page-eyebrow">Friend</span>
            <h1 className="page-title">Private binder</h1>
          </div>
        </header>
        <div className="content">
          <div className="grid__empty">You can only view {owner.displayName || owner.username}&rsquo;s binder once you&rsquo;re friends.</div>
        </div>
      </>
    );
  }

  const owned = await prisma.ownedCard.findMany({
    where: { userId: owner.id },
    include: { printing: { include: { card: true } } },
    orderBy: { createdAt: "desc" },
  });

  const wantedIds = isSelf
    ? []
    : (await prisma.wishlistItem.findMany({ where: { userId: session.user.id }, select: { cardId: true } })).map((w) => w.cardId);

  return (
    <FriendBinder
      ownerName={owner.displayName || owner.username}
      username={owner.username}
      cards={owned.map(toDisplayCard)}
      wantedIds={wantedIds}
    />
  );
}
