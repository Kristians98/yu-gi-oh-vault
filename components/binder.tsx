"use client";

import { useMemo, useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { type Card, type Rarity, RARITY } from "@/lib/cards";
import { importCollection } from "@/lib/actions";
import { LazyCard } from "./lazy-card";
import { CardModal } from "./card-modal";
import { InsightsStrip } from "./insights-strip";
import { FilterBar } from "./filter-bar";
import { AddCardDialog } from "./add-card-dialog";

const SearchIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
  </svg>
);
const UploadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21V9m0 0 4 4m-4-4-4 4M5 3h14" />
  </svg>
);

// CSV export of the collection (opens cleanly in Excel/Sheets).
const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
function buildCollectionCsv(cards: Card[]): string {
  const head = ["Name", "Qty", "Set", "Set Code", "Rarity", "Condition", "For Trade", "Type"];
  const rows = cards.map((c) => [
    c.name, String(c.quantity), c.setName, c.setCode, RARITY[c.rarity].label, c.condition,
    c.forTrade ? "yes" : "no", c.typeLine,
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export function Binder({ initialCards }: { initialCards: Card[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rarity, setRarity] = useState<Rarity | "ALL">("ALL");
  const [tradeOnly, setTradeOnly] = useState(false);
  const [format, setFormat] = useState("ALL");
  const [archetypeFilter, setArchetypeFilter] = useState("ALL");
  const [handTrapOnly, setHandTrapOnly] = useState(false);
  const [selected, setSelected] = useState<Card | null>(null);
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, startImport] = useTransition();
  const [importMsg, setImportMsg] = useState("");

  const rarities = useMemo(
    () => Array.from(new Set(initialCards.map((c) => c.rarity))).sort((a, b) => RARITY[b].tier - RARITY[a].tier),
    [initialCards],
  );
  const archetypes = useMemo(
    () => Array.from(new Set(initialCards.map((c) => c.archetype).filter(Boolean) as string[])).sort(),
    [initialCards],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return initialCards.filter((c) => {
      if (rarity !== "ALL" && c.rarity !== rarity) return false;
      if (tradeOnly && !c.forTrade) return false;
      if (handTrapOnly && !c.handTrap) return false;
      if (archetypeFilter !== "ALL" && c.archetype !== archetypeFilter) return false;
      if (format === "advanced" && c.banTcg === "Forbidden") return false;
      // Goat / Edison are retro formats → restrict to the era's card pool (by TCG
      // release date) AND drop cards Forbidden in that format.
      if (format === "goat" && (c.banGoat === "Forbidden" || !c.tcgDate || c.tcgDate > "2005-09-01")) return false;
      if (format === "edison" && (c.banEdison === "Forbidden" || !c.tcgDate || c.tcgDate > "2010-04-01")) return false;
      if (needle && !c.name.toLowerCase().includes(needle) && !c.setCode.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [initialCards, q, rarity, tradeOnly, handTrapOnly, archetypeFilter, format]);

  function exportCsv() {
    const blob = new Blob(["﻿" + buildCollectionCsv(initialCards)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vault-collection.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function onImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setImportMsg("");
    startImport(async () => {
      const res = await importCollection(await file.text());
      const parts = [`${res.imported} new`];
      if (res.updated) parts.push(`${res.updated} already in binder (quantities set)`);
      if (res.merged) parts.push(`${res.merged} repeated rows merged`);
      if (res.skipped) parts.push(`${res.skipped} not matched`);
      setImportMsg(`Imported ${res.rows} rows → ${parts.join(" · ")}${res.errors[0] ? `. ${res.errors[0]}` : ""}`);
      router.refresh();
    });
  }

  return (
    <>
      <header className="topbar">
        <div>
          <span className="page-eyebrow">Collection</span>
          <h1 className="page-title">My Binder</h1>
        </div>
        <div className="topbar__spacer" />
        <label className="search">
          <SearchIcon />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your binder…" aria-label="Search your binder" />
        </label>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onImportFile} />
        <button className="btn-ghost" onClick={() => fileRef.current?.click()} disabled={importing} title="Import a collection CSV">
          <UploadIcon /> <span className="btn-ghost__label">{importing ? "Importing…" : "Import"}</span>
        </button>
        <button className="btn-ghost" onClick={exportCsv} disabled={!initialCards.length} title="Download your collection as CSV">
          <DownloadIcon /> <span className="btn-ghost__label">Export</span>
        </button>
        <button className="btn-add" onClick={() => setAdding(true)}>
          <PlusIcon /> Add card
        </button>
      </header>

      <div className="content">
        {importMsg && <div className="import-note">{importMsg}</div>}
        {initialCards.length > 0 && (
          <>
            <div className="insights-wrap">
              <InsightsStrip cards={initialCards} />
            </div>
            <FilterBar
              rarities={rarities}
              active={rarity}
              onRarity={setRarity}
              archetypes={archetypes}
              archetype={archetypeFilter}
              onArchetype={setArchetypeFilter}
              format={format}
              onFormat={setFormat}
              forTradeOnly={tradeOnly}
              onToggleTrade={() => setTradeOnly((v) => !v)}
              handTrapOnly={handTrapOnly}
              onToggleHandTrap={() => setHandTrapOnly((v) => !v)}
              count={filtered.length}
            />
          </>
        )}

        {initialCards.length === 0 ? (
          <div className="grid__empty">
            Your binder is empty — tap <b>Add card</b> to search the database and start collecting.
          </div>
        ) : filtered.length ? (
          <div className="grid">
            {filtered.map((c, i) => (
              <LazyCard key={c.ownedId ?? c.id} card={c} onOpen={setSelected} eager={i < 18} />
            ))}
          </div>
        ) : (
          <div className="grid__empty">No cards match — try clearing filters.</div>
        )}
      </div>

      {selected && <CardModal card={selected} onClose={() => setSelected(null)} onChanged={() => router.refresh()} />}
      {adding && <AddCardDialog onClose={() => setAdding(false)} />}
    </>
  );
}
