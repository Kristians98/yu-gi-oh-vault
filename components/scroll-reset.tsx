"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** On phones the content area (.main) is the scroll container, not the window, so the
 *  router's scroll-to-top on navigation does not reach it. Reset it on every route change. */
export function ScrollReset() {
  const pathname = usePathname();
  useEffect(() => {
    const main = document.querySelector<HTMLElement>(".main");
    if (main && main.scrollTop > 0) main.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}
