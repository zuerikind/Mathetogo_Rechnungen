"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LoadingSpinner } from "@/components/LoadingSpinner";

const MIN_VISIBLE_MS = 380;

/**
 * Thin top bar + small spinner on client-side route changes (App Router soft navigations).
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const currentPath = pathname ?? "";
  const [active, setActive] = useState(false);
  const prevPath = useRef<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (currentPath.startsWith("/login") || currentPath.startsWith("/api")) {
      prevPath.current = currentPath;
      return;
    }

    if (prevPath.current === null) {
      prevPath.current = currentPath;
      return;
    }

    if (prevPath.current === currentPath) return;

    prevPath.current = currentPath;
    if (hideTimer.current) clearTimeout(hideTimer.current);

    setActive(true);
    hideTimer.current = setTimeout(() => {
      setActive(false);
      hideTimer.current = null;
    }, MIN_VISIBLE_MS);

    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [currentPath]);

  if (!active) return null;

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-1 overflow-hidden bg-[#4A7FC1]/15"
        aria-hidden
      >
        <div className="nav-progress-indeterminate h-full w-full bg-[#4A7FC1]" />
      </div>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex items-center gap-2 rounded-full border border-blue-100 bg-white/95 px-3 py-2 text-xs font-medium text-gray-600 shadow-md backdrop-blur-sm">
        <LoadingSpinner size={16} />
        Seite lädt…
      </div>
    </>
  );
}
