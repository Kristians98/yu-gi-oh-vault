"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

/**
 * The avatar is a button. Its menu holds the low-traffic account actions — Sign out and
 * the destructive "Clear binder…" — so they are reachable but not in the way. Portaled to
 * <body> and positioned fixed from the avatar (same reasons as the notification bell).
 */
export function ProfileMenu({ initial, name, handle, logout }: { initial: string; name: string; handle: string; logout: () => Promise<void> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);

  function place() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(260, vw - 16);
    // Desktop: the avatar sits at the bottom of the sidebar → open upward (anchor the menu's
    // bottom edge above the button). Phone header: open downward as usual.
    const upward = r.top > vh / 2;
    const left = Math.max(8, Math.min(upward ? r.left : r.right - width, vw - width - 8));
    setPos(upward ? { bottom: vh - r.top + 8, left, width } : { top: r.bottom + 8, left, width });
  }
  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  function clearBinder() {
    setOpen(false);
    router.push("/?clear=1"); // the binder opens its confirmation when it sees this
  }

  return (
    <>
      <button ref={btnRef} className="user__avatar user__avatar--btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Account menu">
        {initial}
      </button>
      {open &&
        createPortal(
          <>
            <div className="bell__backdrop" onClick={() => setOpen(false)} />
            <div className="bell__menu pmenu" style={pos} role="menu" aria-label="Account">
              <div className="pmenu__who">
                <div className="user__name">{name}</div>
                <div className="user__handle">@{handle}</div>
              </div>
              <button className="pmenu__item pmenu__item--danger" role="menuitem" onClick={clearBinder}>
                Clear binder…
                <span>removes every card</span>
              </button>
              <form action={logout}>
                <button className="pmenu__item" role="menuitem" type="submit">Sign out</button>
              </form>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
