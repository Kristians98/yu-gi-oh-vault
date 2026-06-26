import { type Rarity, RARITY } from "@/lib/cards";

const FORMATS = [
  { v: "ALL", label: "All formats" },
  { v: "advanced", label: "Advanced legal" },
  { v: "goat", label: "Goat legal" },
  { v: "edison", label: "Edison legal" },
];

export function FilterBar({
  rarities,
  active,
  onRarity,
  archetypes,
  archetype,
  onArchetype,
  format,
  onFormat,
  forTradeOnly,
  onToggleTrade,
  handTrapOnly,
  onToggleHandTrap,
  count,
}: {
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
}) {
  return (
    <div className="filterbar">
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

      <button className={"chip" + (active === "ALL" ? " chip--active" : "")} onClick={() => onRarity("ALL")}>All</button>
      {rarities.map((rk) => (
        <button key={rk} className={"chip" + (active === rk ? " chip--active" : "")} onClick={() => onRarity(rk)}>
          <span className="chip__dot" style={{ background: RARITY[rk].color }} />
          {RARITY[rk].label}
        </button>
      ))}

      <div className="filterbar__spacer" />

      <button className={"toggle" + (handTrapOnly ? " toggle--on" : "")} onClick={onToggleHandTrap} aria-pressed={handTrapOnly}>
        <span className="toggle__sw" />
        Hand traps
      </button>
      <button className={"toggle" + (forTradeOnly ? " toggle--on" : "")} onClick={onToggleTrade} aria-pressed={forTradeOnly}>
        <span className="toggle__sw" />
        For trade
      </button>
      <span className="filterbar__count">{count} shown</span>
    </div>
  );
}
