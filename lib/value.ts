// Pure trade math — no DB/auth, so it's unit-testable (see value.test.ts).
// There is no price data in the app (no source is reliable enough), so trades are
// compared by what each side hands over: the card count.

/** Fairness summary for a trade given how many cards each side gives. */
export function fairnessVerdict(offerCount: number, reqCount: number, themName = "them") {
  const delta = offerCount - reqCount; // positive → you give more cards
  const total = offerCount + reqCount;
  const even = delta === 0;
  const plural = (n: number) => `${n} more card${n === 1 ? "" : "s"}`;
  const label =
    total === 0 ? "Pick cards to compare" : even ? "Even swap" : delta > 0 ? `You give ${plural(delta)}` : `${themName} gives ${plural(-delta)}`;
  const leftPct = total > 0 ? (offerCount / total) * 100 : 50;
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
