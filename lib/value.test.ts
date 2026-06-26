import { describe, expect, it } from "vitest";
import { effectiveValue, fairnessVerdict, planTransfer } from "./value";

describe("effectiveValue", () => {
  it("returns the full price for Near Mint", () => {
    expect(effectiveValue(100, "NM")).toBe(100);
  });
  it("scales down by condition", () => {
    expect(effectiveValue(100, "LP")).toBe(85);
    expect(effectiveValue(100, "DMG")).toBe(30);
  });
  it("treats a null/missing price as 0", () => {
    expect(effectiveValue(null, "NM")).toBe(0);
    expect(effectiveValue(undefined, "NM")).toBe(0);
  });
  it("falls back to x1 for an unknown condition", () => {
    expect(effectiveValue(50, "???")).toBe(50);
  });
});

describe("fairnessVerdict", () => {
  it("is even when both sides are equal", () => {
    const v = fairnessVerdict(10, 10);
    expect(v.even).toBe(true);
    expect(v.label).toBe("Even trade");
    expect(v.leftPct).toBe(50);
  });
  it("favours the other party when you give more", () => {
    const v = fairnessVerdict(50, 10, "Mai");
    expect(v.delta).toBe(40);
    expect(v.label).toContain("Favours Mai");
    expect(v.even).toBe(false);
  });
  it("favours you when you give less", () => {
    const v = fairnessVerdict(10, 50);
    expect(v.label).toContain("Favours you");
  });
  it("computes the bar fill from the offer share", () => {
    expect(fairnessVerdict(75, 25).leftPct).toBe(75);
  });
});

describe("planTransfer", () => {
  it("moves OFFER proposer→receiver and REQUEST receiver→proposer", () => {
    const items = [
      { side: "OFFER", ownerId: "P", printingId: "p1", condition: "NM", quantity: 1 },
      { side: "REQUEST", ownerId: "R", printingId: "p2", condition: "LP", quantity: 2 },
    ];
    expect(planTransfer(items, "P", "R")).toEqual([
      { from: "P", to: "R", printingId: "p1", condition: "NM", quantity: 1 },
      { from: "R", to: "P", printingId: "p2", condition: "LP", quantity: 2 },
    ]);
  });
  it("returns nothing for an empty trade", () => {
    expect(planTransfer([], "P", "R")).toEqual([]);
  });
});
