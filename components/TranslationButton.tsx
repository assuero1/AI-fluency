"use client";

import { Languages, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";

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
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, sourceLanguage })
      });
      const data = (await response.json()) as { ok?: boolean; translation?: string; error?: string };
      if (!response.ok || !data.ok || !data.translation) throw new Error(data.error ?? "Tradução indisponível.");
      setTranslation(data.translation);
      setExpanded(true);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  const label = translation
    ? expanded ? "Ocultar tradução" : "Mostrar tradução"
    : status === "loading" ? "Traduzindo" : status === "error" ? "Tentar traduzir novamente" : "Traduzir";
  const Icon = status === "loading" ? Loader2 : status === "error" ? RotateCcw : Languages;

  return (
    <div className="translation-control">
      <button aria-expanded={translation ? expanded : undefined} className="translate-button" onClick={toggleTranslation} type="button">
        <Icon aria-hidden="true" className={status === "loading" ? "spin" : undefined} />
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
