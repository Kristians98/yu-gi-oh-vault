"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { getMyNotifications, markAllRead } from "@/lib/notifications";

type N = { id: string; body: string; href: string | null; read: boolean; at: number };

function ago(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<N[]>([]);
  const [unread, setUnread] = useState(0);
  const [, start] = useTransition();
  const btnRef = useRef<HTMLButtonElement>(null);
  // The menu is portaled to <body> and positioned fixed: the sidebar is a stacking context
  // (sticky + z-index + backdrop-filter on mobile), so anything rendered inside it can sit
  // under the tab bar or the topbar. Position is measured from the button and clamped to
  // the viewport so it never runs off a narrow screen.
  const [pos, setPos] = useState<CSSProperties>({});
  function place() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const width = Math.min(300, vw - 16);
    const left = Math.max(8, Math.min(r.left, vw - width - 8));
    setPos({ top: r.bottom + 8, left, width, maxHeight: Math.max(160, window.innerHeight - r.bottom - 24) });
  }
  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  async function load() {
    try {
      const r = await getMyNotifications();
      setItems(r.items);
      setUnread(r.unread);
    } catch {
      /* ignore poll errors */
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 25000);
    const onRefresh = () => load();
    window.addEventListener("vault:refresh", onRefresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("vault:refresh", onRefresh);
    };
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      start(async () => {
        await markAllRead();
        setUnread(0);
        setItems((cur) => cur.map((i) => ({ ...i, read: true })));
      });
    }
  }

  return (
    <div className="bell">
      <button ref={btnRef} className="bell__btn" onClick={toggle} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && <span className="bell__count">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open &&
        createPortal(
          <>
            <div className="bell__backdrop" onClick={() => setOpen(false)} />
            <div className="bell__menu" style={pos} role="dialog" aria-label="Notifications">
          <div className="bell__head">Notifications</div>
          {items.length === 0 ? (
            <p className="bell__empty">Nothing yet.</p>
          ) : (
            items.map((n) =>
              n.href ? (
                <Link key={n.id} className={"bell__item" + (n.read ? "" : " unread")} href={n.href} onClick={() => setOpen(false)}>
                  <span>{n.body}</span>
                  <i>{ago(n.at)}</i>
                </Link>
              ) : (
                <div key={n.id} className={"bell__item" + (n.read ? "" : " unread")}>
                  <span>{n.body}</span>
                  <i>{ago(n.at)}</i>
                </div>
              ),
            )
          )}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
