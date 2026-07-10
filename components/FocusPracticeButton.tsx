"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function FocusPracticeButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/progress/focus-practice", { method: "POST" });
      const data = (await response.json()) as { ok?: boolean; error?: string; redirectTo?: string };
      if (!response.ok || !data.ok || !data.redirectTo) throw new Error(data.error ?? "Não foi possível iniciar o foco da semana.");
      router.push(data.redirectTo);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível iniciar o foco da semana.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="focus-practice-wrap">
      <button className="dark-button full-button" disabled={loading} onClick={start} type="button">
        {loading ? <Loader2 className="spin" /> : <ArrowRight />}
        Treinar foco da semana
      </button>
      {error ? <p className="practice-error" role="alert">{error}</p> : null}
    </div>
  );
}
