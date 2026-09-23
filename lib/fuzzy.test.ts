import { describe, expect, it } from "vitest";
import { normalizeName, rankCandidates, scoreCandidate, searchTokens, similarity } from "./fuzzy";

const BLUE_EYES = { id: 89631139, name: "Blue-Eyes White Dragon", frame: "normal", attribute: "LIGHT", race: "Dragon", level: 8, atk: 3000, def: 2500 };
const BLUE_EYES_ALT = { id: 38517737, name: "Blue-Eyes Alternative White Dragon", frame: "effect", attribute: "LIGHT", race: "Dragon", level: 8, atk: 3000, def: 2500 };
const RED_EYES = { id: 74677422, name: "Red-Eyes Black Dragon", frame: "normal", attribute: "DARK", race: "Dragon", level: 7, atk: 2400, def: 2000 };
const POT = { id: 55144522, name: "Pot of Greed", frame: "spell", attribute: null, race: "Normal", level: null, atk: null, def: null };

describe("similarity", () => {
  it("ignores case, punctuation and spacing", () => {
    expect(normalizeName("Blue-Eyes  White Dragon!")).toBe("blueeyeswhitedragon");
    expect(similarity("blue eyes white dragon", "Blue-Eyes White Dragon")).toBe(1);
  });
  it("forgives an OCR slip but separates different cards", () => {
    expect(similarity("Blue-Eyes Whlte Dragon", "Blue-Eyes White Dragon")).toBeGreaterThan(0.85);
    expect(similarity("Red-Eyes Black Dragon", "Blue-Eyes White Dragon")).toBeLessThan(0.6);
  });
});

describe("scoreCandidate", () => {
  it("prefers the card whose frame and stats agree when names are near-identical", () => {
    const guess = { name: "Blue-Eyes White Dragon", frame: "normal", attribute: "LIGHT", race: "Dragon", level: 8, atk: 3000, def: 2500 };
    const a = scoreCandidate(guess, BLUE_EYES);
    const b = scoreCandidate(guess, BLUE_EYES_ALT);
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.reasons).toContain("frame matches");
  });
  it("does not let a misread passcode override a clear name", () => {
    // AI read the name fine but the passcode came back as Pot of Greed's
    const guess = { name: "Red-Eyes Black Dragon", frame: "normal", passcode: 55144522 };
    const { best } = rankCandidates(guess, [POT, RED_EYES]);
    expect(best!.card.id).toBe(RED_EYES.id);
  });
  it("uses the passcode to break a tie between similar names", () => {
    const guess = { name: "Blue-Eyes White Dragon", nameConfidence: 0.4, passcode: 38517737 };
    const { best } = rankCandidates(guess, [BLUE_EYES, BLUE_EYES_ALT]);
    expect(best!.card.id).toBe(BLUE_EYES_ALT.id);
  });
});

describe("rankCandidates confidence", () => {
  it("is confident on a clean read with a clear margin", () => {
    const guess = { name: "Pot of Greed", frame: "spell", nameConfidence: 0.95 };
    const r = rankCandidates(guess, [POT, RED_EYES, BLUE_EYES]);
    expect(r.confident).toBe(true);
    expect(r.best!.card.id).toBe(POT.id);
  });
  it("is not confident when two candidates are close", () => {
    const guess = { name: "Blue-Eyes Dragon", nameConfidence: 0.5 };
    const r = rankCandidates(guess, [BLUE_EYES, BLUE_EYES_ALT]);
    expect(r.confident).toBe(false);
    expect(r.ranked).toHaveLength(2);
  });
  it("de-duplicates candidates and handles none", () => {
    expect(rankCandidates({ name: "x" }, [POT, POT]).ranked).toHaveLength(1);
    expect(rankCandidates({ name: "x" }, []).best).toBeNull();
  });
});

describe("searchTokens", () => {
  it("keeps meaningful words only", () => {
    expect(searchTokens("Pot of Greed")).toEqual(["Pot", "Greed"]);
    expect(searchTokens("The Winged Dragon of Ra")).toEqual(["Winged", "Dragon"]);
  });
});
