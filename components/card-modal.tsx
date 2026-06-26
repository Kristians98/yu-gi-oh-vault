"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { type Card, type Condition, RARITY, CONDITION_MULT, money, num } from "@/lib/cards";
import { RarityCard } from "./rarity-card";
import { removeOwnedCard, setForTrade, setQuantity } from "@/lib/actions";
import { getReactions, toggleReaction } from "@/lib/reactions";

const CONDITION_LABEL: Record<Condition, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

function fmtStat(v?: number | null): string {
  if (v === null) return "?";
  if (v === undefined) return "—";
  return num(v);
}

export function CardModal({ card, onClose, onChanged, readOnly }: { card: Card; onClose: () => void; onChanged?: () => void; readOnly?: boolean }) {
  const [pending, start] = useTransition();
  const [qty, setQty] = useState(card.quantity);
  const [trade, setTrade] = useState(card.forTrade);
  const [reactions, setReactions] = useState<{ counts: Record<string, number>; mine: string[] } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [canTilt, setCanTilt] = useState(false);
  const [tilting, setTilting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  useEffect(() => {
    if (card.ownedId) getReactions(card.ownedId).then(setReactions).catch(() => {});
  }, [card.ownedId]);

  // Gyroscope tilt: drive the same CSS vars the pointer tilt uses, from device motion.
  useEffect(() => {
    setCanTilt("DeviceOrientationEvent" in window && window.matchMedia("(pointer: coarse)").matches);
  }, []);

  useEffect(() => {
    if (!tilting || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let lpx = 0.5;
    let lpy = 0.5;
    let still: number | null = null;
    function onOrient(e: DeviceOrientationEvent) {
      const el = wrapRef.current?.querySelector(".card") as HTMLElement | null;
      if (!el) return;
      const gamma = Math.max(-30, Math.min(30, e.gamma ?? 0)); // left-right
      const beta = Math.max(-20, Math.min(20, (e.beta ?? 45) - 45)); // front-back, neutral ~45°
      const px = (gamma + 30) / 60;
      const py = (beta + 20) / 40;
      el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
      el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
      el.style.setProperty("--bx", `${(15 + px * 70).toFixed(1)}%`);
      el.style.setProperty("--by", `${(15 + py * 70).toFixed(1)}%`);
      el.style.setProperty("--rx", `${((px - 0.5) * 24).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${((0.5 - py) * 24).toFixed(2)}deg`);
      el.style.setProperty("--boost", "1.3");
      // Shimmer only while the device is actually being moved (ignore sensor jitter).
      if (Math.abs(px - lpx) + Math.abs(py - lpy) > 0.012) {
        el.classList.add("is-moving");
        if (still) window.clearTimeout(still);
        still = window.setTimeout(() => el.classList.remove("is-moving"), 160);
      }
      lpx = px;
      lpy = py;
    }
    window.addEventListener("deviceorientation", onOrient);
    return () => {
      window.removeEventListener("deviceorientation", onOrient);
      if (still) window.clearTimeout(still);
    };
  }, [tilting]);

  async function enableTilt() {
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    try {
      if (typeof DOE?.requestPermission === "function") {
        const res = await DOE.requestPermission(); // iOS gesture-gated permission
        if (res !== "granted") return;
      }
      setTilting(true);
    } catch {
      /* sensor unsupported */
    }
  }

  const r = RARITY[card.rarity];
  const isMonster = card.frame !== "spell" && card.frame !== "trap";
  const estValue = card.priceUsd * CONDITION_MULT[card.condition];
  const owned = !!card.ownedId;

  function run(fn: () => Promise<void>, close = false) {
    start(async () => {
      await fn();
      onChanged?.();
      if (close) onClose();
    });
  }

  function toggleTrade() {
    if (!card.ownedId) return;
    const next = !trade;
    setTrade(next);
    run(() => setForTrade(card.ownedId!, next));
  }
  function inc() {
    if (!card.ownedId) return;
    const next = qty + 1;
    setQty(next);
    run(() => setQuantity(card.ownedId!, next));
  }
  function dec() {
    if (!card.ownedId) return;
    const next = qty - 1;
    if (next <= 0) {
      run(() => setQuantity(card.ownedId!, 0), true);
    } else {
      setQty(next);
      run(() => setQuantity(card.ownedId!, next));
    }
  }

  const EMOJIS = ["🔥", "😮", "💎", "❤️", "👑"];
  function react(emoji: string) {
    if (!card.ownedId) return;
    start(async () => {
      await toggleReaction(card.ownedId!, emoji);
      setReactions(await getReactions(card.ownedId!));
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={card.name}>
      <button className="modal__close" onClick={onClose} aria-label="Close card">✕</button>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__cardwrap" ref={wrapRef}>
          <RarityCard card={card} showMeta={false} full />
          {canTilt && (
            <button className="modal__tilt" onClick={enableTilt} disabled={tilting}>
              {tilting ? "✦ Tilt on — move your phone" : "✦ Tap to tilt"}
            </button>
          )}
        </div>

        <div className="modal__panel">
          <div className="modal__rarity" style={{ color: r.color }}>
            <span className="dot" style={{ background: r.color }} />
            {r.label}
          </div>
          <h2 className="modal__name">{card.name}</h2>
          <div className="modal__type">
            {card.attribute ? `${card.attribute} · ` : ""}
            {card.typeLine}
            {card.level ? ` · Level ${card.level}` : ""}
          </div>

          {(card.archetype || card.handTrap || card.banTcg || card.banGoat || card.banEdison) && (
            <div className="ctags">
              {card.archetype && <span className="ctag">{card.archetype}</span>}
              {card.handTrap && <span className="ctag ctag--ht">Hand Trap</span>}
              {card.banTcg && <span className="ctag ctag--ban">TCG · {card.banTcg}</span>}
              {card.banGoat && <span className="ctag ctag--goat">Goat · {card.banGoat}</span>}
              {card.banEdison && <span className="ctag ctag--ban">Edison · {card.banEdison}</span>}
            </div>
          )}

          {card.ownedId && (
            <div className="reacts">
              {EMOJIS.map((e) => {
                const n = reactions?.counts[e] ?? 0;
                const on = reactions?.mine.includes(e) ?? false;
                return (
                  <button key={e} className={"react" + (on ? " on" : "")} onClick={() => react(e)} disabled={pending} aria-pressed={on}>
                    <span>{e}</span>
                    {n > 0 && <span className="react__n">{n}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {isMonster && (
            <div className="battle">
              <div className="battle__cell">
                <div className="battle__k">ATK</div>
                <div className="battle__v">{fmtStat(card.atk)}</div>
              </div>
              <div className="battle__cell">
                <div className="battle__k">DEF</div>
                <div className="battle__v">{fmtStat(card.def)}</div>
              </div>
            </div>
          )}

          <div className="kv">
            <span className="kv__k">Set</span>
            <span className="kv__v">{card.setName}</span>
            <span className="kv__k">Set code</span>
            <span className="kv__v"><span className="mono">{card.setCode}</span></span>
            <span className="kv__k">Condition</span>
            <span className="kv__v">
              {CONDITION_LABEL[card.condition]} <span className="mono" style={{ color: "var(--muted-2)" }}>({card.condition})</span>
            </span>
            <span className="kv__k">Market</span>
            <span className="kv__v"><span className="mono">{money(card.priceUsd)}</span></span>
            <span className="kv__k">Est. value</span>
            <span className="kv__v"><span className="mono" style={{ color: "var(--gold-bright)" }}>${estValue.toFixed(2)}</span></span>
          </div>

          {card.desc && <p className="card-desc">{card.desc}</p>}

          {owned && !readOnly && (
            <div className="owned-actions">
              <button className={"oa-trade" + (trade ? " on" : "")} onClick={toggleTrade} disabled={pending}>
                {trade ? "● Listed for trade" : "List for trade"}
              </button>
              <div className="oa-qty">
                <button onClick={dec} disabled={pending} aria-label="Decrease quantity">−</button>
                <span>{qty}</span>
                <button onClick={inc} disabled={pending} aria-label="Increase quantity">+</button>
              </div>
              <button className="oa-remove" onClick={() => run(() => removeOwnedCard(card.ownedId!), true)} disabled={pending}>
                Remove
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
