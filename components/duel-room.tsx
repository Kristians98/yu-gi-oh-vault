"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { artUrl } from "@/lib/cards";
import { Scorecard, Section } from "@/components/deck-view";
import {
  acceptDuel, cancelDuel, declineDuel, forceRerollTheirs, generateMyDeck, killMyCard, lockMyDeck, pinMyCard, plantCard,
  recordResult, rematchDuel, rerollMyDeck, saveDuelDeck, searchDuelPool, snipeCard,
} from "@/lib/duels";
import { BUDGET_LABEL, FORMAT_LABEL, MODES, MUTATORS, type Budget, type BudgetKey, type DuelDeck } from "@/lib/duel-rules";
import type { DeckCardEntry, ResolvedEntry } from "@/lib/deck-engine";
import type { ActionView, DuelView, SideView } from "@/lib/duel-view";

type Res = { ok: true } | { ok: false; error: string };
type Pick = { kind: "kill" | "snipe"; name: string } | null;
type Picker = { whose: "mine" | "theirs" } | null;
type PoolHit = { id: number; name: string; frame: string; typeLine: string; qty: number };

const STATUS_LABEL: Record<string, string> = { PENDING: "Challenge", BUILDING: "Building", REVEALED: "Revealed", DONE: "Finished", DECLINED: "Declined", CANCELLED: "Called off" };

function ago(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function Budgets({ b, keys, foe }: { b: Budget; keys: BudgetKey[]; foe?: boolean }) {
  return (
    <div className="budgets">
      {keys.map((k) => (
        <span key={k} className={"bud" + (b[k] <= 0 ? " bud--zero" : "") + (foe ? " bud--foe" : "")} title={BUDGET_LABEL[k].blurb}>
          {BUDGET_LABEL[k].label} <b>{b[k]}</b>
        </span>
      ))}
    </div>
  );
}

function HiddenDeck({ name }: { name: string }) {
  return (
    <div className="duel-hidden" aria-label={`${name}'s deck is hidden`}>
      <div className="duel-hidden__grid">
        {Array.from({ length: 16 }).map((_, i) => <div key={i} className="cardback" />)}
      </div>
      <div className="duel-hidden__label">Hidden until you both lock in</div>
    </div>
  );
}

function logLine(a: ActionView, meName: string, themName: string): string {
  const target = a.targetIsMe ? (a.actorIsMe ? "their own" : "your") : a.actorIsMe ? `${themName}'s` : "their";
  const card = a.cardName ? `“${a.cardName}”` : "a card";
  switch (a.type) {
    case "GENERATE": return `drew a deck${a.detail ? ` — ${a.detail}` : ""}`;
    case "REROLL": return `rerolled ${a.actorIsMe ? "your" : "their"} deck${a.detail ? ` — ${a.detail}` : ""}`;
    case "KILL": return `killed ${card} from ${a.actorIsMe ? "your" : "their"} deck`;
    case "PIN": return `pinned ${card} into ${a.actorIsMe ? "your" : "their"} deck`;
    case "SNIPE": return `sniped ${card} out of ${target} deck`;
    case "PLANT": return `planted ${card} into ${target} deck`;
    case "FORCE": return `force-rerolled ${target} deck`;
    case "LOCK": return "locked in";
    default: return a.type.toLowerCase();
  }
}

export function DuelRoom({ view: v, aiOn }: { view: DuelView; aiOn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PoolHit[]>([]);
  const [note, setNote] = useState(v.resultNote ?? "");
  const [editResult, setEditResult] = useState(false);
  const [saved, setSaved] = useState(false);
  const [, start] = useTransition();

  const live = v.status === "PENDING" || v.status === "BUILDING";
  // Keep the room fresh while the other player is acting (the app-wide 30s tick is slow for turns).
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => { if (document.visibilityState === "visible" && !busy) router.refresh(); }, 8000);
    return () => clearInterval(t);
  }, [live, busy, router]);

  // Card picker search (pin / plant).
  useEffect(() => {
    if (!picker) return;
    const whose = picker.whose;
    const t = setTimeout(() => { searchDuelPool(v.id, whose, q).then(setHits).catch(() => setHits([])); }, 220);
    return () => clearTimeout(t);
  }, [picker, q, v.id]);

  function act(label: string, fn: () => Promise<Res | { id?: string; error?: string }>, after?: (r: unknown) => void) {
    setErr(null);
    setBusy(label);
    start(async () => {
      try {
        const r = await fn();
        if ("ok" in r && !r.ok) setErr(r.error);
        else if ("error" in r && r.error) setErr(r.error);
        else after?.(r);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        setPick(null);
        setPicker(null);
        setQ("");
        setBusy(null);
        router.refresh();
      }
    });
  }

  const sab = v.mode === "sabotage";
  const building = v.status === "BUILDING";
  const turnOk = !sab || (v.bothDecks && v.isMyTurn);
  const canOwnAct = building && v.me.hasDeck && !v.me.locked && turnOk && !busy;
  const canInterfere = sab && building && v.bothDecks && v.isMyTurn && !v.them.locked && !v.me.locked && !busy;
  const ownKeys: BudgetKey[] = ["reroll", "kill", "pin"];
  const foeKeys: BudgetKey[] = v.options.forceReroll ? ["snipe", "plant", "force"] : ["snipe", "plant"];
  const pinnedOf = (d: DuelDeck | null) => new Set((d?.pinned ?? []).map((p) => p.toLowerCase()));

  const onPickMine = canOwnAct && v.me.budget.kill > 0 ? (e: ResolvedEntry | DeckCardEntry) => setPick({ kind: "kill", name: e.name }) : undefined;
  const onPickTheirs = canInterfere && v.me.budget.snipe > 0 ? (e: ResolvedEntry | DeckCardEntry) => setPick({ kind: "snipe", name: e.name }) : undefined;

  const banner = (() => {
    if (v.status === "PENDING") return v.iAmChallenger ? `Waiting for ${v.them.name} to accept.` : `${v.them.name} challenged you. Accept to start building.`;
    if (v.status === "BUILDING") {
      if (!v.me.hasDeck) return "Draw your deck — the AI builds it from your binder only.";
      if (sab) {
        if (!v.them.hasDeck) return `Waiting for ${v.them.name} to draw. Then ${v.iAmChallenger ? "they move" : "you move"} first.`;
        if (v.me.locked) return `You're locked. ${v.them.name} is finishing up.`;
        return v.isMyTurn ? `Your move — round ${v.round}. Act on either deck, or lock in.` : `${v.them.name}'s move — round ${v.round}.`;
      }
      if (v.me.locked) return `Locked in. Waiting for ${v.them.name}…`;
      return `Tweak your deck, then lock in. ${v.them.name} can't see it yet.`;
    }
    if (v.status === "REVEALED") return "Decks revealed. Pull the real cards, duel, then record who won.";
    if (v.status === "DONE") return "Finished.";
    if (v.status === "DECLINED") return `${v.iAmChallenger ? v.them.name + " declined." : "You declined."}`;
    return "This duel was called off.";
  })();

  const winnerName = v.winnerId ? (v.winnerId === v.me.userId ? "You" : v.them.name) : null;

  function SidePanel({ s }: { s: SideView }) {
    const mine = s.isMe;
    const deck = s.deck;
    const highlight = sab && building && v.bothDecks && ((mine && v.isMyTurn) || (!mine && !v.isMyTurn)) && !s.locked;
    return (
      <section className={"dside" + (mine ? " dside--me" : "") + (highlight ? " dside--turn" : "")}>
        <div className="dside__head">
          <span className="av">{s.initial}</span>
          <div>
            <div className="dside__name">{s.name}</div>
            <div className="dside__you">{mine ? "you" : "opponent"}</div>
          </div>
          {s.locked && <span className="badge badge--lock">Locked</span>}
          {s.theme && <span className="badge badge--theme" title="Roulette archetype">🎰 {s.theme}</span>}
        </div>

        {(building || v.status === "PENDING") && (
          <>
            <Budgets b={s.budget} keys={ownKeys} />
            {sab && <Budgets b={s.budget} keys={foeKeys} foe />}
          </>
        )}

        {!s.hasDeck && mine && building && (
          <div className="dside__wait">
            <button className="btn-add" onClick={() => act("gen", () => generateMyDeck(v.id))} disabled={!aiOn || !!busy}>
              {busy === "gen" ? "Drawing your deck…" : "✦ Draw my deck"}
            </button>
            {v.mode === "roulette" && <p className="deck-note">Roulette spins an archetype from your binder first.</p>}
          </div>
        )}
        {!s.hasDeck && !mine && <div className="dside__wait">Waiting for {s.name} to draw…</div>}
        {s.hidden && <HiddenDeck name={s.name} />}

        {deck && (
          <>
            <div className="deck-result__head">
              <div>
                <div className="dside__deckname">{deck.deckName}</div>
                <span className="deck-counts">Main {deck.counts.main} · Extra {deck.counts.extra}{deck.counts.side ? ` · Side ${deck.counts.side}` : ""}</span>
              </div>
            </div>
            <Scorecard p={deck.pillars} compact />
            {deck.strategy && <p className="deck-strategy">{deck.strategy}</p>}
            {mine && building && deck.warnings.length > 0 && (
              <ul className="deck-warns">{deck.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}</ul>
            )}
            <Section title="Main Deck" count={deck.counts.main} entries={deck.main} onPick={mine ? onPickMine : onPickTheirs} selectedName={pick?.name} pinnedNames={pinnedOf(deck)} />
            <Section title="Extra Deck" count={deck.counts.extra} entries={deck.extra} onPick={mine ? onPickMine : onPickTheirs} selectedName={pick?.name} pinnedNames={pinnedOf(deck)} />
            <Section title="Side Deck" count={deck.counts.side} entries={deck.side} onPick={mine ? onPickMine : onPickTheirs} selectedName={pick?.name} pinnedNames={pinnedOf(deck)} />
          </>
        )}

        {/* Kill / snipe confirmation */}
        {pick && ((pick.kind === "kill" && mine) || (pick.kind === "snipe" && !mine)) && (
          <div className="pickbar">
            <span>{pick.kind === "kill" ? "Kill" : "Snipe"} <b>{pick.name}</b>? All copies go, the AI refills the gap.</span>
            <button className="btn-mini btn-danger" disabled={!!busy} onClick={() => act(pick.kind, () => (pick.kind === "kill" ? killMyCard(v.id, pick.name) : snipeCard(v.id, pick.name)))}>
              {busy === pick.kind ? "Working…" : pick.kind === "kill" ? "Kill it" : "Snipe it"}
            </button>
            <button className="btn-mini" onClick={() => setPick(null)}>Cancel</button>
          </div>
        )}

        {/* Own-deck actions */}
        {mine && building && s.hasDeck && !s.locked && (
          <div className="dside__actions">
            <button className="btn-mini" disabled={!canOwnAct || s.budget.reroll <= 0} onClick={() => act("reroll", () => rerollMyDeck(v.id))} title={BUDGET_LABEL.reroll.blurb}>
              {busy === "reroll" ? "Rerolling…" : `↻ Reroll (${s.budget.reroll})`}
            </button>
            <button className="btn-mini" disabled={!canOwnAct || s.budget.pin <= 0} onClick={() => { setPicker({ whose: "mine" }); setQ(""); }} title={BUDGET_LABEL.pin.blurb}>
              📌 Pin a card ({s.budget.pin})
            </button>
            <span className="muted" style={{ fontSize: 12 }}>{s.budget.kill > 0 ? "Click a card to kill it." : ""}</span>
            <span style={{ marginLeft: "auto" }} />
            <button className="btn-add" disabled={!canOwnAct} onClick={() => act("lock", () => lockMyDeck(v.id))}>
              {busy === "lock" ? "Locking…" : "🔒 Lock in"}
            </button>
          </div>
        )}

        {/* Interference actions */}
        {!mine && sab && building && s.hasDeck && !s.locked && v.me.hasDeck && !v.me.locked && (
          <div className="dside__actions">
            <button className="btn-mini btn-danger" disabled={!canInterfere || v.me.budget.plant <= 0} onClick={() => { setPicker({ whose: "theirs" }); setQ(""); }} title={BUDGET_LABEL.plant.blurb}>
              🌱 Plant a card ({v.me.budget.plant})
            </button>
            {v.options.forceReroll && (
              <button className="btn-mini btn-danger" disabled={!canInterfere || v.me.budget.force <= 0} onClick={() => act("force", () => forceRerollTheirs(v.id))} title={BUDGET_LABEL.force.blurb}>
                {busy === "force" ? "Rerolling theirs…" : `💥 Force reroll (${v.me.budget.force})`}
              </button>
            )}
            <span className="muted" style={{ fontSize: 12 }}>{v.me.budget.snipe > 0 && canInterfere ? "Click one of their cards to snipe it." : ""}</span>
          </div>
        )}

        {/* Card picker (pin / plant) */}
        {picker && ((picker.whose === "mine" && mine) || (picker.whose === "theirs" && !mine)) && (
          <div className="picker">
            <div className="deckchat__form">
              <input className="deck-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={picker.whose === "mine" ? "Search your legal cards…" : `Search ${s.name}'s legal cards…`} />
              <button className="btn-mini" onClick={() => setPicker(null)}>Close</button>
            </div>
            <div className="picker__list">
              {hits.map((h) => (
                <button
                  key={h.id}
                  className="picker__item"
                  disabled={!!busy}
                  onClick={() => act(picker.whose === "mine" ? "pin" : "plant", () => (picker.whose === "mine" ? pinMyCard(v.id, h.id) : plantCard(v.id, h.id)))}
                >
                  <img src={artUrl(h.id, true)} alt="" />
                  <span>{h.name}</span>
                  <small>{h.typeLine} · ×{h.qty}</small>
                </button>
              ))}
              {hits.length === 0 && <span className="muted">No matches.</span>}
            </div>
            {busy === "pin" || busy === "plant" ? <p className="deck-note">Rebuilding around it…</p> : null}
          </div>
        )}
      </section>
    );
  }

  return (
    <>
      <header className="topbar">
        <div>
          <span className="page-eyebrow">{MODES[v.mode].label} · {FORMAT_LABEL[v.format]} · {STATUS_LABEL[v.status] ?? v.status}</span>
          <h1 className="page-title">Duel with {v.them.name}</h1>
        </div>
      </header>

      <div className="content">
        <div className={"duel-banner" + (sab && building && v.bothDecks && v.isMyTurn && !v.me.locked ? " duel-banner--turn" : "")}>
          <span>{banner}</span>
          {(v.mutators.length > 0 || v.options.thinking === "careful") && (
            <span className="duel-banner__mut">
              {v.mutators.map((m) => <span key={m} className="badge" title={MUTATORS[m]?.blurb}>{MUTATORS[m]?.label ?? m}</span>)}
              {v.options.thinking === "careful" && <span className="badge" title="Builds let the model reason first: slower, better synergy">Careful AI</span>}
            </span>
          )}
        </div>
        {err && <p className="err">{err}</p>}
        {busy && (busy === "gen" || busy === "reroll" || busy === "kill" || busy === "pin" || busy === "snipe" || busy === "plant" || busy === "force") && (
          <div className="deck-building">The AI is rebuilding a deck — {v.options.thinking === "careful" ? "careful thinking takes up to a minute" : "about 10 seconds"}…</div>
        )}

        {v.status === "PENDING" && (
          <div className="tactions">
            {v.iAmChallenger ? (
              <button className="btn-mini btn-danger" disabled={!!busy} onClick={() => act("cancel", () => cancelDuel(v.id))}>Cancel challenge</button>
            ) : (
              <>
                <button className="btn-add" disabled={!!busy} onClick={() => act("accept", () => acceptDuel(v.id))}>Accept duel</button>
                <button className="btn-mini btn-danger" disabled={!!busy} onClick={() => act("decline", () => declineDuel(v.id))}>Decline</button>
              </>
            )}
          </div>
        )}

        {v.status !== "PENDING" && v.status !== "DECLINED" && v.status !== "CANCELLED" && (
          <div className="duel">
            <SidePanel s={v.me} />
            <SidePanel s={v.them} />
          </div>
        )}

        {building && v.iAmChallenger && (
          <div><button className="btn-mini btn-danger" disabled={!!busy} onClick={() => act("cancel", () => cancelDuel(v.id))}>Call off the duel</button></div>
        )}

        {(v.status === "REVEALED" || v.status === "DONE") && (
          <section className="duel-result">
            {v.status === "DONE" && !editResult ? (
              <>
                <div className="duel-result__title">🏆 {winnerName} won</div>
                {v.resultNote && <p className="deck-strategy" style={{ marginTop: 0 }}>{v.resultNote}</p>}
                <div className="duel-result__row">
                  <button className="btn-add" disabled={!!busy} onClick={() => act("rematch", () => rematchDuel(v.id), (r) => { const id = (r as { id?: string }).id; if (id) router.push(`/play/${id}`); })}>
                    {busy === "rematch" ? "Setting up…" : "⚔ Rematch"}
                  </button>
                  <button className="btn-mini" onClick={() => setEditResult(true)}>Change result</button>
                  <button className="btn-mini" disabled={!!busy || saved} onClick={() => act("save", () => saveDuelDeck(v.id), () => setSaved(true))}>{saved ? "Saved to Decks" : "Save my deck to Decks"}</button>
                </div>
              </>
            ) : (
              <>
                <div className="duel-result__title">Who won?</div>
                <input className="deck-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note — “topdecked Raigeki turn 5”" maxLength={200} />
                <div className="duel-result__row">
                  <button className="btn-add" disabled={!!busy} onClick={() => act("win", () => recordResult(v.id, v.me.userId, note), () => setEditResult(false))}>I won</button>
                  <button className="btn-add" disabled={!!busy} onClick={() => act("lose", () => recordResult(v.id, v.them.userId, note), () => setEditResult(false))}>{v.them.name} won</button>
                  {v.status === "DONE" && <button className="btn-mini" onClick={() => setEditResult(false)}>Cancel</button>}
                  {v.status === "REVEALED" && (
                    <button className="btn-mini" disabled={!!busy || saved} onClick={() => act("save", () => saveDuelDeck(v.id), () => setSaved(true))}>{saved ? "Saved to Decks" : "Save my deck to Decks"}</button>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {v.actions.length > 0 && (
          <section>
            <div className="dsection__head">
              <span className="dsection__title">Moves</span>
              <span className="dsection__count">{v.actions.length}</span>
            </div>
            <div className="duel-log">
              {[...v.actions].reverse().map((a) => (
                <div key={a.id} className="duel-log__row">
                  <b>{a.actorIsMe ? "You" : a.actorName}</b>
                  <span>{logLine(a, v.me.name, v.them.name)}</span>
                  <span className="duel-log__time">{ago(a.at)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
