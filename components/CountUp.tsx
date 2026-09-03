"use client";

import { useEffect, useState } from "react";

type CountUpProps = { value: number; suffix?: string; className?: string; durationMs?: number };

export function CountUp({ value, suffix = "", className, durationMs = 900 }: CountUpProps) {
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setDisplayed(value); return; }
    let frame = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);

  return <span className={className}>{displayed}{suffix}</span>;
}
