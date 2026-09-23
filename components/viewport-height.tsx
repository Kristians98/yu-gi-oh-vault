"use client";

import { useEffect } from "react";

/** Publishes the *visible* viewport height as --vvh. iOS Safari's 100dvh can equal the
 *  tall (toolbar-hidden) viewport while the toolbar is actually showing, which pushes the
 *  bottom row of the app shell under the toolbar. window.visualViewport is the truth. */
export function ViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    const apply = () => {
      const h = Math.round(vv?.height ?? window.innerHeight);
      document.documentElement.style.setProperty("--vvh", `${h}px`);
    };
    apply();
    vv?.addEventListener("resize", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      vv?.removeEventListener("resize", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);
  return null;
}
