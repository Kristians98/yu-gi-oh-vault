"use client";

import { FRAME_COLOR, artUrl, type Frame } from "@/lib/cards";
import type { DeckCardEntry, DeckCards, DeckResult, ResolvedEntry } from "@/lib/deck-engine";

// Presentational pieces shared by the Deck Builder and Play (duel rooms).

export function frameVar(frame: string | null): React.CSSProperties {
  const c = frame ? FRAME_COLOR[frame as Frame] : undefined;
  return c ? ({ "--frame": c } as React.CSSProperties) : {};
}

export function Thumb({
  e,
  showNeed,
  onClick,
  selected,
  marked,
}: {
  e: ResolvedEntry | DeckCardEntry;
  showNeed?: boolean;
  onClick?: (e: ResolvedEntry | DeckCardEntry) => void;
  selected?: boolean;
  marked?: "pinned" | "new";
}) {
  const owned = "owned" in e ? e.owned : undefined;
  const need = showNeed && owned != null ? Math.max(0, e.copies - owned) : 0;
  const legalBad = "legal" in e && !e.legal;
  const cls = "dthumb" + (legalBad ? " dthumb--bad" : "") + (onClick ? " dthumb--pick" : "") + (selected ? " dthumb--sel" : "");
  const inner = (
    <>
      {e.id ? (
        <img className="dthumb__img" src={artUrl(e.id, true)} alt={e.name} loading="lazy" draggable={false} />
      ) : (
        <div className="dthumb__ph">{e.name}</div>
      )}
      {e.copies > 1 && <span className="dthumb__x">×{e.copies}</span>}
      {need > 0 && <span className="dthumb__need">need {need}</span>}
      {marked && <span className={"dthumb__mark dthumb__mark--" + marked}>{marked === "pinned" ? "pin" : "new"}</span>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={cls} style={frameVar(e.frame)} title={e.name} onClick={() => onClick(e)} aria-pressed={selected}>
        {inner}
      </button>
    );
  }
  return (
    <div className={cls} style={frameVar(e.frame)} title={e.name}>
      {inner}
    </div>
  );
}

export function Section({
  title,
  count,
  entries,
  showNeed,
  onPick,
  selectedName,
  pinnedNames,
}: {
  title: string;
  count: number;
  entries: (ResolvedEntry | DeckCardEntry)[];
  showNeed?: boolean;
  onPick?: (e: ResolvedEntry | DeckCardEntry) => void;
  selectedName?: string | null;
  pinnedNames?: Set<string>;
}) {
  if (!entries.length) return null;
  return (
    <div className="dsection">
      <div className="dsection__head">
        <span className="dsection__title">{title}</span>
        <span className="dsection__count">{count}</span>
      </div>
      <div className="dgrid">
        {entries.map((e, i) => (
          <Thumb
            key={(e.id ?? e.name) + "-" + i}
            e={e}
            showNeed={showNeed}
            onClick={onPick}
            selected={!!selectedName && selectedName.toLowerCase() === e.name.toLowerCase()}
            marked={pinnedNames?.has(e.name.toLowerCase()) ? "pinned" : undefined}
          />
        ))}
      </div>
    </div>
  );
}

export function toCards(r: { main: ResolvedEntry[]; extra: ResolvedEntry[]; side: ResolvedEntry[] }): DeckCards {
  const strip = (a: ResolvedEntry[]): DeckCardEntry[] => a.map((e) => ({ id: e.id, name: e.name, copies: e.copies, frame: e.frame }));
  return { main: strip(r.main), extra: strip(r.extra), side: strip(r.side) };
}

export function safeCards(json: string): DeckCards {
  try {
    const c = JSON.parse(json) as Partial<DeckCards>;
    return { main: c.main ?? [], extra: c.extra ?? [], side: c.side ?? [] };
  } catch {
    return { main: [], extra: [], side: [] };
  }
}

export const barCls = (s: number) => (s >= 70 ? "hi" : s >= 45 ? "mid" : "lo");

export function Scorecard({ p, compact }: { p: DeckResult["pillars"]; compact?: boolean }) {
  const rows: [string, typeof p.consistency][] = [
    ["Consistency", p.consistency],
    ["Resilience", p.resilience],
    ["Disruption", p.disruption],
    ["Resources", p.resources],
    ["Format fitness", p.fitness],
  ];
  return (
    <div className={"scorecard" + (compact ? " scorecard--compact" : "")}>
      <div className="scorecard__overall">
        <span className={"grade grade--" + barCls(p.overall)}>{p.grade}</span>
        <div className="scorecard__o"><b>{p.overall}</b><span>overall</span></div>
      </div>
      <div className="pillars">
        {rows.map(([name, pl]) => (
          <div className="pillar" key={name} title={pl.detail}>
            <div className="pillar__head"><span>{name}</span><span className="pillar__score">{pl.score}</span></div>
            <div className="pillar__track"><span className={"pillar__fill pillar__fill--" + barCls(pl.score)} style={{ width: pl.score + "%" }} /></div>
            {!compact && <div className="pillar__detail">{pl.label} · {pl.detail}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
