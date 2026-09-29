// Server-only read models for Play (not server actions). Builds what the client may see:
// the opponent's deck is stripped while a Sealed duel is still being built.

import type { Duel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getFriendIds } from "@/lib/social";
import { legalPoolSize, normalizeFormat, type DeckFormat } from "@/lib/deck-engine";
import {
  FORMATS,
  deckVisible,
  otherSide,
  parseJSON,
  startingBudget,
  type Budget,
  type DuelDeck,
  type DuelMode,
  type DuelStatus,
  type MutatorKey,
  type Side,
} from "@/lib/duel-rules";

export type SideView = {
  userId: string;
  name: string;
  initial: string;
  isMe: boolean;
  hasDeck: boolean;
  deck: DuelDeck | null; // null when hidden
  hidden: boolean;
  locked: boolean;
  budget: Budget;
  spent: Budget;
  theme: string | null;
};

export type ActionView = { id: string; actorName: string; actorIsMe: boolean; type: string; targetIsMe: boolean; cardName: string | null; detail: string | null; at: number };

export type DuelView = {
  id: string;
  format: DeckFormat;
  mode: DuelMode;
  mutators: MutatorKey[];
  options: { forceReroll?: boolean };
  status: DuelStatus;
  round: number;
  mySide: Side;
  iAmChallenger: boolean;
  isMyTurn: boolean;
  bothDecks: boolean;
  me: SideView;
  them: SideView;
  winnerId: string | null;
  recordedById: string | null;
  resultNote: string | null;
  finishedAt: number | null;
  createdAt: number;
  actions: ActionView[];
};

type U = { id: string; displayName: string | null; username: string };
const nameOf = (u: U) => u.displayName || u.username;

function sideView(d: Duel, side: Side, u: U, meId: string, visible: boolean): SideView {
  const raw = side === "challenger" ? d.challengerDeck : d.opponentDeck;
  const deck = parseJSON<DuelDeck | null>(raw, null);
  const start = startingBudget(d.mode as DuelMode, parseJSON(d.options, {}));
  const budget: Budget = { ...start, ...parseJSON<Partial<Budget>>(side === "challenger" ? d.challengerBudget : d.opponentBudget, {}) };
  const spent: Budget = {
    reroll: start.reroll - budget.reroll, kill: start.kill - budget.kill, pin: start.pin - budget.pin,
    snipe: start.snipe - budget.snipe, plant: start.plant - budget.plant, force: start.force - budget.force,
  };
  const isMe = u.id === meId;
  const show = isMe || visible;
  return {
    userId: u.id,
    name: nameOf(u),
    initial: nameOf(u)[0].toUpperCase(),
    isMe,
    hasDeck: !!deck,
    deck: show ? deck : null,
    hidden: !!deck && !show,
    locked: side === "challenger" ? d.challengerLocked : d.opponentLocked,
    budget,
    spent,
    theme: show ? (side === "challenger" ? d.challengerTheme : d.opponentTheme) : null,
  };
}

export async function loadDuelView(id: string, meId: string): Promise<DuelView | null> {
  const d = await prisma.duel.findUnique({
    where: { id },
    include: {
      challenger: { select: { id: true, displayName: true, username: true } },
      opponent: { select: { id: true, displayName: true, username: true } },
      actions: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!d || (d.challengerId !== meId && d.opponentId !== meId)) return null;
  const mySide: Side = d.challengerId === meId ? "challenger" : "opponent";
  const mode = d.mode as DuelMode;
  const status = d.status as DuelStatus;
  const visible = deckVisible(mode, status);
  const me = sideView(d, mySide, mySide === "challenger" ? d.challenger : d.opponent, meId, visible);
  const them = sideView(d, otherSide(mySide), mySide === "challenger" ? d.opponent : d.challenger, meId, visible);
  const users = new Map<string, U>([[d.challenger.id, d.challenger], [d.opponent.id, d.opponent]]);

  return {
    id: d.id,
    format: normalizeFormat(d.format),
    mode,
    mutators: parseJSON<MutatorKey[]>(d.mutators, []),
    options: parseJSON(d.options, {}),
    status,
    round: d.round,
    mySide,
    iAmChallenger: mySide === "challenger",
    isMyTurn: d.turnUserId === meId,
    bothDecks: me.hasDeck && them.hasDeck,
    me,
    them,
    winnerId: d.winnerId,
    recordedById: d.recordedById,
    resultNote: d.resultNote,
    finishedAt: d.finishedAt?.getTime() ?? null,
    createdAt: d.createdAt.getTime(),
    actions: d.actions.map((a) => {
      const actor = users.get(a.actorId);
      const targetIsMe = a.targetSide === mySide;
      // While a Sealed duel is hidden, the other side's card names stay secret.
      const secret = !visible && !targetIsMe;
      return {
        id: a.id,
        actorName: actor ? nameOf(actor) : "Someone",
        actorIsMe: a.actorId === meId,
        type: a.type,
        targetIsMe,
        cardName: secret ? null : a.cardName,
        detail: secret ? null : a.detail,
        at: a.createdAt.getTime(),
      };
    }),
  };
}

// ---- Play home ----

export type DuelRow = {
  id: string;
  otherName: string;
  initial: string;
  mode: DuelMode;
  format: DeckFormat;
  status: DuelStatus;
  hint: string;
  updatedAt: number;
};

export type FriendPool = { id: string; name: string; initial: string; pools: Record<DeckFormat, number> };

export type HeadToHead = {
  userId: string;
  name: string;
  wins: number;
  losses: number;
  streak: number; // +n = my winning streak, -n = losing streak
  recent: boolean[]; // newest first, true = I won
  byFormat: Record<DeckFormat, { w: number; l: number }>;
  byMode: Record<DuelMode, { w: number; l: number }>;
};

export type PlayHome = {
  yourMove: DuelRow[];
  waiting: DuelRow[];
  history: DuelRow[];
  friends: FriendPool[];
  myPools: Record<DeckFormat, number>;
  records: HeadToHead[];
};

async function poolsFor(userId: string): Promise<Record<DeckFormat, number>> {
  const out = {} as Record<DeckFormat, number>;
  for (const f of FORMATS) out[f] = await legalPoolSize(userId, f);
  return out;
}

export async function loadPlayHome(meId: string): Promise<PlayHome> {
  const friendIds = await getFriendIds(meId);
  const friends = friendIds.length ? await prisma.user.findMany({ where: { id: { in: friendIds } }, select: { id: true, displayName: true, username: true } }) : [];
  const friendPools: FriendPool[] = [];
  for (const f of friends) friendPools.push({ id: f.id, name: nameOf(f), initial: nameOf(f)[0].toUpperCase(), pools: await poolsFor(f.id) });
  friendPools.sort((a, b) => a.name.localeCompare(b.name));
  const myPools = await poolsFor(meId);

  const duels = await prisma.duel.findMany({
    where: { OR: [{ challengerId: meId }, { opponentId: meId }] },
    include: {
      challenger: { select: { id: true, displayName: true, username: true } },
      opponent: { select: { id: true, displayName: true, username: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const yourMove: DuelRow[] = [], waiting: DuelRow[] = [], history: DuelRow[] = [];
  const rec = new Map<string, HeadToHead>();

  for (const d of duels) {
    const mine: Side = d.challengerId === meId ? "challenger" : "opponent";
    const other = mine === "challenger" ? d.opponent : d.challenger;
    const myDeck = mine === "challenger" ? d.challengerDeck : d.opponentDeck;
    const theirDeck = mine === "challenger" ? d.opponentDeck : d.challengerDeck;
    const myLocked = mine === "challenger" ? d.challengerLocked : d.opponentLocked;
    const status = d.status as DuelStatus;
    const mode = d.mode as DuelMode;
    const row: DuelRow = { id: d.id, otherName: nameOf(other), initial: nameOf(other)[0].toUpperCase(), mode, format: normalizeFormat(d.format), status, hint: "", updatedAt: d.updatedAt.getTime() };

    if (status === "PENDING") {
      if (mine === "opponent") { row.hint = "Challenge waiting for your answer"; yourMove.push(row); }
      else { row.hint = "Waiting for them to accept"; waiting.push(row); }
    } else if (status === "BUILDING") {
      if (!myDeck) { row.hint = "Draw your deck"; yourMove.push(row); }
      else if (mode === "sabotage") {
        if (!theirDeck) { row.hint = "Waiting for them to draw"; waiting.push(row); }
        else if (d.turnUserId === meId) { row.hint = `Your move · round ${d.round}`; yourMove.push(row); }
        else { row.hint = "Their move"; waiting.push(row); }
      } else if (!myLocked) { row.hint = "Tweak and lock in"; yourMove.push(row); }
      else { row.hint = theirDeck ? "Waiting for them to lock in" : "Waiting for them to draw"; waiting.push(row); }
    } else if (status === "REVEALED") {
      row.hint = "Decks revealed — duel, then record the result"; yourMove.push(row);
    } else {
      if (status === "DONE") {
        const iWon = d.winnerId === meId;
        row.hint = iWon ? "You won" : `${nameOf(other)} won`;
        const h = rec.get(other.id) ?? {
          userId: other.id, name: nameOf(other), wins: 0, losses: 0, streak: 0, recent: [],
          byFormat: { advanced: { w: 0, l: 0 }, goat: { w: 0, l: 0 }, edison: { w: 0, l: 0 } },
          byMode: { classic: { w: 0, l: 0 }, roulette: { w: 0, l: 0 }, sabotage: { w: 0, l: 0 } },
        };
        if (iWon) h.wins++; else h.losses++;
        const f = normalizeFormat(d.format);
        if (iWon) h.byFormat[f].w++; else h.byFormat[f].l++;
        if (h.byMode[mode]) { if (iWon) h.byMode[mode].w++; else h.byMode[mode].l++; }
        h.recent.push(iWon); // newest first (duels are ordered by updatedAt desc)
        rec.set(other.id, h);
      } else {
        row.hint = status === "DECLINED" ? "Declined" : "Called off";
      }
      history.push(row);
    }
  }

  // Streak = the unbroken run at the head of `recent` (newest first).
  for (const h of rec.values()) {
    let n = 0;
    for (const w of h.recent) { if (w === h.recent[0]) n++; else break; }
    h.streak = h.recent[0] ? n : -n;
    h.recent = h.recent.slice(0, 8);
  }

  return { yourMove, waiting, history: history.slice(0, 30), friends: friendPools, myPools, records: [...rec.values()].sort((a, b) => b.wins + b.losses - (a.wins + a.losses)) };
}
