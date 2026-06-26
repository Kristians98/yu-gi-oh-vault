"use client";

import { useEffect, useRef, useState } from "react";
import type { Card } from "@/lib/cards";
import { RarityCard } from "./rarity-card";

// One shared observer for the whole grid (cheaper than one per card). It mounts a
// card when it comes within ~1000px of the viewport and reports when it leaves, so
// the wrapper can unmount far-off cards and let the browser reclaim their image +
// effect layers. This keeps memory roughly constant regardless of collection size.
type Cb = (visible: boolean) => void;
const callbacks: WeakMap<Element, Cb> = new WeakMap();
let observer: IntersectionObserver | null = null;

function sharedObserver(): IntersectionObserver | null {
  if (typeof window === "undefined") return null;
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) callbacks.get(e.target)?.(e.isIntersecting);
      },
      { rootMargin: "1000px 0px" },
    );
  }
  return observer;
}

/**
 * Renders a real card only while it's near the viewport; once scrolled well past,
 * it falls back to a same-size placeholder so the heavy card (art + holo/foil
 * layers + masks) is unmounted and its memory freed. `eager` paints the first
 * screenful immediately so there's no flash on load.
 */
export function LazyCard({ card, onOpen, eager = false }: { card: Card; onOpen: (c: Card) => void; eager?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(eager);

  useEffect(() => {
    const el = ref.current;
    const io = sharedObserver();
    if (!el || !io) return;
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
