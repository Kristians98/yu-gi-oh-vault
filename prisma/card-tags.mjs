// Curated card tags that YGOPRODeck doesn't provide as data.
// Edit these lists to refine; matched by exact card name.

// Well-known hand traps (extend freely).
export const HAND_TRAPS = new Set([
  "Ash Blossom & Joyous Spring",
  'Maxx "C"',
  "Effect Veiler",
  "Ghost Ogre & Snow Rabbit",
  "Ghost Belle & Haunted Mansion",
  "Ghost Reaper & Winter Cherries",
  "Ghost Sister & Spooky Dogwood",
  "Ghost Mourner & Moonlit Chill",
  "D.D. Crow",
  "Droll & Lock Bird",
  "Nibiru, the Primal Being",
  "PSY-Framegear Gamma",
  "Infinite Impermanence",
  "Artifact Lancea",
  "Skull Meister",
  "Dimension Shifter",
]);

// Approximate Edison (April 2010 TCG) Forbidden list — best-effort, editable.
// Used only as a "not legal in Edison" signal; release-date eligibility isn't checked.
export const EDISON_FORBIDDEN = new Set([
  "Pot of Greed",
  "Graceful Charity",
  "Change of Heart",
  "Painful Choice",
  "Confiscation",
  "The Forceful Sentry",
  "Delinquent Duo",
  "Card of Safe Return",
  "Last Will",
  "Cyber-Stein",
  "Magical Scientist",
  "Makyura the Destructor",
  "Sinister Serpent",
  "Yata-Garasu",
  "Chaos Emperor Dragon - Envoy of the End",
  "Black Luster Soldier - Envoy of the Beginning",
  "Dark Magician of Chaos",
  "Cyber Jar",
  "Fiber Jar",
  "Witch of the Black Forest",
  "Tribe-Infecting Virus",
  "Victory Dragon",
  "Dark Strike Fighter",
  "Destiny HERO - Disk Commander",
  "Dimension Fusion",
  "Last Turn",
  "Mirage of Nightmare",
  "Metamorphosis",
]);

/** Derive the extra Card columns from a YGOPRODeck card record. */
export function cardExtras(c) {
  const bi = c.banlist_info || {};
  return {
    archetype: c.archetype ?? null,
    banTcg: bi.ban_tcg ?? null,
    banGoat: bi.ban_goat ?? null,
    banEdison: EDISON_FORBIDDEN.has(c.name) ? "Forbidden" : null,
    handTrap: HAND_TRAPS.has(c.name),
    tcgDate: c.misc_info?.[0]?.tcg_date ?? null,
    linkval: c.linkval ?? null,
    isTuner: /tuner/i.test(c.type || ""),
  };
}
