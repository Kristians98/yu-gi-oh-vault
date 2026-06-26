import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DeckBuilder } from "@/components/deck-builder";
import { deckAiConfigured } from "@/lib/deck-ai";

// gpt-5.4 deck build/refine can take ~15–20s — allow the longest the plan permits.
export const maxDuration = 60;

export default async function DecksPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const decks = await prisma.deck.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, format: true, strategy: true, poolMode: true, cards: true },
  });

  return <DeckBuilder aiOn={deckAiConfigured()} savedDecks={decks} />;
}
