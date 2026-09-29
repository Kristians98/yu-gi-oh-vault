// Shared (client + server) rules for Play: modes, mutators, budgets, deck JSON shape.
// Pure data + tiny helpers — no Prisma, no "use server".

import type { DeckFormat, ResolvedEntry, Pillars } from "@/lib/deck-engine";

export type DuelMode = "classic" | "roulette" | "sabotage";
export type DuelStatus = "PENDING" | "BUILDING" | "REVEALED" | "DONE" | "DECLINED" | "CANCELLED";
export type Side = "challenger" | "opponent";
export type MutatorKey = "highlander" | "noHandTraps" | "lowLevel" | "noExtra";

export const FORMAT_LABEL: Record<DeckFormat, string> = { advanced: "Advanced", goat: "Goat", edison: "Edison" };
export const FORMATS: DeckFormat[] = ["advanced", "goat", "edison"];

/** Fewer legal owned cards than this and the builder can't make a 40-card deck. */
export const MIN_POOL = 20;

export const MODES: Record<DuelMode, { label: string; blurb: string; open: boolean }> = {
  classic: { label: "Classic", blurb: "The AI builds the best deck it can from your binder. Decks stay hidden until both of you lock in.", open: false },
  roulette: { label: "Roulette", blurb: "You get a random archetype from your own binder and must play it. Rerolling spins again. Hidden until lock.", open: false },
  sabotage: { label: "Sabotage", blurb: "Open decks, alternating turns. Snipe cards out of their deck, plant duds from their own binder into it.", open: true },
};

export const MUTATORS: Record<MutatorKey, { label: string; blurb: string; prompt: string }> = {
  highlander: { label: "Highlander", blurb: "One copy of each card", prompt: "HIGHLANDER: at most ONE copy of any card in the whole deck (Main, Extra and Side)." },
  noHandTraps: { label: "No hand traps", blurb: "No Ash, Maxx \"C\", Veiler…", prompt: "NO HAND TRAPS: do not include any hand-trap monsters (cards activated from the hand during the opponent's turn, e.g. Ash Blossom, Maxx \"C\", Effect Veiler, Ghost Ogre, Droll, Nibiru, D.D. Crow)." },
  lowLevel: { label: "Low Level", blurb: "Main Deck monsters Level 4 or lower", prompt: "LOW LEVEL: every Main Deck monster must be Level 4 or lower (Ritual monsters and Level 5+ are not allowed in the Main Deck)." },
  noExtra: { label: "No Extra Deck", blurb: "Main Deck only", prompt: "NO EXTRA DECK: the Extra Deck must be empty — no Fusion, Synchro, Xyz or Link monsters." },
};
export const MUTATOR_KEYS = Object.keys(MUTATORS) as MutatorKey[];

/** Action budget for one side of a duel. Own-deck actions + (sabotage only) interference. */
export type Budget = { reroll: number; kill: number; pin: number; snipe: number; plant: number; force: number };
export type BudgetKey = keyof Budget;

export const BUDGET_LABEL: Record<BudgetKey, { label: string; own: boolean; blurb: string }> = {
  reroll: { label: "Reroll", own: true, blurb: "Rebuild your whole deck" },
  kill: { label: "Kill", own: true, blurb: "Ban a card from your deck; the AI refills the gap" },
  pin: { label: "Pin", own: true, blurb: "Force a card from your binder into your deck" },
  snipe: { label: "Snipe", own: false, blurb: "Ban a card from their deck" },
  plant: { label: "Plant", own: false, blurb: "Force a card from their binder into their deck" },
  force: { label: "Force reroll", own: false, blurb: "Rebuild their whole deck" },
};

export function startingBudget(mode: DuelMode, options: { forceReroll?: boolean }): Budget {
  if (mode === "sabotage") return { reroll: 1, kill: 2, pin: 1, snipe: 2, plant: 1, force: options.forceReroll ? 1 : 0 };
  return { reroll: 2, kill: 3, pin: 2, snipe: 0, plant: 0, force: 0 };
}

export function budgetTotal(b: Budget): number {
  return b.reroll + b.kill + b.pin + b.snipe + b.plant + b.force;
}

/** What each side stores once a deck exists. Mirrors DeckResult plus the duel's constraints. */
export type DuelDeck = {
  deckName: string;
  strategy: string;
  main: ResolvedEntry[];
  extra: ResolvedEntry[];
  side: ResolvedEntry[];
  counts: { main: number; extra: number; side: number };
  warnings: string[];
  pillars: Pillars;
  banned: string[]; // card names removed by kill/snipe
  pinned: string[]; // card names forced in by pin/plant
  version: number; // bumps on every rebuild
};

export function parseJSON<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function otherSide(s: Side): Side {
  return s === "challenger" ? "opponent" : "challenger";
}

/** Is the opponent's deck visible to this player right now? */
export function deckVisible(mode: DuelMode, status: DuelStatus): boolean {
  return MODES[mode].open || status === "REVEALED" || status === "DONE";
}
