import { describe, expect, it } from "vitest";
import { fairnessVerdict, planTransfer } from "./value";

describe("fairnessVerdict", () => {
  it("calls equal counts an even swap", () => {
    const v = fairnessVerdict(2, 2);
    expect(v.even).toBe(true);
    expect(v.label).toBe("Even swap");
    expect(v.leftPct).toBe(50);
  });
  it("says who gives more, with plural handling", () => {
    expect(fairnessVerdict(3, 1, "Mai").label).toBe("You give 2 more cards");
    expect(fairnessVerdict(1, 2, "Mai").label).toBe("Mai gives 1 more card");
    expect(fairnessVerdict(3, 1).even).toBe(false);
  });
  it("splits the bar by count", () => {
    expect(fairnessVerdict(3, 1).leftPct).toBe(75);
  });
  it("handles an empty trade", () => {
    const v = fairnessVerdict(0, 0);
    expect(v.label).toBe("Pick cards to compare");
    expect(v.leftPct).toBe(50);
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
