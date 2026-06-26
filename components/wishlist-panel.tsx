"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RARITY, type Rarity, artUrl } from "@/lib/cards";
import { searchCards } from "@/lib/actions";
import { addToWishlist, removeWishlistItem } from "@/lib/wishlist";

type Match = { username: string; displayName: string | null; rarity: string; condition: string };
type Item = { id: string; cardId: number; name: string; matches: Match[] };
type SearchCard = Awaited<ReturnType<typeof searchCards>>[number];

export function WishlistPanel({ items }: { items: Item[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchCard[]>([]);
  const [searching, setSearching] = useState(false);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    timer.current = setTimeout(async () => {
      setResults(await searchCards(q));
      setSearching(false);
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  function add(cardId: number) {
    start(async () => { await addToWishlist(cardId); setQ(""); setResults([]); router.refresh(); });
  }
  function remove(id: string) {
    start(async () => { await removeWishlistItem(id); router.refresh(); });
  }

  return (
    <div className="friends">
      <section className="panel">
        <h2 className="panel__title">Add to wishlist</h2>
        <input className="add__search" style={{ margin: 0 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the database — cards you're hunting" />
        {(searching || results.length > 0) && (
          <div className="add__results" style={{ padding: "12px 0 0" }}>
            {searching && <p className="add__hint">Searching…</p>}
            {results.map((c) => (
              <button key={c.id} className="add__result" onClick={() => add(c.id)} disabled={pending}>
                <img src={artUrl(c.id, true)} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                <span className="add__result-name">{c.name}</span>
                <span className="add__result-meta">＋ add</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">Your wishlist <span className="panel__count">{items.length}</span></h2>
        {items.length === 0 ? (
          <p className="muted">Nothing yet — search above to add cards you&rsquo;re hunting. We&rsquo;ll show which friends have them for trade.</p>
        ) : (
          <ul className="rowlist">
            {items.map((it) => (
              <li key={it.id} className="rowlist__item">
                <img className="wish__art" src={artUrl(it.cardId, true)} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                <div className="rowlist__info">
                  <div className="rowlist__name">{it.name}</div>
                  <div className="rowlist__meta">
                    {it.matches.length === 0 ? (
                      "No friends have it for trade yet"
                    ) : (
                      it.matches.map((m, i) => (
                        <span key={i} className="wish__match">
                          <a href={`/u/${m.username}`}>{m.displayName || m.username}</a> · {RARITY[m.rarity as Rarity]?.abbr ?? m.rarity} {m.condition}
                          {i < it.matches.length - 1 ? " · " : ""}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                {it.matches.length > 0 && <span className="wish__badge">{it.matches.length} for trade</span>}
                <button className="btn-mini btn-danger" disabled={pending} onClick={() => remove(it.id)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
