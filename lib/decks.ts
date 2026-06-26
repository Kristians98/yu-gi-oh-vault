"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { buildDeckJSON, refineDeckJSON, type RawDeck } from "@/lib/deck-ai";

async function requireUser(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  return session.user.id;
}

export type DeckFormat = "advanced" | "goat" | "edison";
export type PoolMode = "collection" | "any";

// What gets stored / rendered for a card in a deck.
export type DeckCardEntry = { id: number | null; name: string; copies: number; frame: string | null };
// Render-time entry (adds ownership + legality info).
export type ResolvedEntry = DeckCardEntry & { owned: number; legal: boolean; typeLine: string | null };
export type DeckCards = { main: DeckCardEntry[]; extra: DeckCardEntry[]; side: DeckCardEntry[] };
export type PillarScore = { score: number; label: string; detail: string };
export type Pillars = {
  overall: number;
  grade: string;
  consistency: PillarScore;
  resilience: PillarScore;
  disruption: PillarScore;
  resources: PillarScore;
  fitness: PillarScore;
  counts: { monsters: number; spells: number; traps: number; starters: number; extenders: number; interruptions: number; handTraps: number; recursion: number; bricks: number };
};

export type DeckResult = {
  ok: boolean;
  error?: string;
  deckName: string;
  strategy: string;
  format: DeckFormat;
  poolMode: PoolMode;
  main: ResolvedEntry[];
  extra: ResolvedEntry[];
  side: ResolvedEntry[];
  counts: { main: number; extra: number; side: number };
  warnings: string[];
  pillars: Pillars;
};

const EXTRA_FRAMES = new Set(["fusion", "synchro", "xyz", "link"]);

type CardRow = {
  id: number; name: string; frame: string; typeLine: string; level: number | null; atk: number | null; def: number | null;
  banTcg: string | null; banGoat: string | null; banEdison: string | null; tcgDate: string | null; desc: string; linkval: number | null; isTuner: boolean; handTrap: boolean;
};

function banFieldFor(c: CardRow, format: DeckFormat): string | null {
  return format === "goat" ? c.banGoat : format === "edison" ? c.banEdison : c.banTcg;
}

function isLegal(c: CardRow, format: DeckFormat): boolean {
  if (banFieldFor(c, format) === "Forbidden") return false;
  if (format === "goat") return !!c.tcgDate && c.tcgDate <= "2005-09-01";
  if (format === "edison") return !!c.tcgDate && c.tcgDate <= "2010-04-01";
  return true; // advanced = current pool
}

function copyLimit(c: CardRow, format: DeckFormat): number {
  const b = banFieldFor(c, format);
  if (b === "Limited") return 1;
  if (b === "Semi-Limited") return 2;
  return 3;
}

/** Sum a user's owned quantity per cardId (across printings/conditions). */
async function ownedByCard(userId: string): Promise<Map<number, number>> {
  const owned = await prisma.ownedCard.findMany({
    where: { userId },
    select: { quantity: true, printing: { select: { card: { select: { id: true } } } } },
  });
  const m = new Map<number, number>();
  for (const o of owned) {
    const id = o.printing.card.id;
    m.set(id, (m.get(id) ?? 0) + o.quantity);
  }
  return m;
}

/** Resolve AI card names → DB cards (exact first, then a case-insensitive fallback). */
async function resolveByName(names: string[]): Promise<Map<string, CardRow>> {
  const select = { id: true, name: true, frame: true, typeLine: true, level: true, atk: true, def: true, banTcg: true, banGoat: true, banEdison: true, tcgDate: true, desc: true, linkval: true, isTuner: true, handTrap: true } as const;
  const uniq = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const byLower = new Map<string, CardRow>();
  const exact = await prisma.card.findMany({ where: { name: { in: uniq } }, select });
  for (const c of exact) byLower.set(c.name.toLowerCase(), c);
  for (const n of uniq) {
    if (byLower.has(n.toLowerCase())) continue;
    const f = await prisma.card.findFirst({ where: { name: { contains: n } }, select, orderBy: { name: "asc" } });
    if (f) byLower.set(n.toLowerCase(), f);
  }
  return byLower;
}

function resolveSection(
  entries: { name: string; copies: number }[],
  byLower: Map<string, CardRow>,
  owned: Map<number, number>,
  format: DeckFormat,
  poolMode: PoolMode,
  warnings: string[],
): ResolvedEntry[] {
  const out: ResolvedEntry[] = [];
  for (const e of entries) {
    const card = byLower.get(e.name.toLowerCase());
    if (!card) {
      warnings.push(`Skipped unknown card "${e.name}".`);
      continue;
    }
    const ownedN = owned.get(card.id) ?? 0;
    const legal = isLegal(card, format);
    if (!legal) warnings.push(`"${card.name}" isn't legal in this format — left out.`);
    const limit = copyLimit(card, format);
    const cap = poolMode === "collection" ? Math.min(limit, Math.max(ownedN, 0)) : limit;
    let copies = Math.min(e.copies, cap || (poolMode === "collection" ? 0 : limit));
    if (poolMode === "collection" && ownedN === 0) {
      warnings.push(`"${card.name}" isn't in your collection — left out.`);
      continue;
    }
    if (copies < e.copies) warnings.push(`Capped "${card.name}" to ${copies} cop${copies === 1 ? "y" : "ies"} (limit/owned).`);
    if (!legal || copies <= 0) continue;
    out.push({ id: card.id, name: card.name, copies, frame: card.frame, owned: ownedN, legal, typeLine: card.typeLine });
  }
  return out;
}

type MainCaps = { fusionEnabler: boolean; ritualEnabler: boolean; tuner: boolean; nonTuner: boolean; monsters: number; levelCount: Map<number, number> };

/** What can the Main Deck actually summon? (Tuners, Fusion/Ritual enablers, Levels on board.) */
function analyzeMain(main: ResolvedEntry[], byLower: Map<string, CardRow>): MainCaps {
  let fusionEnabler = false, ritualEnabler = false, tuner = false, nonTuner = false, monsters = 0;
  const levelCount = new Map<number, number>();
  for (const e of main) {
    const c = byLower.get(e.name.toLowerCase());
    if (!c) continue;
    const d = (c.desc || "").toLowerCase();
    if (d.includes("fusion summon") || d.includes("fusion monster from your extra deck")) fusionEnabler = true;
    if (d.includes("ritual summon")) ritualEnabler = true;
    if (c.frame === "spell" || c.frame === "trap") continue;
    monsters += e.copies;
    if (c.isTuner) tuner = true;
    else nonTuner = true;
    if (c.level != null) levelCount.set(c.level, (levelCount.get(c.level) ?? 0) + e.copies);
  }
  return { fusionEnabler, ritualEnabler, tuner, nonTuner, monsters, levelCount };
}

/** Drop Extra Deck cards the Main Deck plausibly cannot summon, explaining each removal. */
function pruneUnsummonable(extra: ResolvedEntry[], byLower: Map<string, CardRow>, caps: MainCaps, warnings: string[]): ResolvedEntry[] {
  return extra.filter((e) => {
    const c = byLower.get(e.name.toLowerCase());
    if (!c) return true;
    if (c.frame === "fusion" && !caps.fusionEnabler) {
      warnings.push(`Removed "${e.name}" from the Extra Deck — no Fusion Spell/effect in the deck to summon it.`);
      return false;
    }
    if (c.frame === "synchro" && !(caps.tuner && caps.nonTuner)) {
      warnings.push(`Removed "${e.name}" from the Extra Deck — no Tuner to Synchro Summon it.`);
      return false;
    }
    if (c.frame === "xyz" && c.level != null && (caps.levelCount.get(c.level) ?? 0) < 2) {
      warnings.push(`Removed "${e.name}" from the Extra Deck — need two Level ${c.level} monsters to Xyz Summon it.`);
      return false;
    }
    if (c.frame === "link" && c.linkval != null && caps.monsters < c.linkval) {
      warnings.push(`Removed "${e.name}" from the Extra Deck — need at least ${c.linkval} monsters to Link Summon it.`);
      return false;
    }
    return true;
  });
}

/** Ritual monsters sit in the Main Deck but need a Ritual Spell — drop any that lack one. */
function pruneMainRituals(main: ResolvedEntry[], byLower: Map<string, CardRow>, caps: MainCaps, warnings: string[]): ResolvedEntry[] {
  if (caps.ritualEnabler) return main;
  return main.filter((e) => {
    const c = byLower.get(e.name.toLowerCase());
    if (c && c.frame === "ritual") {
      warnings.push(`Removed "${e.name}" from the Main Deck — no Ritual Spell in the deck to summon it.`);
      return false;
    }
    return true;
  });
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const tier = (s: number, hi: string, mid: string, lo: string) => (s >= 70 ? hi : s >= 45 ? mid : lo);

function emptyPillar(): PillarScore { return { score: 0, label: "—", detail: "" }; }
function emptyPillars(): Pillars {
  return {
    overall: 0, grade: "—",
    consistency: emptyPillar(), resilience: emptyPillar(), disruption: emptyPillar(), resources: emptyPillar(), fitness: emptyPillar(),
    counts: { monsters: 0, spells: 0, traps: 0, starters: 0, extenders: 0, interruptions: 0, handTraps: 0, recursion: 0, bricks: 0 },
  };
}

// Score a deck against the five pillars (Consistency, Resilience, Disruption, Resource
// management, Format fitness). Heuristic — it reads card text/structure, not a simulator —
// so treat scores as a sanity gauge, not gospel.
function computePillars(main: ResolvedEntry[], side: ResolvedEntry[], byLower: Map<string, CardRow>): Pillars {
  let monsters = 0, spells = 0, traps = 0, searchers = 0, starters = 0, extenders = 0, interruptions = 0, handTraps = 0, recursion = 0, bricks = 0;
  for (const e of main) {
    const c = byLower.get(e.name.toLowerCase());
    if (!c) continue;
    const n = e.copies;
    const isSpell = c.frame === "spell", isTrap = c.frame === "trap", isMonster = !isSpell && !isTrap;
    if (isSpell) spells += n; else if (isTrap) traps += n; else monsters += n;
    const d = (c.desc || "").toLowerCase();
    const lvl = c.level ?? 0;
    const search = /(?:add|reveal)\b[^.]*\bto (?:your|the) hand/.test(d) || /\bsearch\b/.test(d);
    const draw = /\bdraw (?:1|2|3|two|three|a card|cards)\b/.test(d);
    const ssAny = /special summon/.test(d);
    const ssEngine = /special summon[^.]*from your (?:hand|deck|graveyard|gy)/.test(d);
    const lowSS = isMonster && lvl <= 4 && ssAny;
    if (search) searchers += n;
    if (search || draw || lowSS) starters += n;
    if (isMonster && ssEngine) extenders += n;
    if (c.handTrap) handTraps += n;
    const negate = /negate/.test(d);
    const oppHate = /(?:destroy|banish|return|send)[^.]*(?:your opponent|all (?:monsters|cards)|each player)/.test(d) || /destroy all/.test(d);
    const quick = /during (?:your opponent|either player)/.test(d);
    const floodgate = /can(?:not|'t)\b[^.]*(?:special summon|activate|attack|be special summoned)/.test(d);
    if (c.handTrap || isTrap || negate || floodgate || (oppHate && (isTrap || quick || negate))) interruptions += n;
    if (/(?:add|return|special summon|set)[^.]*from (?:your|the) (?:gy|graveyard)/.test(d) || /return[^.]*to (?:your|the) hand/.test(d) || /shuffle[^.]*(?:into|to) (?:your|the) deck/.test(d) || draw) recursion += n;
    if (isMonster && lvl >= 7 && !ssAny) bricks += n;
  }
  const total = monsters + spells + traps;
  const sideCount = side.reduce((s, e) => s + e.copies, 0);
  const engine = starters + extenders;

  let cons = 100;
  if (total > 40) cons -= (total - 40) * 2;
  if (total < 40) cons -= (40 - total) * 3; // undersized = unfinished/illegal
  if (starters < 10) cons -= (10 - starters) * 5;
  if (monsters < 12) cons -= (12 - monsters) * 3;
  if (bricks > 3) cons -= (bricks - 3) * 5;
  cons = clamp(cons);
  const res = clamp(engine * 6 + (interruptions > 0 ? 6 : 0));
  const dis = clamp(interruptions * 16);
  const rsc = clamp(recursion * 9 + searchers * 4);
  const fit = clamp(55 + Math.min(25, handTraps * 5) + (sideCount >= 10 ? 15 : sideCount > 0 ? 7 : 0));
  const overall = clamp(cons * 0.3 + res * 0.2 + dis * 0.2 + rsc * 0.15 + fit * 0.15);
  const grade = overall >= 85 ? "A" : overall >= 70 ? "B" : overall >= 55 ? "C" : overall >= 40 ? "D" : "E";

  return {
    overall, grade,
    counts: { monsters, spells, traps, starters, extenders, interruptions, handTraps, recursion, bricks },
    consistency: { score: cons, label: tier(cons, "Consistent", "Playable", "Brick-prone"), detail: `${starters} starters · ${bricks} brick${bricks === 1 ? "" : "s"} · ${total} cards` },
    resilience: { score: res, label: tier(res, "Resilient", "Some backup", "Fragile"), detail: `${engine} engine pieces (starters + extenders)` },
    disruption: { score: dis, label: tier(dis, "Oppressive", "Moderate", "Light"), detail: `${interruptions} interruptions · ${handTraps} hand traps · ${traps} traps` },
    resources: { score: rsc, label: tier(rsc, "Grindy", "Okay", "Topdecky"), detail: `${recursion} recycle/advantage · ${searchers} searchers` },
    fitness: { score: fit, label: tier(fit, "Adaptable", "Serviceable", "Narrow"), detail: `all cards legal · ${handTraps} hand traps · side ${sideCount}` },
  };
}

const FORMATS = new Set<DeckFormat>(["advanced", "goat", "edison"]);

/** Generate (but don't save) a deck. Returns a render-ready result with warnings. */
export async function generateDeck(input: { format: DeckFormat; strategy: string; poolMode: PoolMode }): Promise<DeckResult> {
  const userId = await requireUser();
  const format: DeckFormat = FORMATS.has(input.format) ? input.format : "advanced";
  const poolMode: PoolMode = input.poolMode === "any" ? "any" : "collection";
  const base: Omit<DeckResult, "ok" | "error"> = {
    deckName: "", strategy: "", format, poolMode, main: [], extra: [], side: [], counts: { main: 0, extra: 0, side: 0 }, warnings: [],
    pillars: emptyPillars(),
  };

  const owned = await ownedByCard(userId);
  let poolList: string | undefined;

  if (poolMode === "collection") {
    const rows = await prisma.ownedCard.findMany({
      where: { userId },
      select: { quantity: true, printing: { select: { card: { select: { id: true, name: true, frame: true, typeLine: true, level: true, atk: true, def: true, banTcg: true, banGoat: true, banEdison: true, tcgDate: true } } } } },
    });
    const byId = new Map<number, { c: CardRow; qty: number }>();
    for (const o of rows) {
      const c = o.printing.card as CardRow;
      if (!isLegal(c, format)) continue;
      const e = byId.get(c.id) ?? { c, qty: 0 };
      e.qty += o.quantity;
      byId.set(c.id, e);
    }
    const pool = [...byId.values()];
    if (pool.length < 20) {
      return { ...base, ok: false, error: `Only ${pool.length} of your cards are legal in this format — not enough to build from. Try the "Any legal card" pool, or a different format.` };
    }
    poolList = pool
      .slice(0, 600)
      .map(({ c, qty }) => {
        const stats = c.atk != null ? `, ${c.atk}/${c.def ?? "?"}` : "";
        const lvl = c.level ? `, Lv${c.level}` : "";
        return `${c.name} — owned×${Math.min(qty, copyLimit(c, format))} [${c.typeLine}${lvl}${stats}]`;
      })
      .join("\n");
  }

  const raw = await buildDeckJSON({ format, strategy: input.strategy ?? "", poolMode, poolList });
  if (!raw) return { ...base, ok: false, error: "The deck builder didn't return a deck. Check the AI config (AZURE_AI_*) and try again." };

  return finalizeDeck(raw, format, poolMode, owned);
}

/** Resolve names → cards, enforce zones/legality/summonability, score the pillars.
 *  Shared by generateDeck and refineDeck. */
async function finalizeDeck(raw: RawDeck, format: DeckFormat, poolMode: PoolMode, owned: Map<number, number>): Promise<DeckResult> {
  const allNames = [...raw.mainDeck, ...raw.extraDeck, ...raw.sideDeck].map((e) => e.name);
  const byLower = await resolveByName(allNames);
  const warnings: string[] = [];
  let main = resolveSection(raw.mainDeck, byLower, owned, format, poolMode, warnings);
  let extra = resolveSection(raw.extraDeck, byLower, owned, format, poolMode, warnings);
  const side = resolveSection(raw.sideDeck, byLower, owned, format, poolMode, warnings);

  // Zones strictly by frame: Fusion/Synchro/Xyz/Link → Extra, everything else → Main.
  for (let i = main.length - 1; i >= 0; i--) {
    if (main[i].frame && EXTRA_FRAMES.has(main[i].frame as string)) { extra.push(main[i]); main.splice(i, 1); }
  }
  for (let i = extra.length - 1; i >= 0; i--) {
    if (!extra[i].frame || !EXTRA_FRAMES.has(extra[i].frame as string)) { main.push(extra[i]); extra.splice(i, 1); }
  }

  const caps = analyzeMain(main, byLower);
  main = pruneMainRituals(main, byLower, caps, warnings);
  extra = pruneUnsummonable(extra, byLower, caps, warnings);
  const pillars = computePillars(main, side, byLower);

  const counts = {
    main: main.reduce((s, e) => s + e.copies, 0),
    extra: extra.reduce((s, e) => s + e.copies, 0),
    side: side.reduce((s, e) => s + e.copies, 0),
  };
  if (counts.main < 40) warnings.push(`Main Deck has ${counts.main} cards (minimum is 40).`);
  if (counts.main > 60) warnings.push(`Main Deck has ${counts.main} cards (maximum is 60).`);
  if (counts.extra > 15) warnings.push(`Extra Deck has ${counts.extra} cards (maximum is 15).`);

  return { ok: true, deckName: raw.deckName, strategy: raw.strategy, format, poolMode, main, extra, side, counts, warnings, pillars };
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
}): Promise<{ reply: string; result: DeckResult | null }> {
  const userId = await requireUser();
  const format: DeckFormat = FORMATS.has(input.format) ? input.format : "advanced";
  const poolMode: PoolMode = input.poolMode === "any" ? "any" : "collection";
  const owned = await ownedByCard(userId);
  const strip = (a: DeckCardEntry[]) => a.map((e) => ({ name: e.name, copies: e.copies }));
  const r = await refineDeckJSON({
    format, poolMode,
    current: { main: strip(input.current.main), extra: strip(input.current.extra), side: strip(input.current.side) },
    currentName: input.currentName,
    currentStrategy: input.currentStrategy,
    history: input.history ?? [],
    message: input.message,
  });
  if (!r) return { reply: "The deck assistant didn't respond — check the AI config (AZURE_AI_*) and try again.", result: null };
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
      format: FORMATS.has(input.format) ? input.format : "advanced",
      strategy: (input.strategy || "").slice(0, 800),
      poolMode: input.poolMode === "any" ? "any" : "collection",
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
