"use server";

import { revalidatePath } from "next/cache";
import type { Duel, Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { areFriends } from "@/lib/social";
import { displayNameOf, logActivity, notify } from "@/lib/notify";
import {
  buildDeckForUser,
  legalPool,
  legalPoolSize,
  normalizeFormat,
  pickRouletteTheme,
  searchOwnedLegal,
  type DeckResult,
} from "@/lib/deck-engine";
import {
  FORMAT_LABEL,
  MIN_POOL,
  MODES,
  MUTATOR_KEYS,
  otherSide,
  parseJSON,
  startingBudget,
  type Budget,
  type BudgetKey,
  type DuelDeck,
  type DuelMode,
  type MutatorKey,
  type Side,
} from "@/lib/duel-rules";

// Server actions for Play. Every mutation re-reads the duel and checks the caller is a
// participant, the status allows the move, and (sabotage) it is their turn.

type Res = { ok: true } | { ok: false; error: string };
const fail = (error: string): Res => ({ ok: false, error });
const OK: Res = { ok: true };

async function me(): Promise<string> {
  const s = await auth();
  if (!s?.user?.id) throw new Error("Not signed in");
  return s.user.id;
}

async function load(id: string, userId: string): Promise<Duel | null> {
  const d = await prisma.duel.findUnique({ where: { id } });
  if (!d || (d.challengerId !== userId && d.opponentId !== userId)) return null;
  return d;
}

const sideOf = (d: Duel, userId: string): Side => (d.challengerId === userId ? "challenger" : "opponent");
const userOf = (d: Duel, side: Side) => (side === "challenger" ? d.challengerId : d.opponentId);
const deckOf = (d: Duel, side: Side) => parseJSON<DuelDeck | null>(side === "challenger" ? d.challengerDeck : d.opponentDeck, null);
const lockedOf = (d: Duel, side: Side) => (side === "challenger" ? d.challengerLocked : d.opponentLocked);
const themeOf = (d: Duel, side: Side) => (side === "challenger" ? d.challengerTheme : d.opponentTheme);
function budgetOf(d: Duel, side: Side): Budget {
  const start = startingBudget(d.mode as DuelMode, parseJSON(d.options, {}));
  return { ...start, ...parseJSON<Partial<Budget>>(side === "challenger" ? d.challengerBudget : d.opponentBudget, {}) };
}
const mutatorsOf = (d: Duel) => parseJSON<string[]>(d.mutators, []).filter((m): m is MutatorKey => (MUTATOR_KEYS as string[]).includes(m));
const isSabotage = (d: Duel) => d.mode === "sabotage";

/** Column-safe partial update for one side. */
function sideData(side: Side, patch: { deck?: DuelDeck; budget?: Budget; locked?: boolean; theme?: string | null }): Prisma.DuelUpdateInput {
  const out: Prisma.DuelUpdateInput = {};
  const set = (k: string, v: unknown) => ((out as Record<string, unknown>)[k] = v);
  if (patch.deck !== undefined) set(`${side}Deck`, JSON.stringify(patch.deck));
  if (patch.budget !== undefined) set(`${side}Budget`, JSON.stringify(patch.budget));
  if (patch.locked !== undefined) set(`${side}Locked`, patch.locked);
  if (patch.theme !== undefined) set(`${side}Theme`, patch.theme);
  return out;
}

async function logAction(duelId: string, actorId: string, type: string, targetSide: Side, cardName?: string | null, detail?: string | null) {
  try {
    await prisma.duelAction.create({ data: { duelId, actorId, type, targetSide, cardName: cardName ?? null, detail: detail ?? null } });
  } catch {
    /* ignore */
  }
}

function label(d: Duel): string {
  return `${MODES[d.mode as DuelMode]?.label ?? d.mode} · ${FORMAT_LABEL[normalizeFormat(d.format)]}`;
}

function toDuelDeck(r: DeckResult, banned: string[], pinned: string[], version: number): DuelDeck {
  return {
    deckName: r.deckName, strategy: r.strategy, main: r.main, extra: r.extra, side: r.side,
    counts: r.counts, warnings: r.warnings, pillars: r.pillars, banned, pinned, version,
  };
}

/** Build or rebuild one side's deck from that player's own binder, honouring the duel's constraints. */
async function rebuildSide(
  d: Duel,
  side: Side,
  opts: { patch: boolean; banned?: string[]; pinned?: string[]; respin?: boolean },
): Promise<{ ok: true; deck: DuelDeck; theme: string | null } | { ok: false; error: string }> {
  const userId = userOf(d, side);
  const format = normalizeFormat(d.format);
  const existing = deckOf(d, side);
  const banned = opts.banned ?? existing?.banned ?? [];
  const pinned = opts.pinned ?? existing?.pinned ?? [];

  let theme = themeOf(d, side);
  let strategy = "";
  if (d.mode === "roulette") {
    if (!theme || opts.respin) theme = await pickRouletteTheme(userId, format, opts.respin ? theme : null);
    strategy = theme
      ? `ROULETTE: the deck MUST be built around the "${theme}" archetype — it is the mandatory core of the deck. Support it with the best generic cards available.`
      : "Choose a strong, coherent strategy.";
  }

  const r = await buildDeckForUser(userId, {
    format,
    strategy,
    poolMode: "collection",
    constraints: {
      banned,
      pinned,
      mutators: mutatorsOf(d),
      current: opts.patch && existing ? { name: existing.deckName, strategy: existing.strategy, cards: { main: existing.main, extra: existing.extra, side: existing.side } } : null,
    },
  });
  if (!r.ok) return { ok: false, error: r.error ?? "The deck builder failed." };
  return { ok: true, deck: toDuelDeck(r, banned, pinned, (existing?.version ?? 0) + 1), theme: theme ?? null };
}

/** Sabotage: after a move, hand the turn to the other player unless they've locked. */
function nextTurn(d: Duel, actorSide: Side): Prisma.DuelUpdateInput {
  if (!isSabotage(d)) return {};
  const other = otherSide(actorSide);
  return { turnUserId: lockedOf(d, other) ? userOf(d, actorSide) : userOf(d, other), round: { increment: 1 } };
}

/** Common gate for moves during building. */
function gateMove(d: Duel, userId: string, side: Side, needTurn: boolean): string | null {
  if (d.status !== "BUILDING") return "This duel isn't in the building phase.";
  if (lockedOf(d, side) && needTurn) return "You've locked in.";
  if (isSabotage(d) && needTurn) {
    if (!deckOf(d, "challenger") || !deckOf(d, "opponent")) return "Both decks must be drawn first.";
    if (d.turnUserId !== userId) return "It's not your turn.";
  }
  return null;
}

function spend(b: Budget, k: BudgetKey): Budget | null {
  if ((b[k] ?? 0) <= 0) return null;
  return { ...b, [k]: b[k] - 1 };
}

const touch = (id: string) => {
  revalidatePath("/play");
  revalidatePath(`/play/${id}`);
};

// ---------------------------------------------------------------------------------------
// Challenge lifecycle
// ---------------------------------------------------------------------------------------

export async function challengeDuel(input: {
  opponentId: string;
  format: string;
  mode: string;
  mutators: string[];
  forceReroll?: boolean;
}): Promise<{ id?: string; error?: string }> {
  const userId = await me();
  if (input.opponentId === userId) return { error: "Pick a friend to duel." };
  if (!(await areFriends(userId, input.opponentId))) return { error: "You can only duel friends." };
  const mode = (Object.keys(MODES) as DuelMode[]).includes(input.mode as DuelMode) ? (input.mode as DuelMode) : "classic";
  const format = normalizeFormat(input.format);
  const mutators = (input.mutators ?? []).filter((m): m is MutatorKey => (MUTATOR_KEYS as string[]).includes(m));
  const [mine, theirs] = await Promise.all([legalPoolSize(userId, format), legalPoolSize(input.opponentId, format)]);
  if (mine < MIN_POOL) return { error: `You only have ${mine} cards legal in ${FORMAT_LABEL[format]} — not enough to build from.` };
  if (theirs < MIN_POOL) return { error: `They only have ${theirs} cards legal in ${FORMAT_LABEL[format]} — pick another format.` };

  const options = { forceReroll: mode === "sabotage" && !!input.forceReroll };
  const budget = JSON.stringify(startingBudget(mode, options));
  const d = await prisma.duel.create({
    data: {
      challengerId: userId, opponentId: input.opponentId, format, mode,
      mutators: JSON.stringify(mutators), options: JSON.stringify(options),
      status: "PENDING", challengerBudget: budget, opponentBudget: budget,
    },
  });
  const meName = await displayNameOf(userId);
  await notify(input.opponentId, "DUEL_CHALLENGE", `${meName} challenged you to a duel — ${label(d)}`, `/play/${d.id}`);
  await logActivity(userId, "DUEL_CHALLENGE", `${meName} threw down a ${label(d)} challenge`, `/play/${d.id}`);
  touch(d.id);
  return { id: d.id };
}

export async function acceptDuel(id: string): Promise<Res> {
  const userId = await me();
  const d = await load(id, userId);
  if (!d || d.opponentId !== userId || d.status !== "PENDING") return fail("Nothing to accept.");
  const n = await prisma.duel.updateMany({ where: { id, status: "PENDING" }, data: { status: "BUILDING" } });
  if (n.count === 0) return fail("Already handled.");
  await notify(d.challengerId, "DUEL_ACCEPTED", `${await displayNameOf(userId)} accepted your duel — go draw your deck`, `/play/${id}`);
  touch(id);
  return OK;
}

export async function declineDuel(id: string): Promise<Res> {
  const userId = await me();
  const d = await load(id, userId);
  if (!d || d.opponentId !== userId || d.status !== "PENDING") return fail("Nothing to decline.");
  await prisma.duel.updateMany({ where: { id, status: "PENDING" }, data: { status: "DECLINED" } });
  await notify(d.challengerId, "DUEL_DECLINED", `${await displayNameOf(userId)} declined your duel`, `/play/${id}`);
  touch(id);
  return OK;
}

export async function cancelDuel(id: string): Promise<Res> {
  const userId = await me();
  const d = await load(id, userId);
  if (!d || !["PENDING", "BUILDING"].includes(d.status)) return fail("Can't cancel now.");
  await prisma.duel.updateMany({ where: { id, status: { in: ["PENDING", "BUILDING"] } }, data: { status: "CANCELLED" } });
  const other = userOf(d, otherSide(sideOf(d, userId)));
  await notify(other, "DUEL_CANCELLED", `${await displayNameOf(userId)} called off the duel`, `/play/${id}`);
  touch(id);
  return OK;
}

// ---------------------------------------------------------------------------------------
// Own deck: generate / reroll / kill / pin / lock
// ---------------------------------------------------------------------------------------

export async function generateMyDeck(id: string): Promise<Res> {
  const userId = await me();
  const d = await load(id, userId);
  if (!d) return fail("Duel not found.");
  const side = sideOf(d, userId);
  if (d.status !== "BUILDING") return fail("This duel isn't in the building phase.");
  if (deckOf(d, side)) return fail("You already drew a deck.");

  const r = await rebuildSide(d, side, { patch: false });
  if (!r.ok) return fail(r.error);

  // Sabotage: once both decks exist the opponent (who didn't pick the format) moves first.
  const otherHas = !!deckOf(d, otherSide(side));
  const turn: Prisma.DuelUpdateInput = isSabotage(d) && otherHas ? { turnUserId: d.opponentId, round: 1 } : {};
  const n = await prisma.duel.updateMany({
    where: { id, status: "BUILDING", ...(side === "challenger" ? { challengerDeck: null } : { opponentDeck: null }) },
    data: { ...sideData(side, { deck: r.deck, theme: r.theme }), ...turn },
  });
  if (n.count === 0) return fail("A deck was already drawn.");
  await logAction(id, userId, "GENERATE", side, null, r.theme ? `Rolled ${r.theme}` : null);
  const meName = await displayNameOf(userId);
  const other = userOf(d, otherSide(side));
  if (isSabotage(d) && otherHas) await notify(other, "DUEL_TURN", `${meName} drew a deck — your move`, `/play/${id}`);
  else await notify(other, "DUEL_DRAWN", `${meName} drew a deck`, `/play/${id}`);
  touch(id);
  return OK;
}

async function ownMove(
  id: string,
  key: BudgetKey,
  type: string,
  build: (d: Duel, side: Side) => Promise<{ ok: true; deck: DuelDeck; theme: string | null } | { ok: false; error: string }>,
  cardName?: string | null,
): Promise<Res> {
  const userId = await me();
  const d = await load(id, userId);
  if (!d) return fail("Duel not found.");
  const side = sideOf(d, userId);
  const gate = gateMove(d, userId, side, true);
  if (gate) return fail(gate);
  if (!deckOf(d, side)) return fail("Draw a deck first.");
  const budget = spend(budgetOf(d, side), key);
  if (!budget) return fail(`No ${key}s left.`);

  const r = await build(d, side);
  if (!r.ok) return fail(r.error);

  const n = await prisma.duel.updateMany({
    where: { id, status: "BUILDING", ...(side === "challenger" ? { challengerLocked: false } : { opponentLocked: false }) },
    data: { ...sideData(side, { deck: r.deck, budget, theme: r.theme }), ...nextTurn(d, side) },
  });
  if (n.count === 0) return fail("The duel moved on — refresh.");
  await logAction(id, userId, type, side, cardName ?? null, r.theme && type === "REROLL" ? `Rolled ${r.theme}` : null);
  if (isSabotage(d) && !lockedOf(d, otherSide(side))) {
    await notify(userOf(d, otherSide(side)), "DUEL_TURN", `${await displayNameOf(userId)} made a move — your turn`, `/play/${id}`);
  }
  touch(id);
  return OK;
}

export async function rerollMyDeck(id: string): Promise<Res> {
  return ownMove(id, "reroll", "REROLL", (d, side) => rebuildSide(d, side, { patch: false, respin: true }));
}

export async function killMyCard(id: string, cardName: string): Promise<Res> {
  const name = (cardName ?? "").trim();
  if (!name) return fail("Pick a card.");
  return ownMove(
    id, "kill", "KILL",
    (d, side) => {
      const deck = deckOf(d, side)!;
      const inDeck = [...deck.main, ...deck.extra, ...deck.side].some((e) => e.name.toLowerCase() === name.toLowerCase());
      if (!inDeck) return Promise.resolve({ ok: false as const, error: "That card isn't in your deck." });
      const banned = [...deck.banned, name];
      const pinned = deck.pinned.filter((p) => p.toLowerCase() !== name.toLowerCase());
      return rebuildSide(d, side, { patch: true, banned, pinned });
    },
    name,
  );
}

export async function pinMyCard(id: string, cardId: number): Promise<Res> {
  const userId = await me();
  const d0 = await load(id, userId);
  if (!d0) return fail("Duel not found.");
  const card = (await legalPool(userId, normalizeFormat(d0.format))).find((p) => p.c.id === cardId)?.c;
  if (!card) return fail("That card isn't in your legal pool.");
  return ownMove(
    id, "pin", "PIN",
    (d, side) => {
      const deck = deckOf(d, side)!;
      if (deck.banned.some((b) => b.toLowerCase() === card.name.toLowerCase())) return Promise.resolve({ ok: false as const, error: "That card is banned in this duel." });
      const pinned = deck.pinned.some((p) => p.toLowerCase() === card.name.toLowerCase()) ? deck.pinned : [...deck.pinned, card.name];
      return rebuildSide(d, side, { patch: true, pinned });
    },
    card.name,
  );
}

export async function lockMyDeck(id: string): Promise<Res> {
  const userId = await me();
  const d = await load(id, userId);
  if (!d) return fail("Duel not found.");
  const side = sideOf(d, userId);
  if (d.status !== "BUILDING") return fail("This duel isn't in the building phase.");
  if (!deckOf(d, side)) return fail("Draw a deck first.");
  if (lockedOf(d, side)) return OK;
  if (isSabotage(d) && deckOf(d, otherSide(side)) && d.turnUserId !== userId) return fail("It's not your turn.");

  const otherLocked = lockedOf(d, otherSide(side));
  const bothDecks = !!deckOf(d, otherSide(side));
  const reveal = otherLocked && bothDecks;
  const n = await prisma.duel.updateMany({
    where: { id, status: "BUILDING" },
    data: {
      ...sideData(side, { locked: true }),
      ...(reveal ? { status: "REVEALED" } : {}),
      ...(isSabotage(d) && !otherLocked ? { turnUserId: userOf(d, otherSide(side)), round: { increment: 1 } } : {}),
    },
  });
  if (n.count === 0) return fail("The duel moved on — refresh.");
  await logAction(id, userId, "LOCK", side);
  const meName = await displayNameOf(userId);
  const other = userOf(d, otherSide(side));
  if (reveal) {
    await notify(other, "DUEL_REVEALED", `${meName} locked in — decks are revealed. Go duel!`, `/play/${id}`);
    await logActivity(userId, "DUEL_REVEALED", `${meName} and ${await displayNameOf(other)} revealed their ${label(d)} decks`, `/play/${id}`);
  } else {
    await notify(other, "DUEL_LOCKED", `${meName} locked in their deck`, `/play/${id}`);
  }
  touch(id);
  return OK;
}

// ---------------------------------------------------------------------------------------
// Sabotage: interference with the opponent's deck
// ---------------------------------------------------------------------------------------

async function interfere(
  id: string,
  key: BudgetKey,
  type: string,
  build: (d: Duel, target: Side) => Promise<{ ok: true; deck: DuelDeck; theme: string | null } | { ok: false; error: string }>,
  cardName?: string | null,
): Promise<Res> {
  const userId = await me();
  const d = await load(id, userId);
  if (!d) return fail("Duel not found.");
  if (!isSabotage(d)) return fail("Only in Sabotage mode.");
  const side = sideOf(d, userId);
  const target = otherSide(side);
  const gate = gateMove(d, userId, side, true);
  if (gate) return fail(gate);
  if (lockedOf(d, target)) return fail("They've locked in — their deck is safe now.");
  const budget = spend(budgetOf(d, side), key);
  if (!budget) return fail(`No ${key}s left.`);

  const r = await build(d, target);
  if (!r.ok) return fail(r.error);

  const n = await prisma.duel.updateMany({
    where: { id, status: "BUILDING", turnUserId: userId, ...(target === "challenger" ? { challengerLocked: false } : { opponentLocked: false }) },
    data: { ...sideData(target, { deck: r.deck, theme: r.theme }), ...sideData(side, { budget }), ...nextTurn(d, side) },
  });
  if (n.count === 0) return fail("The duel moved on — refresh.");
  await logAction(id, userId, type, target, cardName ?? null);
  const meName = await displayNameOf(userId);
  const verb = type === "SNIPE" ? `sniped ${cardName} out of your deck` : type === "PLANT" ? `planted ${cardName} in your deck` : "force-rerolled your deck";
  await notify(userOf(d, target), "DUEL_TURN", `${meName} ${verb} — your turn`, `/play/${id}`);
  touch(id);
  return OK;
}

export async function snipeCard(id: string, cardName: string): Promise<Res> {
  const name = (cardName ?? "").trim();
  if (!name) return fail("Pick a card.");
  return interfere(
    id, "snipe", "SNIPE",
    (d, target) => {
      const deck = deckOf(d, target)!;
      const inDeck = [...deck.main, ...deck.extra, ...deck.side].some((e) => e.name.toLowerCase() === name.toLowerCase());
      if (!inDeck) return Promise.resolve({ ok: false as const, error: "That card isn't in their deck." });
      return rebuildSide(d, target, { patch: true, banned: [...deck.banned, name], pinned: deck.pinned.filter((p) => p.toLowerCase() !== name.toLowerCase()) });
    },
    name,
  );
}

export async function plantCard(id: string, cardId: number): Promise<Res> {
  const userId = await me();
  const d0 = await load(id, userId);
  if (!d0) return fail("Duel not found.");
  const targetUser = userOf(d0, otherSide(sideOf(d0, userId)));
  const card = (await legalPool(targetUser, normalizeFormat(d0.format))).find((p) => p.c.id === cardId)?.c;
  if (!card) return fail("That card isn't in their legal pool.");
  return interfere(
    id, "plant", "PLANT",
    (d, target) => {
      const deck = deckOf(d, target)!;
      if (deck.banned.some((b) => b.toLowerCase() === card.name.toLowerCase())) return Promise.resolve({ ok: false as const, error: "That card is banned in this duel." });
      const pinned = deck.pinned.some((p) => p.toLowerCase() === card.name.toLowerCase()) ? deck.pinned : [...deck.pinned, card.name];
      return rebuildSide(d, target, { patch: true, pinned });
    },
    card.name,
  );
}

export async function forceRerollTheirs(id: string): Promise<Res> {
  return interfere(id, "force", "FORCE", (d, target) => rebuildSide(d, target, { patch: false, respin: true }));
}

/** Card picker for Pin (mine) and Plant (theirs — sabotage only). */
export async function searchDuelPool(id: string, whose: "mine" | "theirs", q: string) {
  const userId = await me();
  const d = await load(id, userId);
  if (!d) return [];
  if (whose === "theirs" && !isSabotage(d)) return [];
  const target = whose === "mine" ? userId : userOf(d, otherSide(sideOf(d, userId)));
  return searchOwnedLegal(target, normalizeFormat(d.format), q ?? "");
}

// ---------------------------------------------------------------------------------------
// After the real-life game
// ---------------------------------------------------------------------------------------

export async function recordResult(id: string, winnerId: string, note?: string): Promise<Res> {
  const userId = await me();
  const d = await load(id, userId);
  if (!d) return fail("Duel not found.");
  if (!["REVEALED", "DONE"].includes(d.status)) return fail("Reveal the decks first.");
  if (winnerId !== d.challengerId && winnerId !== d.opponentId) return fail("Winner must be one of you.");
  const changed = d.status === "DONE" && d.winnerId !== winnerId;
  await prisma.duel.update({
    where: { id },
    data: { status: "DONE", winnerId, recordedById: userId, resultNote: (note ?? "").trim().slice(0, 200) || null, finishedAt: d.finishedAt ?? new Date() },
  });
  const loserId = winnerId === d.challengerId ? d.opponentId : d.challengerId;
  const [w, l, meName] = await Promise.all([displayNameOf(winnerId), displayNameOf(loserId), displayNameOf(userId)]);
  const other = userOf(d, otherSide(sideOf(d, userId)));
  await notify(other, "DUEL_RESULT", changed ? `${meName} changed the result: ${w} won` : `${meName} recorded the result: ${w} beat ${l}`, `/play/${id}`);
  if (d.status !== "DONE") await logActivity(winnerId, "DUEL_WON", `${w} beat ${l} — ${label(d)}`, `/play/${id}`);
  touch(id);
  return OK;
}

export async function rematchDuel(id: string): Promise<{ id?: string; error?: string }> {
  const userId = await me();
  const d = await load(id, userId);
  if (!d || !["REVEALED", "DONE"].includes(d.status)) return { error: "Finish this duel first." };
  const other = userOf(d, otherSide(sideOf(d, userId)));
  const options = parseJSON<{ forceReroll?: boolean }>(d.options, {});
  const budget = JSON.stringify(startingBudget(d.mode as DuelMode, options));
  const n = await prisma.duel.create({
    data: {
      challengerId: userId, opponentId: other, format: d.format, mode: d.mode, mutators: d.mutators, options: d.options,
      status: "PENDING", challengerBudget: budget, opponentBudget: budget,
    },
  });
  await notify(other, "DUEL_CHALLENGE", `${await displayNameOf(userId)} wants a rematch — ${label(d)}`, `/play/${n.id}`);
  touch(id);
  return { id: n.id };
}

/** Copy my duel deck into the Decks page. */
export async function saveDuelDeck(id: string): Promise<Res> {
  const userId = await me();
  const d = await load(id, userId);
  if (!d) return fail("Duel not found.");
  const deck = deckOf(d, sideOf(d, userId));
  if (!deck) return fail("No deck to save.");
  const strip = (a: DuelDeck["main"]) => a.map((e) => ({ id: e.id, name: e.name, copies: e.copies, frame: e.frame }));
  await prisma.deck.create({
    data: {
      userId,
      name: `${deck.deckName} (duel)`.slice(0, 80),
      format: normalizeFormat(d.format),
      strategy: deck.strategy.slice(0, 800),
      poolMode: "collection",
      cards: JSON.stringify({ main: strip(deck.main), extra: strip(deck.extra), side: strip(deck.side) }),
    },
  });
  revalidatePath("/decks");
  return OK;
}
