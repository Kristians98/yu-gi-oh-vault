"use client";

import { useEffect, useState } from "react";

/** Publishes the visible viewport height as --vvh (and the header height as --header-h)
 *  on <html>. window.visualViewport is the one value iOS Safari keeps honest, so the app
 *  shell sizes itself from it instead of CSS viewport units.
 *  Add ?debug=1 to the URL to show the live layout numbers (for diagnosing a device). */
export function ViewportHeight() {
  const [debug, setDebug] = useState<string | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    const wantDebug = location.search.includes("debug=1");
    let stable = 0; // last height measured with the keyboard closed
    const editing = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    };
    const apply = () => {
      let h = Math.round(vv?.height ?? window.innerHeight);
      // The on-screen keyboard shrinks the visual viewport. Reflowing the whole shell to
      // that height makes the camera stage collapse and the tab bar jump above the
      // keyboard, so while a field is focused we keep the last full height and let iOS pan
      // the page to the input instead. The keyboard closing fires resize → re-measure.
      if (editing() && stable && h < stable - 80) h = stable;
      else if (h > 0) stable = h;
      if (h > 0) document.documentElement.style.setProperty("--vvh", `${h}px`);
      const header = document.querySelector(".sidebar")?.getBoundingClientRect().height;
      if (header) document.documentElement.style.setProperty("--header-h", `${Math.round(header)}px`);
      if (wantDebug) {
        const r = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return "none";
          const b = el.getBoundingClientRect();
          return `${Math.round(b.top)}→${Math.round(b.bottom)}`;
        };
        const os = navigator.userAgent.match(/OS (\d+_\d+)/)?.[0]?.replace("_", ".") ?? navigator.userAgent.slice(0, 40);
        setDebug(
          [
            `vv.h ${vv ? Math.round(vv.height) : "n/a"} · inner ${window.innerHeight} · screen ${screen.height}${editing() ? " · kbd" : ""}`,
            `body ${r("body")} · shell ${r(".shell")}`,
            `header ${r(".sidebar")} · mnav ${r(".mnav")}`,
            `--vvh ${getComputedStyle(document.documentElement).getPropertyValue("--vvh") || "unset"} · scrollY ${Math.round(window.scrollY)}`,
            os,
          ].join("\n"),
        );
      }
    };
    apply();
    const t = window.setTimeout(apply, 600); // after fonts/layout settle
    const onBlur = () => window.setTimeout(apply, 350); // after the keyboard has closed
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    window.addEventListener("scroll", apply);
    document.addEventListener("focusout", onBlur);
    return () => {
      window.clearTimeout(t);
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      window.removeEventListener("scroll", apply);
      document.removeEventListener("focusout", onBlur);
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
