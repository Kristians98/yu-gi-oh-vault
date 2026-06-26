"use client";

import { useState } from "react";
import { type Card } from "@/lib/cards";
import { RarityCard } from "./rarity-card";
import { CardModal } from "./card-modal";

export function FriendBinder({ ownerName, username, cards, wantedIds = [] }: { ownerName: string; username: string; cards: Card[]; wantedIds?: number[] }) {
  const [sel, setSel] = useState<Card | null>(null);
  const wanted = new Set(wantedIds);
  const forTrade = cards.filter((c) => c.forTrade).length;
  const wantCount = cards.filter((c) => wanted.has(c.id)).length;

  return (
    <>
      <header className="topbar">
        <div>
          <span className="page-eyebrow">Friend</span>
          <h1 className="page-title">{ownerName}&rsquo;s binder</h1>
        </div>
        <div className="topbar__spacer" />
        <a className="btn-add" href={`/trades/new?to=${username}`}>Propose trade</a>
      </header>
      <div className="content">
        <div className="friendmeta">
          {cards.length} cards · <b>{forTrade}</b> available to trade
          {wantCount > 0 && <> · <span style={{ color: "var(--gold-bright)" }}>{wantCount} on your wishlist (outlined in gold)</span></>}
        </div>
        {cards.length ? (
          <div className="grid">
            {cards.map((c, i) => (
              <div className="card-wrap grid-enter" style={{ animationDelay: `${Math.min(i * 0.03, 0.4)}s` }} key={c.ownedId ?? c.id}>
                <RarityCard card={c} onOpen={setSel} wanted={wanted.has(c.id)} />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid__empty">{ownerName} hasn&rsquo;t added any cards yet.</div>
        )}
      </div>
      {sel && <CardModal card={sel} onClose={() => setSel(null)} readOnly />}
    </>
  );
}
