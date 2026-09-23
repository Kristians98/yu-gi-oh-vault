"use client";

import { useEffect } from "react";

/**
 * While a modal is open: lock page scrolling and mark the body so the phone layout can
 * freeze its own scroll container (.main) too. Handles several modals at once.
 * Also closes on Escape.
 */
export function useModalLock(onClose: () => void) {
  useEffect(() => {
    const body = document.body;
    const n = Number(body.dataset.modals || 0) + 1;
    body.dataset.modals = String(n);
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const left = Number(body.dataset.modals || 1) - 1;
      if (left <= 0) {
        delete body.dataset.modals;
        body.style.overflow = prevOverflow;
      } else body.dataset.modals = String(left);
    };
  }, [onClose]);
}
