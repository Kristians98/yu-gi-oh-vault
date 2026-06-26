"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RARITY, type Rarity, type Condition, artUrl } from "@/lib/cards";
import { addSet, addToCollection, searchCards, searchSets } from "@/lib/actions";

type SearchCard = Awaited<ReturnType<typeof searchCards>>[number];
type Printing = SearchCard["printings"][number];
type SetResult = Awaited<ReturnType<typeof searchSets>>[number];

const CONDITIONS: Condition[] = ["NM", "LP", "MP", "HP", "DMG"];

export function AddCardDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"card" | "product">("card");

  // card mode
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchCard[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<SearchCard | null>(null);
  const [printingId, setPrintingId] = useState<string>("");
  const [condition, setCondition] = useState<Condition>("NM");
  const [qty, setQty] = useState(1);
  const [forTrade, setForTrade] = useState(false);

  // product mode
  const [setQuery, setSetQuery] = useState("");
  const [sets, setSets] = useState<SetResult[]>([]);
  const [searchingSets, setSearchingSets] = useState(false);
  const [addedMsg, setAddedMsg] = useState<string>();

  const [saving, startSaving] = useTransition();
  const cardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (cardTimer.current) clearTimeout(cardTimer.current);
    if (q.trim().length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    cardTimer.current = setTimeout(async () => {
      setResults(await searchCards(q));
      setSearching(false);
    }, 300);
    return () => { if (cardTimer.current) clearTimeout(cardTimer.current); };
  }, [q]);

  useEffect(() => {
    if (setTimer.current) clearTimeout(setTimer.current);
    if (setQuery.trim().length < 2) { setSets([]); setSearchingSets(false); return; }
    setSearchingSets(true);
    setTimer.current = setTimeout(async () => {
      setSets(await searchSets(setQuery));
      setSearchingSets(false);
    }, 300);
    return () => { if (setTimer.current) clearTimeout(setTimer.current); };
  }, [setQuery]);

  function choose(card: SearchCard) {
    setPicked(card);
    setPrintingId(card.printings[0]?.id ?? "");
  }

  function submit() {
    if (!printingId) return;
    startSaving(async () => {
      await addToCollection({ printingId, condition, quantity: qty, forTrade });
      router.refresh();
      onClose();
    });
  }

  function addProduct(s: SetResult) {
    startSaving(async () => {
      const r = await addSet(s.setName);
      router.refresh();
      setAddedMsg(`✓ Added ${r.added} cards from ${s.setName}`);
    });
  }

  const printing: Printing | undefined = picked?.printings.find((p) => p.id === printingId);

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Add to binder">
      <div className="add" onClick={(e) => e.stopPropagation()}>
        <div className="add__head">
          <div className="add__tabs">
            <button className={"add__tab" + (mode === "card" ? " on" : "")} onClick={() => setMode("card")}>Card</button>
            <button className={"add__tab" + (mode === "product" ? " on" : "")} onClick={() => setMode("product")}>Product</button>
          </div>
          <button className="add__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {mode === "card" && !picked && (
          <>
            <input
              className="add__search"
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search the Yu-Gi-Oh! database — e.g. Blue-Eyes, Dark Magician…"
            />
            <div className="add__results">
              {searching && <p className="add__hint">Searching…</p>}
              {!searching && q.trim().length >= 2 && results.length === 0 && <p className="add__hint">No cards found.</p>}
              {!searching && q.trim().length < 2 && <p className="add__hint">Type at least 2 letters to search.</p>}
              {results.map((c) => (
                <button key={c.id} className="add__result" onClick={() => choose(c)} disabled={c.printings.length === 0}>
                  <img src={artUrl(c.id, true)} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                  <span className="add__result-name">{c.name}</span>
                  <span className="add__result-meta">{c.printings.length} printings</span>
                </button>
              ))}
            </div>
          </>
        )}

        {mode === "card" && picked && (
          <div className="add__detail">
            <img className="add__detail-art" src={artUrl(picked.id)} alt={picked.name} onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
            <div className="add__form">
              <button className="add__back" onClick={() => setPicked(null)}>← Back to search</button>
              <h3 className="add__detail-name">{picked.name}</h3>
              <label className="add__label">Set / rarity</label>
              <select className="add__input" value={printingId} onChange={(e) => setPrintingId(e.target.value)}>
                {picked.printings.length === 0 && <option value="">No printings on record</option>}
                {picked.printings.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.setCode} · {RARITY[p.rarity as Rarity]?.label ?? p.rarity}{p.priceUsd ? ` · $${p.priceUsd}` : ""}
                  </option>
                ))}
              </select>
              <div className="add__row">
                <div>
                  <label className="add__label">Condition</label>
                  <select className="add__input" value={condition} onChange={(e) => setCondition(e.target.value as Condition)}>
                    {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="add__label">Quantity</label>
                  <input className="add__input" type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
                </div>
              </div>
              <label className="add__check">
                <input type="checkbox" checked={forTrade} onChange={(e) => setForTrade(e.target.checked)} /> Mark as available to trade
              </label>
              <button className="add__submit" onClick={submit} disabled={saving || !printingId}>{saving ? "Adding…" : "Add to binder"}</button>
            </div>
          </div>
        )}

        {mode === "product" && (
          <>
            <input
              className="add__search"
              autoFocus
              value={setQuery}
              onChange={(e) => { setSetQuery(e.target.value); setAddedMsg(undefined); }}
              placeholder="Search a product — e.g. Structure Deck, Legendary, Speed Duel…"
            />
            <p className="add__producthint">Adds one of every card in the product (Near Mint). Add again to stack extra copies.</p>
            <div className="add__results">
              {searchingSets && <p className="add__hint">Searching…</p>}
              {!searchingSets && setQuery.trim().length >= 2 && sets.length === 0 && <p className="add__hint">No products found.</p>}
              {!searchingSets && setQuery.trim().length < 2 && <p className="add__hint">Type at least 2 letters to search.</p>}
              {addedMsg && <p className="add__added">{addedMsg}</p>}
              {sets.map((s) => (
                <div key={s.setName} className="add__setrow">
                  <span className="add__setname">{s.setName}</span>
                  <span className="add__setcount">{s.count} cards</span>
                  <button className="btn-mini btn-accept" onClick={() => addProduct(s)} disabled={saving}>Add all</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
