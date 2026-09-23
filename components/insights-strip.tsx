import type { ReactNode } from "react";
import type { Card } from "@/lib/cards";

function Stat({ label, value, sub, valueColor }: { label: string; value: string; sub: ReactNode; valueColor?: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value" style={valueColor ? { color: valueColor } : undefined}>{value}</span>
      <span className="stat__sub">{sub}</span>
    </div>
  );
}

export function InsightsStrip({ cards }: { cards: Card[] }) {
  const totalQty = cards.reduce((s, c) => s + c.quantity, 0);
  const sets = new Set(cards.map((c) => c.setName)).size;
  const forTrade = cards.filter((c) => c.forTrade).reduce((s, c) => s + c.quantity, 0);

  // Archetypes: how many the binder spans, and the one with the most copies.
  const byArch = new Map<string, number>();
  for (const c of cards) if (c.archetype) byArch.set(c.archetype, (byArch.get(c.archetype) || 0) + c.quantity);
  const topArch = [...byArch.entries()].sort((a, b) => b[1] - a[1])[0];

  // Newest release in the binder (TCG date), as "Set · year".
  const newest = cards.filter((c) => c.tcgDate).sort((a, b) => (b.tcgDate! < a.tcgDate! ? -1 : 1))[0];

  return (
    <div className="insights">
      <Stat label="Cards" value={String(totalQty)} sub={<>{cards.length} unique</>} />
      <Stat label="Sets" value={String(sets)} sub={<>across your binder</>} />
      <Stat label="For trade" value={String(forTrade)} sub={<>copies up for grabs</>} />
      <Stat label="Archetypes" value={String(byArch.size)} sub={topArch ? <>most: <b>{topArch[0]}</b></> : <>none tagged yet</>} />
      <Stat
        label="Newest"
        value={newest ? newest.tcgDate!.slice(0, 4) : "—"}
        sub={newest ? <b>{newest.setName}</b> : <>no release dates</>}
      />
    </div>
  );
}
