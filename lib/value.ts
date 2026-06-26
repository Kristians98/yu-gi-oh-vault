// Pure trade math — no DB/auth, so it's unit-testable (see value.test.ts).
import { CONDITION_MULT, type Condition } from "./cards";

/** A card's tradeable value = market price scaled by condition. */
export function effectiveValue(priceUsd: number | null | undefined, condition: string): number {
  return (priceUsd || 0) * (CONDITION_MULT[condition as Condition] ?? 1);
}

/** Fairness summary for a trade given each side's total value. */
export function fairnessVerdict(offerVal: number, reqVal: number, themName = "them") {
  const delta = offerVal - reqVal; // positive → you give more
  const total = offerVal + reqVal;
  const even = Math.abs(delta) < Math.max(2, total * 0.1);
  const label =
    Math.abs(delta) < 1 ? "Even trade" : delta > 0 ? `Favours ${themName} by $${delta.toFixed(2)}` : `Favours you by $${(-delta).toFixed(2)}`;
  const leftPct = total > 0 ? (offerVal / total) * 100 : 50;
  return { delta, even, label, leftPct };
}

export type TransferInput = { side: string; ownerId: string; printingId: string; condition: string; quantity: number };
export type Transfer = { from: string; to: string; printingId: string; condition: string; quantity: number };

/** Map trade items → ownership transfers on completion. OFFER goes proposer→receiver, REQUEST goes receiver→proposer. */
export function planTransfer(items: TransferInput[], proposerId: string, receiverId: string): Transfer[] {
  return items.map((it) => ({
    from: it.ownerId,
    to: it.side === "OFFER" ? receiverId : proposerId,
    printingId: it.printingId,
    condition: it.condition,
    quantity: it.quantity,
  }));
}
