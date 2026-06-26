"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Free-tier real-time = light polling. Serverless can't hold a long-lived SSE connection
// or fan out an in-process event bus across instances, so instead of /api/stream we
// refresh server components + ping client widgets (the bell) every 30s, but only while
// the tab is visible (saves work + function invocations when idle).
export function Realtime() {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      window.dispatchEvent(new CustomEvent("vault:refresh"));
    };
    const timer = setInterval(tick, 30000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
