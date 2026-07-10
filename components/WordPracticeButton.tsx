"use client";

import { Loader2, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type WordPracticeButtonProps = {
  wordId?: string;
  compact?: boolean;
};

export function WordPracticeButton({ wordId, compact = false }: WordPracticeButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = wordId ? `/api/words/${wordId}/practice` : "/api/practice/weak-words";

  async function startPractice() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST" });
      const data = (await response.json()) as { ok?: boolean; error?: string; redirectTo?: string };
      if (!response.ok || !data.ok || !data.redirectTo) throw new Error(data.error ?? "Não foi possível iniciar a revisão.");
      router.push(data.redirectTo);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível iniciar a revisão.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={compact ? "practice-button-wrap compact" : "practice-button-wrap"}>
      <button className={compact ? "voice-icon-button" : "dark-button full-button"} disabled={loading} onClick={startPractice} type="button">
        {loading ? <Loader2 className="spin" /> : <Play fill={compact ? "#2f9d4a" : "#fff"} />}
        {compact ? <span className="sr-only">Praticar esta palavra</span> : "Praticar palavras fracas"}
      </button>
      {error ? <p className="practice-error" role="alert">{error}</p> : null}
    </div>
  );
}
