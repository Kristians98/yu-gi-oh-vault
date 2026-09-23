"use client";

import { useState } from "react";
import { type Rarity, RARITY } from "@/lib/cards";

const FORMATS = [
  { v: "ALL", label: "All formats" },
  { v: "advanced", label: "Advanced legal" },
  { v: "goat", label: "Goat legal" },
  { v: "edison", label: "Edison legal" },
];

type Props = {
  rarities: Rarity[];
  active: Rarity | "ALL";
  onRarity: (r: Rarity | "ALL") => void;
  archetypes: string[];
  archetype: string;
  onArchetype: (a: string) => void;
  format: string;
  onFormat: (f: string) => void;
  forTradeOnly: boolean;
  onToggleTrade: () => void;
  handTrapOnly: boolean;
  onToggleHandTrap: () => void;
  count: number;
};

/** Format / archetype / toggles. Rendered inline on desktop and inside the sheet on phones. */
function Controls({ archetypes, archetype, onArchetype, format, onFormat, forTradeOnly, onToggleTrade, handTrapOnly, onToggleHandTrap, sheet }: Omit<Props, "rarities" | "active" | "onRarity" | "count"> & { sheet?: boolean }) {
  const Row = sheet ? "div" : "span";
  return (
    <>
      <Row className={sheet ? "fsheet__row" : undefined}>
        <select className="fsel" value={format} onChange={(e) => onFormat(e.target.value)} aria-label="Format legality">
          {FORMATS.map((f) => (
            <option key={f.v} value={f.v}>{f.label}</option>
          ))}
        </select>
        {archetypes.length > 0 && (
          <select className="fsel" value={archetype} onChange={(e) => onArchetype(e.target.value)} aria-label="Archetype">
            <option value="ALL">All archetypes</option>
            {archetypes.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        )}
      </Row>
      <Row className={sheet ? "fsheet__row" : undefined}>
        <button className={"toggle" + (handTrapOnly ? " toggle--on" : "")} onClick={onToggleHandTrap} aria-pressed={handTrapOnly}>
          <span className="toggle__sw" />
          Hand traps
        </button>
        <button className={"toggle" + (forTradeOnly ? " toggle--on" : "")} onClick={onToggleTrade} aria-pressed={forTradeOnly}>
          <span className="toggle__sw" />
          For trade
        </button>
      </Row>
    </>
  );
}

/**
 * Binder filters. Desktop: rarity chips wrap, and format/archetype/toggles sit inline.
 * Phone: chips are one swipeable row, and the rest lives in a bottom sheet behind a
 * single "Filters" button with an active-count badge, so the cards start near the top.
 */
export function FilterBar(props: Props) {
  const { rarities, active, onRarity, archetype, format, forTradeOnly, handTrapOnly, count } = props;
  const [open, setOpen] = useState(false);
  const activeN = (format !== "ALL" ? 1 : 0) + (archetype !== "ALL" ? 1 : 0) + (handTrapOnly ? 1 : 0) + (forTradeOnly ? 1 : 0);

  function clearAll() {
    props.onFormat("ALL");
    props.onArchetype("ALL");
    if (handTrapOnly) props.onToggleHandTrap();
    if (forTradeOnly) props.onToggleTrade();
    onRarity("ALL");
  }

  return (
    <div className="filters">
      <div className="filters__chips" role="tablist" aria-label="Rarity">
        <button className={"chip" + (active === "ALL" ? " chip--active" : "")} onClick={() => onRarity("ALL")}>All</button>
        {rarities.map((rk) => (
          <button key={rk} className={"chip" + (active === rk ? " chip--active" : "")} onClick={() => onRarity(rk)}>
            <span className="chip__dot" style={{ background: RARITY[rk].color }} />
            {RARITY[rk].label}
          </button>
        ))}
      </div>

      <div className="filters__tools">
        <button className={"filters__open" + (activeN ? " filters__open--on" : "")} onClick={() => setOpen(true)} aria-haspopup="dialog">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          Filters
          {activeN > 0 && <span className="filters__badge">{activeN}</span>}
        </button>
        <div className="filters__inline">
          <Controls {...props} />
        </div>
        <span className="filters__count">{count} shown</span>
      </div>

      {open && (
        <div className="fsheet" role="dialog" aria-label="Filters" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="fsheet__panel">
            <div className="fsheet__head">
              <span className="panel__title" style={{ margin: 0 }}>Filters</span>
              <span className="filters__count">{count} shown</span>
            </div>
            <Controls {...props} sheet />
            <div className="fsheet__actions">
              <button className="btn-ghost" onClick={clearAll} disabled={activeN === 0 && active === "ALL"}>Clear all</button>
              <button className="btn-add" onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
