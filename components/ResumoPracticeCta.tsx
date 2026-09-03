"use client";

import { StartFlashcardsWithWords } from "./StartFlashcardsWithWords";

export function ResumoPracticeCta({ wordIds }: { wordIds: string[] }) {
  const capped = wordIds.slice(0, 30);
  if (!capped.length) return null;
  return <StartFlashcardsWithWords label={`Treinar as ${capped.length} palavra${capped.length === 1 ? "" : "s"} desta conversa`} wordIds={capped} />;
}
