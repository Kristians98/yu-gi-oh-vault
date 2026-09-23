"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { aiConfigured, identifyCardFromImage, readCodesFromImage } from "@/lib/azure-vision";
import { rateLimit } from "@/lib/rate-limit";
import { containsCI } from "@/lib/db-text";
import { rankCandidates, searchTokens, type ScanGuess } from "@/lib/fuzzy";
import { importCardsByName } from "@/lib/card-import";

type DbCard = {
  id: number;
  name: string;
  frame: string;
  attribute: string | null;
  race: string | null;
  level: number | null;
  atk: number | null;
  def: number | null;
  printings: { id: string; setName: string; setCode: string; rarity: string }[];
};

const withPrintings = { printings: { orderBy: [{ setCode: "asc" as const }] } };

function shape(c: DbCard) {
  return {
    id: c.id,
    name: c.name,
    frame: c.frame,
    printings: c.printings.map((p) => ({ id: p.id, setName: p.setName, setCode: p.setCode, rarity: p.rarity })),
  };
}
export type ScanCard = ReturnType<typeof shape>;

/** The 8-digit passcode IS the YGOPRODeck id — an exact match. */
export async function identifyByPasscode(passcode: number) {
  if (!Number.isFinite(passcode)) return null;
  const c = await prisma.card.findUnique({ where: { id: passcode }, include: withPrintings });
  return c ? shape(c) : null;
}

/** The set code (e.g. LOB-EN001) pins the exact printing → resolves set + rarity. */
export async function findPrintingBySetCode(setCode: string) {
  const p = await prisma.cardPrinting.findFirst({ where: { setCode: setCode.toUpperCase() } });
  return p ? p.id : null;
}

/** Ask Azure gpt-4o-mini to read a card photo. Rate-limited per user (paid API). */
export async function aiIdentify(dataUrl: string): Promise<ScanGuess | null> {
  const s = await auth();
  if (!s?.user?.id) return null;
  if (!rateLimit(`scan:min:${s.user.id}`, 20, 60_000)) return null;
  if (!rateLimit(`scan:day:${s.user.id}`, 300, 86_400_000)) return null;
  return identifyCardFromImage(dataUrl);
}

export type ScanResolution = {
  /** Auto-picked card when the match is unambiguous. */
  best: ScanCard | null;
  /** Printing pinned by the set code, if it belongs to `best`. */
  printingId: string | null;
  /** Top alternatives (incl. best) for the user to choose from when not confident. */
  choices: (ScanCard & { score: number; reasons: string[] })[];
  confident: boolean;
};

/**
 * Turn what the AI read into a card from OUR database. Candidates come from a name
 * search (full name, then individual words), the passcode and the set code; they are
 * scored on name → frame → attribute/type/stats → passcode (see lib/fuzzy.ts).
 */
export async function resolveScan(guess: ScanGuess): Promise<ScanResolution> {
  const s = await auth();
  if (!s?.user?.id) return { best: null, printingId: null, choices: [], confident: false };

  const pool = new Map<number, DbCard>();
  const add = (cards: DbCard[]) => cards.forEach((c) => pool.set(c.id, c));

  if (guess.name) {
    // Retrieval casts a wide net; scoring (lib/fuzzy.ts) does the choosing. Queries:
    // the name as read; cards with EVERY significant word; each PAIR of words (survives
    // one misspelt word); names starting with the first word; and, if all that found
    // little, cards with ANY of the words.
    const tokens = searchTokens(guess.name);
    const q = (where: object, take: number) => prisma.card.findMany({ where, include: withPrintings, take });
    const queries: Promise<DbCard[]>[] = [q({ name: containsCI(guess.name) }, 20)];
    if (tokens.length > 1) queries.push(q({ AND: tokens.map((t) => ({ name: containsCI(t) })) }, 40));
    if (tokens.length >= 3) {
      for (let i = 0; i < tokens.length; i++) for (let j = i + 1; j < tokens.length; j++) queries.push(q({ AND: [{ name: containsCI(tokens[i]) }, { name: containsCI(tokens[j]) }] }, 30));
    }
    if (tokens[0]?.length >= 4) queries.push(q({ name: { startsWith: tokens[0] } }, 40));
    (await Promise.all(queries)).forEach(add);
    if (pool.size < 5 && tokens.length) add(await q({ OR: tokens.map((t) => ({ name: containsCI(t) })) }, 150));
    // Nothing plausible locally → the card may be newer than the last sync. Ask YGOPRODeck
    // by name, import what is missing, and re-query.
    const plausible = [...pool.values()].some((c) => rankCandidates(guess, [c]).best!.nameSim >= 0.6);
    if (!plausible) {
      const imported = await importCardsByName(guess.name);
      if (imported.length) add(await q({ id: { in: imported } }, 40));
    }
  }
  if (guess.passcode) {
    const c = await prisma.card.findUnique({ where: { id: guess.passcode }, include: withPrintings });
    if (c) add([c]);
  }
  let setPrinting: { id: string; cardId: number } | null = null;
  if (guess.setCode) {
    setPrinting = await prisma.cardPrinting.findFirst({ where: { setCode: guess.setCode.toUpperCase() }, select: { id: true, cardId: true } });
    if (setPrinting && !pool.has(setPrinting.cardId)) {
      const c = await prisma.card.findUnique({ where: { id: setPrinting.cardId }, include: withPrintings });
      if (c) add([c]);
    }
  }

  const candidates = [...pool.values()].map((c) => ({ ...c, setCodes: c.printings.map((p) => p.setCode) }));
  const { best, confident, ranked } = rankCandidates(guess, candidates);
  const choices = ranked
    .filter((r) => r.score > 15)
    .slice(0, 5)
    .map((r) => ({ ...shape(r.card), score: Math.round(r.score), reasons: r.reasons }));
  const bestCard = best && confident ? shape(best.card) : null;
  const printingId = bestCard && setPrinting && setPrinting.cardId === bestCard.id ? setPrinting.id : null;
  return { best: bestCard, printingId, choices, confident };
}

/** Second pass: read ONLY the passcode + set code from a close crop of the card's bottom
 *  strip. Used when the first read had no usable code and the name matched nothing. */
export async function aiReadCodes(dataUrl: string): Promise<{ passcode?: number; setCode?: string } | null> {
  const s = await auth();
  if (!s?.user?.id) return null;
  if (!rateLimit(`scan:min:${s.user.id}`, 20, 60_000)) return null;
  if (!rateLimit(`scan:day:${s.user.id}`, 300, 86_400_000)) return null;
  return readCodesFromImage(dataUrl);
}

export async function aiScanEnabled() {
  return aiConfigured();
}
