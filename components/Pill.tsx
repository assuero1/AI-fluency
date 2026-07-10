import type { HTMLAttributes, ReactNode } from "react";

type PillTone = "default" | "primary" | "warning" | "info";
type PillProps = HTMLAttributes<HTMLSpanElement> & { children: ReactNode; tone?: PillTone };

export function Pill({ children, className = "", tone = "default", ...props }: PillProps) {
  const toneClass = tone === "default" ? "pill" : `pill ${tone}`;
  return <span className={`${toneClass} ${className}`.trim()} {...props}>{children}</span>;
}
