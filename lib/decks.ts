"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { refineDeckJSON, type RawDeck } from "@/lib/deck-ai";
import {
  buildDeckForUser,
  finalizeDeck,
  normalizeFormat,
  normalizePoolMode,
  ownedByCard,
  type DeckCards,
  type DeckCardEntry,
  type DeckFormat,
  type DeckResult,
  type PoolMode,
} from "@/lib/deck-engine";
import type { Thinking } from "@/lib/thinking";

// Server actions for the Decks page. The engine itself (legality, resolution, scoring)
// lives in lib/deck-engine.ts so Play can build decks for either player.

async function requireUser(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  return session.user.id;
}

/** Generate (but don't save) a deck. Returns a render-ready result with warnings. */
export async function generateDeck(input: { format: DeckFormat; strategy: string; poolMode: PoolMode; thinking?: Thinking }): Promise<DeckResult> {
  const userId = await requireUser();
  return buildDeckForUser(userId, { format: input.format, strategy: input.strategy ?? "", poolMode: input.poolMode, thinking: input.thinking });
}

/** Conversationally refine a built deck — answer a question, or apply a change and
 *  return the full re-validated/re-scored deck. */
export async function refineDeck(input: {
  format: DeckFormat;
  poolMode: PoolMode;
  current: DeckCards;
  currentName: string;
  currentStrategy: string;
  history: { role: string; content: string }[];
  message: string;
  thinking?: Thinking;
}): Promise<{ reply: string; result: DeckResult | null }> {
  const userId = await requireUser();
  const format = normalizeFormat(input.format);
  const poolMode = normalizePoolMode(input.poolMode);
  const owned = await ownedByCard(userId);
  const strip = (a: DeckCardEntry[]) => a.map((e) => ({ name: e.name, copies: e.copies }));
  const r = await refineDeckJSON({
    format, poolMode,
    current: { main: strip(input.current.main), extra: strip(input.current.extra), side: strip(input.current.side) },
    currentName: input.currentName,
    currentStrategy: input.currentStrategy,
    history: input.history ?? [],
    message: input.message,
    thinking: input.thinking,
  });
  if (r.changed && (r.mainDeck?.length || r.extraDeck?.length)) {
    const rawDeck: RawDeck = {
      deckName: r.deckName || input.currentName || "Untitled Deck",
      strategy: r.strategy || input.currentStrategy || "",
      mainDeck: r.mainDeck ?? [],
      extraDeck: r.extraDeck ?? [],
      sideDeck: r.sideDeck ?? [],
    };
    return { reply: r.reply, result: await finalizeDeck(rawDeck, format, poolMode, owned) };
  }
  return { reply: r.reply, result: null };
}

/** Persist a generated deck. `cards` is the render-ready DeckCards (id/name/copies/frame). */
export async function saveDeck(input: { name: string; format: DeckFormat; strategy: string; poolMode: PoolMode; cards: DeckCards }): Promise<{ id: string }> {
  const userId = await requireUser();
  const name = (input.name || "Untitled Deck").trim().slice(0, 80);
  const deck = await prisma.deck.create({
    data: {
      userId,
      name,
      format: normalizeFormat(input.format),
      strategy: (input.strategy || "").slice(0, 800),
      poolMode: normalizePoolMode(input.poolMode),
      cards: JSON.stringify(input.cards ?? { main: [], extra: [], side: [] }),
    },
  });
  revalidatePath("/decks");
  return { id: deck.id };
}

export async function deleteDeck(id: string): Promise<void> {
  const userId = await requireUser();
  await prisma.deck.deleteMany({ where: { id, userId } });
  revalidatePath("/decks");
}
