// Shared mapping from a raw YGOPRODeck card record to our Card / CardPrinting rows.
// Used by the seed, the sync script/cron, and the price cron, so every path stores
// identical values (rarity strings especially — prices are keyed on them).
import { cardExtras } from "./card-tags.mjs";

export const YGOPRODECK_API = "https://db.ygoprodeck.com/api/v7/cardinfo.php";

/** Collapse YGOPRODeck's ~40 rarity names onto the finite set the UI can render.
 *  Order matters: more specific / higher tiers first. */
export function normRarity(s) {
  const x = (s || "").toLowerCase();
  if (x.includes("quarter century")) return "QUARTER_CENTURY_SECRET_RARE";
  if (x.includes("starlight")) return "STARLIGHT_RARE";
  if (x.includes("ghost")) return "GHOST_RARE";
  if (x.includes("ultimate")) return "ULTIMATE_RARE";
  if (x.includes("secret")) return "SECRET_RARE"; // Secret, Prismatic Secret, Platinum Secret, Gold Secret, 10000 Secret…
  if (x.includes("collector")) return "SECRET_RARE"; // Collector's Rare: secret-tier premium foil
  if (x.includes("ultra")) return "ULTRA_RARE"; // Ultra, Ultra Parallel, Pharaoh's Rare
  if (x.includes("gold") || x.includes("platinum")) return "ULTRA_RARE"; // Gold / Premium Gold / Platinum Rare
  if (x.includes("super")) return "SUPER_RARE";
  if (x.includes("rare")) return "RARE"; // Rare, Parallel, Starfoil, Mosaic, Shatterfoil…
  return "COMMON"; // Common, Short Print, Super Short Print
}

export function normFrame(frameType, race, type) {
  const f = (frameType || "").toLowerCase();
  const t = (type || "").toLowerCase();
  if (race === "Divine-Beast" || t.includes("divine")) return "divine";
  if (f.includes("pendulum")) {
    if (f.includes("normal")) return "normal";
    if (f.includes("ritual")) return "ritual";
    if (f.includes("fusion")) return "fusion";
    if (f.includes("synchro")) return "synchro";
    if (f.includes("xyz")) return "xyz";
    return "effect";
  }
  if (f.includes("xyz")) return "xyz";
  if (f.includes("link")) return "link";
  if (f.includes("synchro")) return "synchro";
  if (f.includes("fusion")) return "fusion";
  if (f.includes("ritual")) return "ritual";
  if (f.includes("spell")) return "spell";
  if (f.includes("trap")) return "trap";
  if (f.includes("normal")) return "normal";
  return "effect";
}

export function buildTypeLine(card, frame) {
  if (frame === "spell") return `${card.race || "Normal"} Spell`;
  if (frame === "trap") return `${card.race || "Normal"} Trap`;
  return [card.race, frame.charAt(0).toUpperCase() + frame.slice(1)].filter(Boolean).join(" / ");
}

/** Full Card row for a YGOPRODeck record. */
export function toCardRow(c) {
  const frame = normFrame(c.frameType, c.race, c.type);
  return {
    id: c.id,
    name: c.name,
    frame,
    attribute: c.attribute ?? null,
    typeLine: buildTypeLine(c, frame),
    race: c.race ?? null,
    atk: typeof c.atk === "number" ? c.atk : null,
    def: typeof c.def === "number" ? c.def : null,
    level: typeof c.level === "number" ? c.level : typeof c.rank === "number" ? c.rank : typeof c.linkval === "number" ? c.linkval : null,
    desc: c.desc ?? "",
    ...cardExtras(c),
  };
}

/** Identity of a printing: one row per card × set code × normalized rarity. */
export function printingKey(cardId, setCode, rarity) {
  return `${cardId}|${setCode}|${rarity}`;
}

/** CardPrinting rows for a record, de-duplicated on printingKey. */
export function toPrintingRows(c) {
  const rows = [];
  const seen = new Set();
  for (const s of c.card_sets || []) {
    const rarity = normRarity(s.set_rarity);
    const setCode = s.set_code || "—";
    const key = printingKey(c.id, setCode, rarity);
    if (seen.has(key)) continue;
    seen.add(key);
    const price = parseFloat(s.set_price);
    rows.push({ cardId: c.id, setName: s.set_name || "Unknown Set", setCode, rarity, priceUsd: Number.isNaN(price) ? null : price });
  }
  return rows;
}
