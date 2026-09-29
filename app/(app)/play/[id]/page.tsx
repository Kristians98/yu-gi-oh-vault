import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { deckAiConfigured } from "@/lib/deck-ai";
import { loadDuelView } from "@/lib/duel-view";
import { DuelRoom } from "@/components/duel-room";

// Deck builds/rebuilds (gpt-5.4) take ~15–20s — server actions fired from this page run
// under this segment's limit, so allow the longest the plan permits.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export default async function DuelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) return null;
  const view = await loadDuelView(id, session.user.id);
  if (!view) notFound();
  return <DuelRoom view={view} aiOn={deckAiConfigured()} />;
}
