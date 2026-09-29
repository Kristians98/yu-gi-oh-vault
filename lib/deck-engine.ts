// Deck engine — server-only helpers shared by the Decks page (lib/decks.ts) and Play
// (lib/duels.ts). NOT a "use server" file: nothing here is callable from the client, so
// functions may take a userId (Play builds decks for both players).

import { prisma } from "@/lib/prisma";
import { containsCI } from "@/lib/db-text";
import { buildDeckJSON, type RawDeck } from "@/lib/deck-ai";
import { MUTATORS, type MutatorKey } from "@/lib/duel-rules";
import type { Thinking } from "@/lib/thinking";

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

/** Extra rules a build must obey (Play): banned/pinned names, mutators, and a deck to patch. */
export type BuildConstraints = {
  banned?: string[];
  pinned?: string[];
  mutators?: MutatorKey[];
  /** Patch mode: start from this deck and change as little as possible. */
  current?: { name: string; strategy: string; cards: DeckCards } | null;
};

const EXTRA_FRAMES = new Set(["fusion", "synchro", "xyz", "link"]);
const FORMATS = new Set<DeckFormat>(["advanced", "goat", "edison"]);

export const normalizeFormat = (f: unknown): DeckFormat => (FORMATS.has(f as DeckFormat) ? (f as DeckFormat) : "advanced");
export const normalizePoolMode = (p: unknown): PoolMode => (p === "any" ? "any" : "collection");

export type CardRow = {
  id: number; name: string; frame: string; typeLine: string; level: number | null; atk: number | null; def: number | null;
  banTcg: string | null; banGoat: string | null; banEdison: string | null; tcgDate: string | null; desc: string; linkval: number | null; isTuner: boolean; handTrap: boolean;
  archetype?: string | null;
};

const CARD_SELECT = { id: true, name: true, frame: true, typeLine: true, level: true, atk: true, def: true, banTcg: true, banGoat: true, banEdison: true, tcgDate: true, desc: true, linkval: true, isTuner: true, handTrap: true, archetype: true } as const;
// Pool listings never read card text; leaving `desc` out keeps a big binder's query light.
const POOL_SELECT = { id: true, name: true, frame: true, typeLine: true, level: true, atk: true, def: true, banTcg: true, banGoat: true, banEdison: true, tcgDate: true, linkval: true, isTuner: true, handTrap: true, archetype: true } as const;

function banFieldFor(c: CardRow, format: DeckFormat): string | null {
  return format === "goat" ? c.banGoat : format === "edison" ? c.banEdison : c.banTcg;
}

export function isLegal(c: CardRow, format: DeckFormat): boolean {
  if (banFieldFor(c, format) === "Forbidden") return false;
  if (format === "goat") return !!c.tcgDate && c.tcgDate <= "2005-09-01";
  if (format === "edison") return !!c.tcgDate && c.tcgDate <= "2010-04-01";
  return true; // advanced = current pool
}

export function copyLimit(c: CardRow, format: DeckFormat): number {
  const b = banFieldFor(c, format);
  if (b === "Limited") return 1;
  if (b === "Semi-Limited") return 2;
  return 3;
}

/** Sum a user's owned quantity per cardId (across printings/conditions). */
export async function ownedByCard(userId: string): Promise<Map<number, number>> {
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

export type PoolEntry = { c: CardRow; qty: number };

/** A user's owned cards that are legal in `format`, one entry per card with summed quantity. */
export async function legalPool(userId: string, format: DeckFormat): Promise<PoolEntry[]> {
  const rows = await prisma.ownedCard.findMany({
    where: { userId },
    select: { quantity: true, printing: { select: { card: { select: POOL_SELECT } } } },
  });
  const byId = new Map<number, PoolEntry>();
  for (const o of rows) {
    const c = { ...o.printing.card, desc: "" } as CardRow;
    if (!isLegal(c, format)) continue;
    const e = byId.get(c.id) ?? { c, qty: 0 };
    e.qty += o.quantity;
    byId.set(c.id, e);
  }
  return [...byId.values()];
}

export async function legalPoolSize(userId: string, format: DeckFormat): Promise<number> {
  return (await legalPoolSizes([userId])).get(userId)?.[format] ?? 0;
}

const ALL_FORMATS: DeckFormat[] = ["advanced", "goat", "edison"];

/** Distinct legal cards per user per format — one light query for all users (Play home). */
export async function legalPoolSizes(userIds: string[]): Promise<Map<string, Record<DeckFormat, number>>> {
  const out = new Map<string, Record<DeckFormat, number>>();
  for (const u of userIds) out.set(u, { advanced: 0, goat: 0, edison: 0 });
  if (userIds.length === 0) return out;
  const rows = await prisma.ownedCard.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, printing: { select: { card: { select: { id: true, banTcg: true, banGoat: true, banEdison: true, tcgDate: true } } } } },
  });
  const seen = new Map<string, Set<number>>(); // `${userId}:${format}` -> distinct card ids
  for (const r of rows) {
    const c = r.printing.card as unknown as CardRow;
    for (const f of ALL_FORMATS) {
      if (!isLegal(c, f)) continue;
      const k = `${r.userId}:${f}`;
      let set = seen.get(k);
      if (!set) { set = new Set(); seen.set(k, set); }
      set.add(c.id);
    }
  }
  for (const [k, set] of seen) {
    const [u, f] = k.split(":") as [string, DeckFormat];
    const rec = out.get(u);
    if (rec) rec[f] = set.size;
  }
  return out;
}

/** Newline list the model builds from: "Name — owned×N [type, Lv, atk/def]". */
export function poolListText(pool: PoolEntry[], format: DeckFormat): string {
  return pool
    .slice(0, 600)
    .map(({ c, qty }) => {
      const stats = c.atk != null ? `, ${c.atk}/${c.def ?? "?"}` : "";
      const lvl = c.level ? `, Lv${c.level}` : "";
      return `${c.name} — owned×${Math.min(qty, copyLimit(c, format))} [${c.typeLine}${lvl}${stats}]`;
    })
    .join("\n");
}

/** Roulette: a random archetype the player actually has enough cards for. */
export async function pickRouletteTheme(userId: string, format: DeckFormat, exclude?: string | null): Promise<string | null> {
  const pool = await legalPool(userId, format);
  const by = new Map<string, { distinct: number; copies: number }>();
  for (const { c, qty } of pool) {
    if (!c.archetype) continue;
    const e = by.get(c.archetype) ?? { distinct: 0, copies: 0 };
    e.distinct += 1;
    e.copies += Math.min(qty, copyLimit(c, format));
    by.set(c.archetype, e);
  }
  let candidates = [...by.entries()].filter(([, v]) => v.distinct >= 6 && v.copies >= 10).map(([k]) => k);
  if (exclude && candidates.length > 1) candidates = candidates.filter((k) => k !== exclude);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/** Search a user's legal pool by name (for pin / plant pickers). */
export async function searchOwnedLegal(userId: string, format: DeckFormat, q: string, limit = 14): Promise<{ id: number; name: string; frame: string; typeLine: string; qty: number }[]> {
  const needle = q.trim().toLowerCase();
  const pool = await legalPool(userId, format);
  const hits = needle ? pool.filter(({ c }) => c.name.toLowerCase().includes(needle)) : pool;
  return hits
    .sort((a, b) => a.c.name.localeCompare(b.c.name))
    .slice(0, limit)
    .map(({ c, qty }) => ({ id: c.id, name: c.name, frame: c.frame, typeLine: c.typeLine, qty }));
}

/** Resolve AI card names → DB cards (exact first, then a case-insensitive fallback). */
async function resolveByName(names: string[]): Promise<Map<string, CardRow>> {
  const uniq = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const byLower = new Map<string, CardRow>();
  if (uniq.length === 0) return byLower;
  const exact = await prisma.card.findMany({ where: { name: { in: uniq } }, select: CARD_SELECT });
  for (const c of exact) byLower.set(c.name.toLowerCase(), c);
  for (const n of uniq) {
    if (byLower.has(n.toLowerCase())) continue;
    const f = await prisma.card.findFirst({ where: { name: containsCI(n) }, select: CARD_SELECT, orderBy: { name: "asc" } });
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
    const copies = Math.min(e.copies, cap || (poolMode === "collection" ? 0 : limit));
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
export function emptyPillars(): Pillars {
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

function emptyResult(format: DeckFormat, poolMode: PoolMode, error: string): DeckResult {
  return { ok: false, error, deckName: "", strategy: "", format, poolMode, main: [], extra: [], side: [], counts: { main: 0, extra: 0, side: 0 }, warnings: [], pillars: emptyPillars() };
}

const lower = (a: string[] | undefined) => new Set((a ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean));

/** Apply duel constraints after name resolution: banned out, mutators enforced, pinned in. */
function applyConstraints(
  main: ResolvedEntry[], extra: ResolvedEntry[], side: ResolvedEntry[],
  byLower: Map<string, CardRow>, owned: Map<number, number>, format: DeckFormat, poolMode: PoolMode,
  cons: BuildConstraints, warnings: string[],
): { main: ResolvedEntry[]; extra: ResolvedEntry[]; side: ResolvedEntry[] } {
  const banned = lower(cons.banned);
  const pinned = lower(cons.pinned);
  const muts = new Set(cons.mutators ?? []);
  const rowOf = (e: ResolvedEntry) => byLower.get(e.name.toLowerCase());

  const notBanned = (e: ResolvedEntry) => {
    if (!banned.has(e.name.toLowerCase())) return true;
    warnings.push(`"${e.name}" is banned in this duel — removed.`);
    return false;
  };
  main = main.filter(notBanned); extra = extra.filter(notBanned); side = side.filter(notBanned);

  const isPinned = (e: ResolvedEntry) => pinned.has(e.name.toLowerCase());
  if (muts.has("noExtra") && extra.length) {
    warnings.push(`No Extra Deck mutator — removed ${extra.length} Extra Deck card${extra.length === 1 ? "" : "s"}.`);
    extra = extra.filter(isPinned);
  }
  if (muts.has("highlander")) {
    const one = (e: ResolvedEntry) => (e.copies > 1 ? { ...e, copies: 1 } : e);
    main = main.map(one); extra = extra.map(one); side = side.map(one);
  }
  if (muts.has("noHandTraps")) {
    const keep = (e: ResolvedEntry) => {
      if (isPinned(e) || !rowOf(e)?.handTrap) return true;
      warnings.push(`No hand traps mutator — removed "${e.name}".`);
      return false;
    };
    main = main.filter(keep); side = side.filter(keep);
  }
  if (muts.has("lowLevel")) {
    main = main.filter((e) => {
      const c = rowOf(e);
      if (isPinned(e) || !c || c.frame === "spell" || c.frame === "trap" || (c.level ?? 0) <= 4) return true;
      warnings.push(`Low Level mutator — removed Level ${c.level} "${e.name}".`);
      return false;
    });
  }

  for (const name of pinned) {
    const present = [...main, ...extra].some((e) => e.name.toLowerCase() === name);
    if (present) continue;
    const c = byLower.get(name);
    if (!c) { warnings.push(`Pinned card "${name}" not found.`); continue; }
    const ownedN = owned.get(c.id) ?? 0;
    if (poolMode === "collection" && ownedN === 0) { warnings.push(`Pinned "${c.name}" isn't in the binder — skipped.`); continue; }
    if (!isLegal(c, format)) { warnings.push(`Pinned "${c.name}" isn't legal here — skipped.`); continue; }
    const entry: ResolvedEntry = { id: c.id, name: c.name, copies: 1, frame: c.frame, owned: ownedN, legal: true, typeLine: c.typeLine };
    if (EXTRA_FRAMES.has(c.frame)) extra.push(entry); else main.push(entry);
    warnings.push(`Pinned "${c.name}" added (the AI left it out).`);
  }
  return { main, extra, side };
}

/** Resolve names → cards, enforce zones/legality/summonability/constraints, score the pillars. */
export async function finalizeDeck(raw: RawDeck, format: DeckFormat, poolMode: PoolMode, owned: Map<number, number>, cons: BuildConstraints = {}): Promise<DeckResult> {
  const allNames = [...raw.mainDeck, ...raw.extraDeck, ...raw.sideDeck].map((e) => e.name).concat(cons.pinned ?? []);
  const byLower = await resolveByName(allNames);
  const warnings: string[] = [];
  let main = resolveSection(raw.mainDeck, byLower, owned, format, poolMode, warnings);
  let extra = resolveSection(raw.extraDeck, byLower, owned, format, poolMode, warnings);
  let side = resolveSection(raw.sideDeck, byLower, owned, format, poolMode, warnings);

  // Zones strictly by frame: Fusion/Synchro/Xyz/Link → Extra, everything else → Main.
  for (let i = main.length - 1; i >= 0; i--) {
    if (main[i].frame && EXTRA_FRAMES.has(main[i].frame as string)) { extra.push(main[i]); main.splice(i, 1); }
  }
  for (let i = extra.length - 1; i >= 0; i--) {
    if (!extra[i].frame || !EXTRA_FRAMES.has(extra[i].frame as string)) { main.push(extra[i]); extra.splice(i, 1); }
  }

  ({ main, extra, side } = applyConstraints(main, extra, side, byLower, owned, format, poolMode, cons, warnings));

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

/** Build (but don't save) a deck for `userId`. Returns a render-ready result with warnings. */
export async function buildDeckForUser(
  userId: string,
  input: { format: DeckFormat; strategy: string; poolMode: PoolMode; constraints?: BuildConstraints; thinking?: Thinking },
): Promise<DeckResult> {
  const format = normalizeFormat(input.format);
  const poolMode = normalizePoolMode(input.poolMode);
  const cons = input.constraints ?? {};
  const owned = await ownedByCard(userId);
  let poolList: string | undefined;

  if (poolMode === "collection") {
    const pool = await legalPool(userId, format);
    if (pool.length < 20) {
      return emptyResult(format, poolMode, `Only ${pool.length} of your cards are legal in this format — not enough to build from. Try the "Any legal card" pool, or a different format.`);
    }
    poolList = poolListText(pool, format);
  }

  const out = await buildDeckJSON({
    format,
    strategy: input.strategy ?? "",
    poolMode,
    poolList,
    thinking: input.thinking,
    banned: cons.banned,
    pinned: cons.pinned,
    mutatorLines: (cons.mutators ?? []).map((m) => MUTATORS[m]?.prompt).filter(Boolean) as string[],
    current: cons.current
      ? {
          name: cons.current.name,
          strategy: cons.current.strategy,
          main: cons.current.cards.main.map((e) => ({ name: e.name, copies: e.copies })),
          extra: cons.current.cards.extra.map((e) => ({ name: e.name, copies: e.copies })),
          side: cons.current.cards.side.map((e) => ({ name: e.name, copies: e.copies })),
        }
      : undefined,
  });
  if (!out.deck) return emptyResult(format, poolMode, out.error);

  const result = await finalizeDeck(out.deck, format, poolMode, owned, cons);
  if (out.note) result.warnings.unshift(out.note);
  return result;
}
