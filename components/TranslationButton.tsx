"use client";

import { useState } from "react";
import { Languages, Loader2, RotateCcw } from "lucide-react";
import { requestTranslation } from "@/lib/learning/translation-request";

type TranslationStatus = "idle" | "loading" | "ready" | "error";

export function TranslationButton({ text, sourceLanguage }: { text: string; sourceLanguage?: string }) {
  const [status, setStatus] = useState<TranslationStatus>("idle");
  const [translation, setTranslation] = useState("");
  const [expanded, setExpanded] = useState(false);

  async function toggleTranslation() {
    if (status === "loading") return;
    if (translation) {
      setExpanded((current) => !current);
      return;
    }

    setStatus("loading");
    try {
      const translatedText = await requestTranslation(text, sourceLanguage);
      setTranslation(translatedText);
      setExpanded(true);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  const label = translation
    ? expanded ? "Ocultar tradução" : "Mostrar tradução"
    : status === "loading" ? "Traduzindo" : status === "error" ? "Tentar traduzir novamente" : "Traduzir";

  return (
    <div className="translation-control">
      <button aria-busy={status === "loading"} aria-expanded={translation ? expanded : undefined} className="translate-button" disabled={status === "loading"} onClick={toggleTranslation} type="button">
        {status === "loading" ? (
          <Loader2 aria-hidden="true" className="animate-spin" size={16} />
        ) : status === "error" ? (
          <RotateCcw aria-hidden="true" size={16} />
        ) : (
          <Languages aria-hidden="true" size={16} />
        )}
        {label}
      </button>
      {expanded && translation ? (
        <p aria-live="polite" className="message-translation" lang="pt-BR">
          <span>PT</span> {translation}
        </p>
      ) : null}
      {status === "error" ? <span aria-live="polite" className="sr-only">Não foi possível traduzir agora.</span> : null}
    </div>
  );
}
