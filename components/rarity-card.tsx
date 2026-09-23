"use client";

import { useCallback, useRef, type CSSProperties, type PointerEvent } from "react";
import { type Card, RARITY, FRAME_COLOR, artUrl } from "@/lib/cards";

const MAX_TILT = 15;
const GLINTS = [1, 2, 3, 4, 5, 6] as const;

export function RarityCard({
  card,
  onOpen,
  showMeta = true,
  wanted = false,
  full = false,
}: {
  card: Card;
  onOpen?: (card: Card) => void;
  showMeta?: boolean;
  wanted?: boolean;
  full?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const moveTimer = useRef<number | null>(null);
  const r = RARITY[card.rarity];
  // Grid tiles use the small art (≈6× fewer decoded pixels → far less RAM); the
  // enlarged modal passes `full` for crisp detail.
  const thumb = !full;
  // Starlight, Quarter Century Secret and Secret get a set of independent "glitter flake" layers — see .card__glint in
  // globals.css. Each layer is a sparse grid of flakes lit by its own light spot, so which
  // flakes flash changes with the tilt instead of every star under the cursor lighting up.
  const glitterField = card.rarity === "STARLIGHT_RARE" || card.rarity === "QUARTER_CENTURY_SECRET_RARE" || card.rarity === "SECRET_RARE";

  const set = (k: string, v: string) => ref.current?.style.setProperty(k, v);

  const onMove = useCallback((e: PointerEvent<HTMLButtonElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width; // 0..1
    const py = (e.clientY - rect.top) / rect.height;
    set("--mx", `${(px * 100).toFixed(1)}%`);
    set("--my", `${(py * 100).toFixed(1)}%`);
    set("--bx", `${(15 + px * 70).toFixed(1)}%`);
    set("--by", `${(15 + py * 70).toFixed(1)}%`);
    set("--rx", `${((px - 0.5) * MAX_TILT).toFixed(2)}deg`); // rotateY
    set("--ry", `${((0.5 - py) * MAX_TILT).toFixed(2)}deg`); // rotateX
    // Movement-gated shimmer: flag the card as moving, clear it shortly after motion stops.
    el.classList.add("is-moving");
    if (moveTimer.current) window.clearTimeout(moveTimer.current);
    moveTimer.current = window.setTimeout(() => ref.current?.classList.remove("is-moving"), 130);
  }, []);

  const onLeave = useCallback(() => {
    for (const [k, v] of [["--rx", "0deg"], ["--ry", "0deg"], ["--mx", "50%"], ["--my", "50%"], ["--bx", "50%"], ["--by", "50%"]]) {
      set(k, v);
    }
    if (moveTimer.current) window.clearTimeout(moveTimer.current);
    ref.current?.classList.remove("is-moving");
  }, []);

  return (
    <button
      ref={ref}
      className={"card" + (wanted ? " card--wanted" : "")}
      data-tier={r.tier}
      data-rarity={card.rarity}
      style={{ "--frame": FRAME_COLOR[card.frame], "--art": `url("${artUrl(card.id, thumb)}")` } as CSSProperties}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      onClick={() => onOpen?.(card)}
      aria-label={`${card.name} — ${r.label}`}
    >
      <div className="card__fallback">{card.name}</div>
      <img
        className="card__art"
        src={artUrl(card.id, thumb)}
        alt={card.name}
        // LazyCard already gates mounting to ~1.2 screens around the visible area; native
        // lazy loading on top of that would delay the fetch until the card is nearly on
        // screen and cause pop-in, so fetch as soon as the card mounts.
        loading="eager"
        decoding="async"
        draggable={false}
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
      <div className="card__layer card__holo" />
      <div className="card__layer card__glitter" />
      <div className="card__layer card__glare" />
      {glitterField && GLINTS.map((g) => <div key={g} className="card__layer card__glint" data-g={g} />)}
      <div className="card__layer card__frame" />

      {card.quantity > 1 && <span className="card__tag card__tag--qty">×{card.quantity}</span>}
      {card.forTrade && <span className="card__tag card__tag--trade">TRADE</span>}

      {showMeta && (
        <div className="card__meta">
          <span className="card__rarity" style={{ color: r.color }}>
            <span className="dot" style={{ background: r.color }} />
            {r.abbr}
          </span>
          <span className="card__set">{card.setCode}</span>
        </div>
      )}
    </button>
  );
}
