"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateDeck, refineDeck, saveDeck, deleteDeck } from "@/lib/decks";
import type { DeckResult, DeckFormat, PoolMode } from "@/lib/deck-engine";
import { Scorecard, Section, safeCards, toCards } from "@/components/deck-view";

type Saved = { id: string; name: string; format: string; strategy: string; poolMode: string; cards: string };

const FORMATS: { v: DeckFormat; label: string }[] = [
  { v: "advanced", label: "Advanced" },
  { v: "goat", label: "Goat" },
  { v: "edison", label: "Edison" },
];

const fmtLabel = (f: string) => FORMATS.find((x) => x.v === f)?.label ?? f;

export function DeckBuilder({ aiOn, savedDecks }: { aiOn: boolean; savedDecks: Saved[] }) {
  const router = useRouter();
  const [format, setFormat] = useState<DeckFormat>("advanced");
  const [poolMode, setPoolMode] = useState<PoolMode>("collection");
  const [strategy, setStrategy] = useState("");
  const [result, setResult] = useState<DeckResult | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState("");
  const [pending, start] = useTransition();
  const [saving, startSave] = useTransition();
  const [chat, setChat] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [refining, startRefine] = useTransition();

  function build() {
    setSavedNote("");
    setOpenId(null);
    setChat([]);
    setChatInput("");
    start(async () => {
      const r = await generateDeck({ format, strategy, poolMode });
      setResult(r);
    });
  }

  function refine() {
    const msg = chatInput.trim();
    if (!msg || !result?.ok || refining) return;
    setChatInput("");
    const history = chat.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
    setChat((c) => [...c, { role: "user", text: msg }]);
    startRefine(async () => {
      const r = await refineDeck({
        format,
        poolMode,
        current: toCards(result),
        currentName: result.deckName,
        currentStrategy: result.strategy,
        history,
        message: msg,
      });
      setChat((c) => [...c, { role: "ai", text: r.reply }]);
      if (r.result) setResult(r.result);
    });
  }

  function save() {
    if (!result?.ok) return;
    startSave(async () => {
      await saveDeck({ name: result.deckName, format, strategy, poolMode, cards: toCards(result) });
      setSavedNote("Saved to your decks.");
      router.refresh();
    });
  }

  function remove(id: string) {
    startSave(async () => {
      await deleteDeck(id);
      if (openId === id) setOpenId(null);
      router.refresh();
    });
  }

  return (
    <>
      <header className="topbar">
        <div>
          <span className="page-eyebrow">Lab</span>
          <h1 className="page-title">Deck Builder</h1>
        </div>
      </header>

      <div className="content deck-wrap">
        <section className="deck-form">
          <p className="deck-form__lead">
            Pick a format and a vibe — the AI filters to the legal card pool, then assembles a coherent deck (respecting banlist copy limits).
          </p>

          <div className="deck-controls">
            <label className="deck-field">
              <span>Format</span>
              <select className="fsel" value={format} onChange={(e) => setFormat(e.target.value as DeckFormat)}>
                {FORMATS.map((f) => (
                  <option key={f.v} value={f.v}>{f.label}</option>
                ))}
              </select>
            </label>

            <div className="deck-field">
              <span>Card pool</span>
              <div className="seg">
                <button className={"seg__b" + (poolMode === "collection" ? " on" : "")} onClick={() => setPoolMode("collection")} type="button" title="Only cards you own">
                  My cards
                </button>
                <button className={"seg__b" + (poolMode === "any" ? " on" : "")} onClick={() => setPoolMode("any")} type="button" title="Any card legal in the format">
                  Any card
                </button>
              </div>
            </div>

            <label className="deck-field deck-field--grow">
              <span>Strategy / theme (optional)</span>
              <input
                className="deck-input"
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                placeholder="e.g. Blue-Eyes beatdown, burn, mill, Six Samurai…"
                onKeyDown={(e) => e.key === "Enter" && aiOn && !pending && build()}
              />
            </label>

            <button className="btn-add deck-build" onClick={build} disabled={!aiOn || pending}>
              {pending ? "Building…" : "✦ Build deck"}
            </button>
          </div>

          {!aiOn && (
            <p className="deck-note deck-note--warn">
              AI isn’t configured. Set <code>AZURE_AI_ENDPOINT</code>, <code>AZURE_AI_KEY</code> and a deployment
              (<code>AZURE_AI_DECK_DEPLOYMENT</code> or <code>AZURE_AI_DEPLOYMENT</code>) in <code>.env</code>.
            </p>
          )}
          <p className="deck-note">
            Pool: <b>{poolMode === "collection" ? "your legal collection" : "any card legal in the format"}</b>
            {poolMode === "any" && " — cards you don’t own are tagged “need”."}
          </p>
        </section>

        {pending && <div className="deck-building">Filtering the {fmtLabel(format)} pool and building your deck…</div>}

        {result && !pending && (
          <section className="deck-result">
            {result.ok ? (
              <>
                <div className="deck-result__head">
                  <div>
                    <span className="page-eyebrow">{fmtLabel(result.format)} · {result.poolMode === "collection" ? "from collection" : "any legal"}</span>
                    <h2 className="deck-name">{result.deckName}</h2>
                  </div>
                  <div className="deck-result__actions">
                    <span className="deck-counts">Main {result.counts.main} · Extra {result.counts.extra}{result.counts.side ? ` · Side ${result.counts.side}` : ""}</span>
                    <button className="btn-add" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save deck"}</button>
                  </div>
                </div>
                <Scorecard p={result.pillars} />
                {result.strategy && <p className="deck-strategy">{result.strategy}</p>}
                {savedNote && <p className="deck-note deck-note--ok">{savedNote}</p>}
                {result.warnings.length > 0 && (
                  <ul className="deck-warns">
                    {result.warnings.slice(0, 8).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
                <Section title="Main Deck" count={result.counts.main} entries={result.main} showNeed={result.poolMode === "any"} />
                <Section title="Extra Deck" count={result.counts.extra} entries={result.extra} showNeed={result.poolMode === "any"} />
                <Section title="Side Deck" count={result.counts.side} entries={result.side} showNeed={result.poolMode === "any"} />

                <div className="deckchat">
                  <div className="deckchat__head">Talk to this deck</div>
                  {chat.length > 0 && (
                    <div className="deckchat__log">
                      {chat.map((m, i) => (
                        <div key={i} className={"dmsg dmsg--" + m.role}>{m.text}</div>
                      ))}
                      {refining && <div className="dmsg dmsg--ai dmsg--typing">…</div>}
                    </div>
                  )}
                  <div className="deckchat__form">
                    <input
                      className="deck-input"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && refine()}
                      placeholder="Ask about it or request a change — “add more hand traps”, “cut the bricks”, “why this card?”"
                      disabled={refining}
                    />
                    <button className="btn-add" onClick={refine} disabled={refining || !chatInput.trim()}>{refining ? "…" : "Send"}</button>
                  </div>
                </div>
              </>
            ) : (
              <p className="deck-note deck-note--warn">{result.error}</p>
            )}
          </section>
        )}

        <section className="deck-saved">
          <div className="dsection__head">
            <span className="dsection__title">Saved decks</span>
            <span className="dsection__count">{savedDecks.length}</span>
          </div>
          {savedDecks.length === 0 ? (
            <p className="deck-note">No saved decks yet — build one above and hit Save.</p>
          ) : (
            <div className="deck-list">
              {savedDecks.map((d) => {
                const cards = safeCards(d.cards);
                const main = cards.main.reduce((s, e) => s + e.copies, 0);
                const extra = cards.extra.reduce((s, e) => s + e.copies, 0);
                const open = openId === d.id;
                return (
                  <div key={d.id} className={"deck-card" + (open ? " deck-card--open" : "")}>
                    <button className="deck-card__head" onClick={() => setOpenId(open ? null : d.id)}>
                      <div>
                        <span className="deck-tag">{fmtLabel(d.format)}</span>
                        <span className="deck-card__name">{d.name}</span>
                      </div>
                      <span className="deck-counts">Main {main} · Extra {extra}</span>
                    </button>
                    {open && (
                      <div className="deck-card__body">
                        {d.strategy && <p className="deck-strategy">{d.strategy}</p>}
                        <Section title="Main Deck" count={main} entries={cards.main} />
                        <Section title="Extra Deck" count={extra} entries={cards.extra} />
                        <Section title="Side Deck" count={cards.side.reduce((s, e) => s + e.copies, 0)} entries={cards.side} />
                        <button className="deck-del" onClick={() => remove(d.id)} disabled={saving}>Delete deck</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
