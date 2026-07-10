"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type CalendarPracticeButtonProps = {
  date: string;
  compact?: boolean;
};

type CalendarTopicButtonProps = {
  title: string;
  reason: string;
};

export function CalendarPracticeButton({ date, compact = false }: CalendarPracticeButtonProps) {
  return <PracticeRequestButton endpoint={`/api/daily-feedback/${date}/practice`} label="Praticar este foco" compact={compact} />;
}

export function CalendarTopicButton({ title, reason }: CalendarTopicButtonProps) {
  return (
    <PracticeRequestButton
      body={{ title, reason, source: "calendar_based", mode: "calendar_focus" }}
      endpoint="/api/conversations/start"
      label="Praticar"
      compact
    />
  );
}

function PracticeRequestButton({
  endpoint,
  label,
  compact = false,
  body
}: {
  endpoint: string;
  label: string;
  compact?: boolean;
  body?: Record<string, string>;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; redirectTo?: string };
      if (!response.ok || !data.ok || !data.redirectTo) throw new Error(data.error ?? "Não foi possível iniciar a prática.");
      router.push(data.redirectTo);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível iniciar a prática.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={compact ? "calendar-practice-wrap compact" : "calendar-practice-wrap"}>
      <button className={compact ? "outline-button" : "dark-button full-button"} disabled={loading} onClick={start} type="button">
        {loading ? <Loader2 className="spin" /> : compact ? null : <ArrowRight />}
        {label}
      </button>
      {error ? <p className="practice-error" role="alert">{error}</p> : null}
    </div>
  );
}
