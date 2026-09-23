import type { ReactNode } from "react";
import { type Card, RARITY, EXODIA_PIECES } from "@/lib/cards";

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
  const rarest = cards.length ? [...cards].sort((a, b) => RARITY[b.rarity].tier - RARITY[a.rarity].tier)[0] : null;

  const ownedIds = new Set(cards.map((c) => c.id));
  const exodiaCount = EXODIA_PIECES.filter((id) => ownedIds.has(id)).length;
  const exodiaComplete = exodiaCount === EXODIA_PIECES.length;

  return (
    <div className="insights">
      <Stat label="Cards" value={String(totalQty)} sub={<>{cards.length} unique</>} />
      <Stat label="Sets" value={String(sets)} sub={<>across your binder</>} />
      <Stat label="For trade" value={String(forTrade)} sub={<>copies up for grabs</>} />
      <Stat
        label="Rarest"
        value={rarest ? RARITY[rarest.rarity].abbr : "—"}
        valueColor={rarest ? RARITY[rarest.rarity].color : undefined}
        sub={rarest ? <b>{rarest.name}</b> : <>nothing yet</>}
      />
      <div className="stat stat--exodia">
        <span className="stat__label">Exodia</span>
        {exodiaComplete ? (
          <span className="stat__value holo-text">COMPLETE</span>
        ) : (
          <span className="stat__value" style={{ color: "var(--muted-2)" }}>{exodiaCount}/5</span>
        )}
        <span className={"stat__sub" + (exodiaComplete ? "" : " stat__sub--locked")}>
          {exodiaComplete ? "all five pieces — you win" : "pieces collected"}
        </span>
      </div>
    </div>
  );
}
