"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RARITY, type Rarity, artUrl } from "@/lib/cards";
import { proposeTrade } from "@/lib/trades";

type Tile = { ownedId: string; cardId: number; name: string; rarity: string; setCode: string; condition: string; value: number };
type Party = { id: string; name: string; username: string };

function FairnessMeter({ offerVal, reqVal, themName }: { offerVal: number; reqVal: number; themName: string }) {
  const total = offerVal + reqVal;
  const leftPct = total > 0 ? (offerVal / total) * 100 : 50;
  const delta = offerVal - reqVal;
  const even = Math.abs(delta) < Math.max(2, total * 0.1);
  const label = Math.abs(delta) < 1 ? "Even trade" : delta > 0 ? `Favours ${themName} by $${delta.toFixed(2)}` : `Favours you by $${(-delta).toFixed(2)}`;
  return (
    <div className="fm">
      <div className="fm__head">
        <span>You ${offerVal.toFixed(2)}</span>
        <span className={"fm__verdict fm__verdict--" + (even ? "even" : "skew")}>{label}</span>
        <span>${reqVal.toFixed(2)} {themName}</span>
      </div>
      <div className="fm__bar"><div className="fm__fill" style={{ width: leftPct + "%" }} /></div>
    </div>
  );
}

export function TradeBuilder({ receiver, myCards, theirCards }: { receiver: Party; myCards: Tile[]; theirCards: Tile[] }) {
  const router = useRouter();
  const [offer, setOffer] = useState<Set<string>>(new Set());
  const [request, setRequest] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();

  const toggle = (set: Set<string>, setSet: (s: Set<string>) => void, id: string) => {
    const n = new Set(set);
    n.has(id) ? n.delete(id) : n.add(id);
    setSet(n);
  };
  const sumOf = (cards: Tile[], set: Set<string>) => cards.filter((c) => set.has(c.ownedId)).reduce((s, c) => s + c.value, 0);
  const offerVal = sumOf(myCards, offer);
  const reqVal = sumOf(theirCards, request);

  function send() {
    start(async () => {
      const r = await proposeTrade({ receiverId: receiver.id, offerOwnedIds: [...offer], requestOwnedIds: [...request] });
      if (r) { setErr(r); return; }
      router.push("/trades");
      router.refresh();
    });
  }

  const Column = ({ title, cards, set, setSet, val }: { title: string; cards: Tile[]; set: Set<string>; setSet: (s: Set<string>) => void; val: number }) => (
    <div className="tb__col">
      <div className="tb__colhead">{title}<span>${val.toFixed(2)}</span></div>
      {cards.length === 0 ? (
        <p className="muted tb__empty">No cards marked for trade.</p>
      ) : (
        <div className="tb__grid">
          {cards.map((c) => {
            const r = RARITY[c.rarity as Rarity];
            const on = set.has(c.ownedId);
            return (
              <button key={c.ownedId} className={"tb__tile" + (on ? " on" : "")} onClick={() => toggle(set, setSet, c.ownedId)} title={`${c.name} · ${c.condition} · $${c.value.toFixed(2)}`}>
                <img src={artUrl(c.cardId, true)} alt={c.name} loading="lazy" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                <span className="tb__tiletag" style={{ color: r?.color }}>{r?.abbr}</span>
                {on && <span className="tb__check">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <>
      <header className="topbar">
        <div>
          <span className="page-eyebrow">Trade</span>
          <h1 className="page-title">Trade with {receiver.name}</h1>
        </div>
      </header>
      <div className="content">
        <p className="muted">Pick cards from each side. Only cards marked <b>for trade</b> appear here.</p>
        <div className="tb">
          <Column title="You give" cards={myCards} set={offer} setSet={setOffer} val={offerVal} />
          <div className="tb__mid"><div className="tb__swap">⇄</div></div>
          <Column title={`${receiver.name} gives`} cards={theirCards} set={request} setSet={setRequest} val={reqVal} />
        </div>
        <div className="fairness">
          <FairnessMeter offerVal={offerVal} reqVal={reqVal} themName={receiver.name} />
          {err && <p className="addfriend__err">{err}</p>}
          <button className="btn-add fairness__send" disabled={pending || (offer.size === 0 && request.size === 0)} onClick={send}>
            {pending ? "Sending…" : "Send trade"}
          </button>
        </div>
      </div>
    </>
  );
}
