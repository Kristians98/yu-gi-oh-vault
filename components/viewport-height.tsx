"use client";

import { useEffect, useState } from "react";

/** Publishes the visible viewport height as --vvh on <html>. window.visualViewport is the
 *  one value iOS Safari keeps honest (it tracks the toolbar and the keyboard), so the app
 *  shell sizes itself from it instead of CSS viewport units.
 *  Add ?debug=1 to the URL to show the live layout numbers (for diagnosing a device). */
export function ViewportHeight() {
  const [debug, setDebug] = useState<string | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    const wantDebug = location.search.includes("debug=1");
    const apply = () => {
      const h = Math.round(vv?.height ?? window.innerHeight);
      if (h > 0) document.documentElement.style.setProperty("--vvh", `${h}px`);
      if (wantDebug) {
        const r = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return "none";
          const b = el.getBoundingClientRect();
          return `${Math.round(b.top)}→${Math.round(b.bottom)}`;
        };
        setDebug(
          [
            `vv.h ${vv ? Math.round(vv.height) : "n/a"} · inner ${window.innerHeight} · screen ${screen.height}`,
            `body ${r("body")} · shell ${r(".shell")}`,
            `header ${r(".sidebar")} · mnav ${r(".mnav")}`,
            `--vvh ${getComputedStyle(document.documentElement).getPropertyValue("--vvh") || "unset"} · scrollY ${Math.round(window.scrollY)}`,
            navigator.userAgent.match(/OS (\d+_\d+)/)?.[0]?.replace("_", ".") ?? navigator.userAgent.slice(0, 40),
          ].join("\n"),
        );
      }
    };
    apply();
    const t = window.setTimeout(apply, 600); // after fonts/layout settle
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    window.addEventListener("scroll", apply);
    return () => {
      window.clearTimeout(t);
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      window.removeEventListener("scroll", apply);
    };
  }, []);
  if (!debug) return null;
  return (
    <pre
      style={{
        position: "fixed", top: 70, left: 8, zIndex: 9999, margin: 0, padding: "6px 8px", borderRadius: 8,
        background: "rgba(0,0,0,.85)", color: "#9f9", font: "11px/1.4 ui-monospace, monospace", pointerEvents: "none", whiteSpace: "pre",
      }}
    >
      {debug}
    </pre>
  );
}
