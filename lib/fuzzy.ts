// Pure card-matching logic for the scanner (no DB/auth → unit-testable, see fuzzy.test.ts).
//
// The AI reads a photo and returns what it *thinks* it sees. Individual fields are noisy
// (an 8-digit passcode with one wrong digit points at an unrelated card), so instead of
// trusting any single field we score every candidate on all of them, in the order the
// user cares about: name first, then frame colour, then attribute / type / stats. The
// passcode is a strong bonus, never the sole decider.

export type ScanGuess = {
  name?: string;
  nameConfidence?: number; // 0..1, how legible the name was
  frame?: string; // normal | effect | spell | trap | ritual | fusion | synchro | xyz | link | divine
  attribute?: string; // DARK | LIGHT | WATER | FIRE | EARTH | WIND | DIVINE
  race?: string; // Dragon, Spellcaster, … (or spell/trap kind: Quick-Play, Counter, …)
  level?: number | null; // level / rank / link rating
  atk?: number | null;
  def?: number | null;
  passcode?: number;
  setCode?: string;
};

export type CandidateCard = {
  id: number;
  name: string;
  frame: string;
  attribute?: string | null;
  race?: string | null;
  level?: number | null;
  atk?: number | null;
  def?: number | null;
};

/** Lower-case, strip punctuation/diacritics/spaces → comparable key. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Sørensen–Dice coefficient on character bigrams, 0..1. Forgiving of OCR slips. */
export function similarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const n = grams.get(g) || 0;
    if (n > 0) {
      hits++;
      grams.set(g, n - 1);
    }
  }
  return (2 * hits) / (x.length - 1 + (y.length - 1));
}

const norm = (s?: string | null) => (s || "").toLowerCase().replace(/[^a-z]/g, "");

export type Scored<T> = { card: T; score: number; nameSim: number; reasons: string[] };

/** Score one candidate against the guess. ~0..100; name dominates. */
export function scoreCandidate<T extends CandidateCard>(guess: ScanGuess, card: T): Scored<T> {
  const reasons: string[] = [];
  let score = 0;
  const nameSim = guess.name ? similarity(guess.name, card.name) : 0;
  if (guess.name) {
    // Weight the name by how legible the AI said it was (default: fairly legible).
    const conf = guess.nameConfidence ?? 0.8;
    score += nameSim * (45 + 15 * conf);
    if (nameSim >= 0.92) reasons.push("name matches");
    else if (nameSim >= 0.7) reasons.push("name close");
  }
  if (guess.frame) {
    if (norm(guess.frame) === norm(card.frame)) {
      score += 12;
      reasons.push("frame matches");
    } else score -= 8;
  }
  if (guess.attribute && card.attribute) {
    if (norm(guess.attribute) === norm(card.attribute)) {
      score += 8;
      reasons.push("attribute matches");
    } else score -= 5;
  }
  if (guess.race && card.race) {
    if (norm(guess.race) === norm(card.race)) {
      score += 8;
      reasons.push("type matches");
    } else score -= 3;
  }
  if (guess.level != null && card.level != null) {
    if (guess.level === card.level) score += 5;
    else score -= 3;
  }
  if (guess.atk != null && card.atk != null) {
    if (guess.atk === card.atk) score += 5;
    else score -= 3;
  }
  if (guess.def != null && card.def != null) {
    if (guess.def === card.def) score += 5;
    else score -= 3;
  }
  if (guess.passcode != null && guess.passcode === card.id) {
    score += 25;
    reasons.push("passcode matches");
  }
  return { card, score, nameSim, reasons };
}

export type Resolution<T> = { best: Scored<T> | null; confident: boolean; ranked: Scored<T>[] };

/** Rank candidates; `confident` means auto-pick is safe (high score with a clear margin). */
export function rankCandidates<T extends CandidateCard>(guess: ScanGuess, cards: T[]): Resolution<T> {
  const seen = new Set<number>();
  const ranked = cards
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .map((c) => scoreCandidate(guess, c))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0] ?? null;
  const second = ranked[1];
  const margin = best ? best.score - (second?.score ?? -Infinity) : 0;
  // Strong name (or name + passcode agreement) and nothing close behind it.
  const confident = !!best && best.score >= 55 && best.nameSim >= 0.75 && margin >= 10;
  return { best, confident, ranked };
}

/** Words worth searching the DB for (skip articles and 1–2 letter fragments). */
export function searchTokens(name: string): string[] {
  const stop = new Set(["the", "of", "and", "a", "an", "to", "in", "no", "de", "la", "le"]);
  const out: string[] = [];
  for (const w of name.split(/[^A-Za-z0-9']+/)) {
    const t = w.replace(/'/g, "");
    if (t.length >= 3 && !stop.has(t.toLowerCase()) && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 5);
}
