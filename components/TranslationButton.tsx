"use client";

import { useState } from "react";
import { requestTranslation } from "@/lib/learning/translation-request";
import { TalkitoIcon, type TalkitoIconName } from "./TalkitoIcon";

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
  const iconName: TalkitoIconName = status === "loading" ? "loader" : status === "error" ? "rotate-ccw" : "languages";

  return (
    <div className="translation-control">
      <button aria-busy={status === "loading"} aria-expanded={translation ? expanded : undefined} className="translate-button" disabled={status === "loading"} onClick={toggleTranslation} type="button">
        <TalkitoIcon name={iconName} size={16} />
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
