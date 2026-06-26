// Display types + rarity/frame/condition config shared across the UI.
// Card data now comes from the database (see lib/map.ts); this file is config only.

export type Rarity =
  | "COMMON"
  | "RARE"
  | "SUPER_RARE"
  | "ULTRA_RARE"
  | "SECRET_RARE"
  | "ULTIMATE_RARE"
  | "GHOST_RARE"
  | "STARLIGHT_RARE"
  | "QUARTER_CENTURY_SECRET_RARE";

export type Condition = "NM" | "LP" | "MP" | "HP" | "DMG";

export type Frame =
  | "normal"
  | "effect"
  | "spell"
  | "trap"
  | "ritual"
  | "fusion"
  | "synchro"
  | "xyz"
  | "link"
  | "divine";

export type Attribute = "DARK" | "LIGHT" | "WATER" | "FIRE" | "EARTH" | "WIND" | "DIVINE";

export interface Card {
  id: number; // passcode == YGOPRODeck card id (drives art URL)
  name: string;
  frame: Frame;
  attribute?: Attribute;
  typeLine: string;
  atk?: number | null;
  def?: number | null;
  level?: number;
  setName: string;
  setCode: string;
  rarity: Rarity;
  condition: Condition;
  quantity: number;
  priceUsd: number;
  forTrade: boolean;
  desc?: string; // card effect / lore text
  archetype?: string | null;
  banTcg?: string | null; // current TCG (Advanced) banlist status
  banGoat?: string | null; // Goat format banlist status
  banEdison?: string | null; // approximate Edison (Apr-2010) status
  handTrap?: boolean;
  tcgDate?: string | null; // TCG release date (YYYY-MM-DD) for format-pool filters
  ownedId?: string; // OwnedCard row id (present for cards loaded from the DB)
  printingId?: string;
}

/** Rarity → display + visual-effect tier (0 flat … 5 prismatic). */
export const RARITY: Record<Rarity, { label: string; abbr: string; tier: number; color: string }> = {
  COMMON: { label: "Common", abbr: "C", tier: 0, color: "#b9b3c4" },
  RARE: { label: "Rare", abbr: "R", tier: 1, color: "#d2d9ea" },
  SUPER_RARE: { label: "Super Rare", abbr: "SR", tier: 2, color: "#7fd3c4" },
  ULTRA_RARE: { label: "Ultra Rare", abbr: "UR", tier: 3, color: "#f0c969" },
  SECRET_RARE: { label: "Secret Rare", abbr: "ScR", tier: 4, color: "#c79bff" },
  ULTIMATE_RARE: { label: "Ultimate Rare", abbr: "UtR", tier: 4, color: "#ff9d6b" },
  GHOST_RARE: { label: "Ghost Rare", abbr: "GR", tier: 5, color: "#b8f5ff" },
  STARLIGHT_RARE: { label: "Starlight Rare", abbr: "StR", tier: 5, color: "#9ec1ff" },
  QUARTER_CENTURY_SECRET_RARE: { label: "Quarter Century", abbr: "QCSR", tier: 5, color: "#7ef0d0" },
};

export const FRAME_COLOR: Record<Frame, string> = {
  normal: "#c9a84a",
  effect: "#b85c2e",
  spell: "#1d9e74",
  trap: "#b0306e",
  ritual: "#3a6fb0",
  fusion: "#7a4ba8",
  synchro: "#e8e8e8",
  xyz: "#2a2a33",
  link: "#1f6fb0",
  divine: "#c9a227",
};

export const ATTRIBUTE_COLOR: Record<Attribute, string> = {
  DARK: "#7a5bb0",
  LIGHT: "#d9b45b",
  WATER: "#2e7fb8",
  FIRE: "#c0392b",
  EARTH: "#9c7b3b",
  WIND: "#2e9e74",
  DIVINE: "#d4af37",
};

/** condition → value multiplier (resolves trade valuation, see ARCHITECTURE §13). */
export const CONDITION_MULT: Record<Condition, number> = {
  NM: 1,
  LP: 0.85,
  MP: 0.7,
  HP: 0.5,
  DMG: 0.3,
};

export function artUrl(id: number, small = false): string {
  // Served via our proxy (app/api/card-image) — caches locally, no client hot-linking.
  return `/api/card-image/${id}${small ? "?s=1" : ""}`;
}

// Deterministic, locale-independent number formatting.
// Using a fixed locale keeps server-rendered and client-hydrated text identical
// (the default toLocaleString() varies by machine locale → hydration mismatch).
const NUM = new Intl.NumberFormat("en-US");
export const num = (n: number): string => NUM.format(n);
export const money = (n: number): string => "$" + NUM.format(n);

/** The 5 Exodia pieces — owning all lights up the Insights badge. */
export const EXODIA_PIECES = [33396948, 70903634, 7902349, 8124921, 44519536];
