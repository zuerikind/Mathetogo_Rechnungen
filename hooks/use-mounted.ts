"use client";

import { useEffect, useState } from "react";

/** True only after the first client paint — use before rendering locale/time-dependent UI. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}
