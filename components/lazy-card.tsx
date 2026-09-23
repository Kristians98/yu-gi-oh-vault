"use client";

import { useEffect, useRef, useState } from "react";
import type { Card } from "@/lib/cards";
import { RarityCard } from "./rarity-card";

// One shared observer per scroll root (cheaper than one per card). It mounts a card when
// it comes within ~1.2 screens of the visible area and reports when it leaves, so the
// wrapper can unmount far-off cards and let the browser reclaim their image + effect
// layers. This keeps memory roughly constant regardless of collection size.
//
// The root matters: on phones the scrolling element is .main, not the window. An observer
// rooted on the window clips cards to .main's box first, so the pre-load margin was
// effectively zero there and cards popped in at the edge. Rooting on the actual scroll
// container restores the buffer.
type Cb = (visible: boolean) => void;
const callbacks: WeakMap<Element, Cb> = new WeakMap();
const observers = new Map<Element | null, IntersectionObserver>();
const MARGIN = "120% 0px"; // ≈ 2–4 rows above and below on a phone, ~1 screen on desktop

function scrollRootOf(el: Element): Element | null {
  const main = el.closest(".main");
  if (main && /(auto|scroll)/.test(getComputedStyle(main).overflowY)) return main;
  return null; // window scrolls
}

function observerFor(root: Element | null): IntersectionObserver {
  let io = observers.get(root);
  if (!io) {
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) callbacks.get(e.target)?.(e.isIntersecting);
      },
      { root, rootMargin: MARGIN },
    );
    observers.set(root, io);
  }
  return io;
}

/**
 * Renders a real card only while it's near the visible area; once scrolled well past,
 * it falls back to a same-size placeholder so the heavy card (art + holo/foil layers +
 * masks) is unmounted and its memory freed. `eager` paints the first screenful
 * immediately so there's no flash on load.
 */
export function LazyCard({ card, onOpen, eager = false }: { card: Card; onOpen: (c: Card) => void; eager?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(eager);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = observerFor(scrollRootOf(el));
    callbacks.set(el, setNear);
    io.observe(el);
    return () => {
      io.unobserve(el);
      callbacks.delete(el);
    };
  }, []);

  return (
    <div className="card-wrap" ref={ref}>
      {near ? <RarityCard card={card} onOpen={onOpen} /> : <div className="card-ph" aria-hidden />}
    </div>
  );
}
