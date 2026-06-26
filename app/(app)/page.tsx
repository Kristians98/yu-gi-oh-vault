import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Binder } from "@/components/binder";
import { toDisplayCard } from "@/lib/map";

export default async function BinderPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const owned = await prisma.ownedCard.findMany({
    where: { userId: session.user.id },
    include: { printing: { include: { card: true } } },
    orderBy: { createdAt: "desc" },
  });

  return <Binder initialCards={owned.map(toDisplayCard)} />;
}
