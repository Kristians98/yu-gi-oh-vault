"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { challengeDuel } from "@/lib/duels";
import { FORMATS, FORMAT_LABEL, MIN_POOL, MODES, MUTATORS, MUTATOR_KEYS, type DuelMode, type MutatorKey } from "@/lib/duel-rules";
import type { DeckFormat } from "@/lib/deck-engine";
import type { FriendPool } from "@/lib/duel-view";
import { THINKING, type Thinking } from "@/lib/thinking";

export function DuelChallenge({ friends, myPools, aiOn }: { friends: FriendPool[]; myPools: Record<DeckFormat, number>; aiOn: boolean }) {
  const router = useRouter();
  const [friendId, setFriendId] = useState<string>(friends[0]?.id ?? "");
  const [format, setFormat] = useState<DeckFormat>("advanced");
  const [mode, setMode] = useState<DuelMode>("classic");
  const [muts, setMuts] = useState<MutatorKey[]>([]);
  const [forceReroll, setForceReroll] = useState(false);
  const [thinking, setThinking] = useState<Thinking>("fast");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const friend = friends.find((f) => f.id === friendId) ?? null;
  const okFor = (f: DeckFormat) => myPools[f] >= MIN_POOL && (friend ? friend.pools[f] >= MIN_POOL : false);
  const canSend = aiOn && !!friend && okFor(format) && !pending;

  function toggle(m: MutatorKey) {
    setMuts((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  }

  function send() {
    if (!friend) return;
    setErr(null);
    start(async () => {
      const r = await challengeDuel({ opponentId: friend.id, format, mode, mutators: muts, forceReroll, thinking });
      if (r.error || !r.id) { setErr(r.error ?? "Could not create the duel."); return; }
      router.push(`/play/${r.id}`);
    });
  }

  if (friends.length === 0) {
    return <p className="deck-note">Add a friend first — duels are built from both binders.</p>;
  }

  return (
    <div className="chal">
      <div className="deck-field">
        <span>Opponent</span>
        <div className="chal__friends">
          {friends.map((f) => (
            <button key={f.id} type="button" className={"fpick" + (f.id === friendId ? " on" : "")} onClick={() => setFriendId(f.id)}>
              <span className="av">{f.initial}</span>
              {f.name}
            </button>
          ))}
        </div>
      </div>

      <div className="chal__row">
        <div className="deck-field">
          <span>Format</span>
          <div className="seg">
            {FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                className={"seg__b" + (format === f ? " on" : "")}
                onClick={() => setFormat(f)}
                disabled={!okFor(f)}
                title={okFor(f) ? `${FORMAT_LABEL[f]} — you ${myPools[f]} legal cards, ${friend?.name ?? "they"} ${friend?.pools[f] ?? 0}` : `Not enough legal cards for ${FORMAT_LABEL[f]} (need ${MIN_POOL} each)`}
              >
                {FORMAT_LABEL[f]}
              </button>
            ))}
          </div>
          <span className="poolnote">
            Legal pool · you {myPools[format]}{friend ? ` · ${friend.name} ${friend.pools[format]}` : ""}
          </span>
        </div>
        <div className="deck-field">
          <span>AI thinking</span>
          <div className="seg">
            {(Object.keys(THINKING) as Thinking[]).map((t) => (
              <button key={t} type="button" className={"seg__b" + (thinking === t ? " on" : "")} onClick={() => setThinking(t)} title={THINKING[t].blurb}>
                {THINKING[t].label}
              </button>
            ))}
          </div>
          <span className="poolnote">{THINKING[thinking].blurb}</span>
        </div>
      </div>

      <div className="deck-field">
        <span>Mode</span>
        <div className="modes">
          {(Object.keys(MODES) as DuelMode[]).map((m) => (
            <button key={m} type="button" className={"modecard" + (mode === m ? " on" : "")} onClick={() => setMode(m)}>
              <span className="modecard__t">{MODES[m].label}</span>
              <span className="modecard__b">{MODES[m].blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="deck-field">
        <span>Mutators (optional)</span>
        <div className="chal__friends">
          {MUTATOR_KEYS.map((m) => (
            <button key={m} type="button" className={"chip" + (muts.includes(m) ? " chip--active" : "")} onClick={() => toggle(m)} title={MUTATORS[m].blurb}>
              {MUTATORS[m].label}
            </button>
          ))}
          {mode === "sabotage" && (
            <button type="button" className={"chip" + (forceReroll ? " chip--active" : "")} onClick={() => setForceReroll((v) => !v)} title="Each side gets one Force reroll of the other's deck. Brutal.">
              Force reroll allowed
            </button>
          )}
        </div>
      </div>

      <div className="chal__row">
        <button className="btn-add" onClick={send} disabled={!canSend}>
          {pending ? "Sending…" : `⚔ Challenge ${friend?.name ?? ""}`}
        </button>
        {!aiOn && <span className="deck-note deck-note--warn">AI isn’t configured — decks can’t be built.</span>}
        {err && <span className="err">{err}</span>}
      </div>
    </div>
  );
}
