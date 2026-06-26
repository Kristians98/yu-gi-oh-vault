import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { areFriends } from "@/lib/social";
import { CONDITION_MULT, type Condition } from "@/lib/cards";
import { TradeBuilder } from "@/components/trade-builder";

export default async function NewTradePage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { to } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!to) redirect("/friends");

  const receiver = await prisma.user.findUnique({ where: { username: to } });
  if (!receiver || receiver.id === session.user.id || !(await areFriends(session.user.id, receiver.id))) redirect("/friends");

  const [mine, theirs] = await Promise.all([
    prisma.ownedCard.findMany({ where: { userId: session.user.id, forTrade: true }, include: { printing: { include: { card: true } } } }),
    prisma.ownedCard.findMany({ where: { userId: receiver.id, forTrade: true }, include: { printing: { include: { card: true } } } }),
  ]);

  const toTile = (o: (typeof mine)[number]) => ({
    ownedId: o.id,
    cardId: o.printing.card.id,
    name: o.printing.card.name,
    rarity: o.printing.rarity,
    setCode: o.printing.setCode,
    condition: o.condition,
    value: (o.printing.priceUsd || 0) * (CONDITION_MULT[o.condition as Condition] || 1),
  });

  return (
    <TradeBuilder
      receiver={{ id: receiver.id, name: receiver.displayName || receiver.username, username: receiver.username }}
      myCards={mine.map(toTile)}
      theirCards={theirs.map(toTile)}
    />
  );
}
