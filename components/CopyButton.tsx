"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function CopyButton({ label, text, compact = false }: { label: string; text: string; compact?: boolean }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("error");
    }

    if (resetTimer.current) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setStatus("idle"), 2200);
  }

  const accessibleLabel = status === "copied" ? "Copiado" : status === "error" ? "Não foi possível copiar" : label;

  return (
    <button
      aria-label={accessibleLabel}
      className={compact ? "copy-button compact" : "copy-button"}
      onClick={copy}
      title={accessibleLabel}
      type="button"
    >
      {status === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {!compact ? <span aria-live="polite">{status === "copied" ? "Copiado" : status === "error" ? "Tentar novamente" : "Copiar"}</span> : null}
      {compact ? <span aria-live="polite" className="sr-only">{accessibleLabel}</span> : null}
    </button>
  );
}
