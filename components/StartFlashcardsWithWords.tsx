"use client";

import { Brain } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SpiralSpinner } from "./SpiralSpinner";

type StartFlashcardsWithWordsProps = { wordIds: string[]; label: string; disabled?: boolean };

type CreatedSession = { ok?: boolean; sessionId?: string; cards?: unknown[]; languageCode?: string; languageName?: string; adapted?: boolean; error?: string };

export function StartFlashcardsWithWords({ wordIds, label, disabled }: StartFlashcardsWithWordsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    if (!wordIds.length || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/practice/flashcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wordIds }) });
      const data = await response.json() as CreatedSession;
      if (!response.ok || !data.ok || !data.sessionId) throw new Error(data.error ?? "Não foi possível montar o treino.");
      void fetch("/api/events", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_name: "cta_clicked", payload: { cta: "review_cards" } }) }).catch(() => undefined);
      // Handoff 1-toque: o trainer encontra esta sessão no mount e entra direto.
      sessionStorage.setItem("ai-fluency:pending-flashcards", JSON.stringify(data));
      router.push("/palavras/treino");
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Não foi possível montar o treino.");
      setBusy(false);
    }
  }

  return <>
    <button className="outline-button full-button" disabled={disabled || busy || !wordIds.length} onClick={() => void start()} type="button">
      {busy ? <SpiralSpinner label="Montando seu treino..." size={20} /> : <Brain />}
      {busy ? "Montando seu treino..." : label}
    </button>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </>;
}
