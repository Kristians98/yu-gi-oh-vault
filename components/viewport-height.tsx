"use client";

import { useEffect } from "react";

/** Publishes the visible viewport height as --vvh on <html>. window.visualViewport is the
 *  one value iOS Safari keeps honest (it tracks the toolbar and the keyboard), so the app
 *  shell uses it in preference to CSS viewport units. */
export function ViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    const apply = () => {
      const h = Math.round(vv?.height ?? window.innerHeight);
      if (h > 0) document.documentElement.style.setProperty("--vvh", `${h}px`);
    };
    apply();
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);
  return null;
}
