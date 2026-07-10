"use client";

import {
  ArrowRight,
  BriefcaseBusiness,
  BellRing,
  ChevronDown,
  Edit3,
  Keyboard,
  Laptop,
  Loader2,
  MessageCircle,
  Mic,
  Sparkles,
  TrendingUp
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconBubble } from "./IconBubble";
import { MetricGrid } from "./MetricGrid";
import { Pill } from "./Pill";
import { ScreenHeader } from "./ScreenHeader";
import type { HomeSuggestion } from "@/lib/learning/home";

type HomeData = {
  user: {
    name: string;
  };
  profile: {
    languageCode: string;
    languageName: string;
    level: string;
  } | null;
  suggestions: HomeSuggestion[];
  feedback: {
    hasFeedback: boolean;
    correctionScore: number;
    recurringErrors: number;
    newWords: number;
    recentFocus: string;
  };
  practice: {
    streak: number;
    practicedToday: boolean;
  };
  words: {
    totalUsed: number;
    weeklyNew: number;
    mostRecent: {
      displayText: string;
      totalUses: number;
      goal: number;
    } | null;
  };
};

const suggestionIcons = [BriefcaseBusiness, MessageCircle, Laptop];

export function HomeDashboard({ home }: { home: HomeData }) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [suggestions, setSuggestions] = useState(home.suggestions);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const profile = home.profile;
  const languageCode = (profile?.languageCode ?? "en").slice(0, 2).toUpperCase();
  const totalWords = home.words.totalUsed || 0;
  const weeklyGoal = home.words.mostRecent?.goal || 500;
  const weeklyProgress = Math.max(0, Math.min(100, Math.round((home.words.weeklyNew / weeklyGoal) * 100)));

  const feedbackMetrics = [
    {
      value: home.feedback.hasFeedback ? `${home.feedback.correctionScore}/10` : "—",
      label: "Correções aplicadas",
      foot: home.feedback.hasFeedback ? "Feedback mais recente" : "Conclua uma conversa",
      icon: TrendingUp,
      tone: "primary" as const
    },
    {
      value: String(home.feedback.recurringErrors),
      label: "Erros recorrentes",
      foot: home.feedback.hasFeedback ? "Ver detalhes" : "Sem feedback ainda",
      icon: MessageCircle,
      tone: "warning" as const
    },
    {
      value: home.feedback.hasFeedback ? `+${home.feedback.newWords}` : "—",
      label: "Novas palavras",
      foot: home.feedback.hasFeedback ? "No feedback mais recente" : "Aparecem após a prática",
      icon: Sparkles,
      tone: "info" as const
    }
  ];

  async function suggestTopic() {
    setPendingAction("suggest");
    setError(null);

    try {
      const response = await fetch("/api/topics/suggest", { method: "POST" });
      const data = (await response.json()) as { ok?: boolean; error?: string; suggestion?: HomeSuggestion };
      if (!response.ok || !data.ok || !data.suggestion) throw new Error(data.error ?? "Não foi possível sugerir tema.");
      setSuggestions((current) => [data.suggestion!, ...current.filter((item) => item.title !== data.suggestion!.title)].slice(0, 3));
      setTopic(data.suggestion.title);
    } catch (suggestError) {
      setError(suggestError instanceof Error ? suggestError.message : "Erro inesperado ao sugerir tema.");
    } finally {
      setPendingAction(null);
    }
  }

  async function startConversation(input: { title?: string; topicId?: string; mode?: string; source?: string; reason?: string }) {
    const actionKey = input.topicId ?? input.mode ?? input.title ?? "custom";
    setPendingAction(actionKey);
    setError(null);

    try {
      const response = await fetch("/api/conversations/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; redirectTo?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Não foi possível iniciar a conversa.");
      router.push(data.redirectTo ?? "/chat");
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Erro inesperado ao iniciar conversa.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <>
      <ScreenHeader title={`Olá, ${home.user.name} 👋`} subtitle="Pronta para praticar hoje?" streak={home.practice.streak} />

      <div className="selector-bar">
        <Link
          aria-label={`Trocar idioma de estudo. Idioma atual: ${profile?.languageName ?? "Inglês"}`}
          className="language-selector"
          href="/onboarding?mode=language"
          title="Trocar idioma de estudo"
        >
          <span className="selector-item">
            <span className="flag">{languageCode}</span>
            <span className="language-selector-label">{profile?.languageName ?? "Inglês"}</span>
            <ChevronDown size={21} aria-hidden="true" />
          </span>
        </Link>
        <div style={{ height: 34, width: 1, background: "var(--line)" }} />
        <div className="selector-item level-summary">
          <TrendingUp color="#2f9d4a" />
          <span>Nível {profile?.level ?? "Intermediário (B1)"}</span>
        </div>
      </div>

      <div className="divider" />

      {!home.practice.practicedToday ? (
        <section className="section practice-reminder" aria-labelledby="practice-reminder-title">
          <IconBubble Icon={BellRing} tone="warning" />
          <div className="row-copy">
            <h2 className="row-title" id="practice-reminder-title">
              {home.practice.streak > 0 ? "Mantenha sua sequência" : "Lembrete de prática"}
            </h2>
            <p className="row-meta">
              {home.practice.streak > 0
                ? "Uma conversa curta hoje preserva seu ritmo de estudos."
                : "Reserve alguns minutos para iniciar sua prática de hoje."}
            </p>
          </div>
          <button
            className="outline-button practice-reminder-action"
            disabled={Boolean(pendingAction)}
            onClick={() => startConversation({ mode: "free_conversation", title: "Conversa livre" })}
            type="button"
          >
            Praticar agora
          </button>
        </section>
      ) : null}

      <section className="section">
        <h2 className="section-title">Qual tema você quer praticar?</h2>
        <div className="topic-card">
          <label className="topic-placeholder">
            <input
              aria-label="Tema para praticar"
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Ex.: viagens, entrevistas, rotina, tecnologia..."
              value={topic}
            />
            <Edit3 />
          </label>
          <button className="outline-button" disabled={pendingAction === "suggest"} onClick={suggestTopic} type="button">
            {pendingAction === "suggest" ? <Loader2 className="spin" /> : <Sparkles color="#2f9d4a" />}
            Sugerir um tema para mim
          </button>
        </div>
        <button
          className="green-button full-button"
          disabled={!topic.trim() || Boolean(pendingAction)}
          onClick={() => startConversation({ title: topic, mode: "custom_topic", source: "user_custom" })}
          style={{ marginTop: 14 }}
          type="button"
        >
          {pendingAction === topic ? <Loader2 className="spin" /> : null}
          Começar com este tema
        </button>
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
      </section>

      <section className="section">
        <div className="top-row">
          <h2 className="section-title" style={{ margin: 0 }}>
            Sugestões para sua prática
          </h2>
          <Link className="link-action" href="/calendario">
            Ver calendário <ArrowRight size={19} />
          </Link>
        </div>
        <div className="row-list" style={{ marginTop: 16 }}>
          {suggestions.length ? suggestions.map((item, index) => {
            const Icon = suggestionIcons[index] ?? MessageCircle;
            const actionKey = item.id ?? item.title;
            return (
              <div className="list-row" key={`${item.id ?? item.title}-${index}`}>
                <IconBubble Icon={Icon} tone={item.tone} />
                <div className="row-copy">
                  <div className="row-title">
                    {item.title} <Pill tone={item.tone}>{item.badge}</Pill>
                  </div>
                  <div className="row-meta">{item.meta}</div>
                </div>
                <button
                  className="outline-button"
                  disabled={Boolean(pendingAction)}
                  onClick={() =>
                    startConversation({
                      topicId: item.id,
                      title: item.title,
                      mode: item.source === "calendar_based" ? "calendar_focus" : item.source === "weak_words" ? "review_words" : "suggested_topic",
                      source: item.source,
                      reason: item.reason
                    })
                  }
                  type="button"
                >
                  {pendingAction === actionKey ? <Loader2 className="spin" /> : null}
                  Começar
                </button>
              </div>
            );
          }) : <div className="empty-state">Conclua uma conversa ou peça uma sugestão da IA para criar seus próximos temas.</div>}
        </div>
        <button className="link-action plain-button" onClick={suggestTopic} style={{ marginTop: 18 }} type="button">
          Ver mais temas sugeridos <ArrowRight size={19} />
        </button>
      </section>

      <section className="section">
        <div className="top-row">
          <h2 className="section-title" style={{ margin: 0 }}>
            Seu feedback recente
          </h2>
          <Link className="link-action" href="/progresso">
            Ver tudo <ArrowRight size={19} />
          </Link>
        </div>
        <div style={{ marginTop: 18 }}>
          <MetricGrid metrics={feedbackMetrics} />
        </div>
      </section>

      <div className="divider" />

      <section className="section">
        <div className="top-row">
          <h2 className="section-title" style={{ margin: 0 }}>
            Suas palavras
          </h2>
          <Link className="link-action" href="/palavras">
            Ver todas <ArrowRight size={19} />
          </Link>
        </div>
        <div className="word-summary" style={{ marginTop: 20 }}>
          <div>
            <div className="word-big">{totalWords}</div>
            <div className="row-meta">palavras usadas</div>
            <div className="row-meta" style={{ color: "var(--primary)" }}>
              ↑+{home.words.weeklyNew} esta semana
            </div>
          </div>
          <div>
            <div className="row-meta">Mais usada recentemente</div>
            <div className="row-title" style={{ color: "var(--primary)" }}>
              {home.words.mostRecent?.displayText || "Sem palavras registradas"}
            </div>
            <div className="row-meta">
              {home.words.mostRecent ? `usada ${home.words.mostRecent.totalUses} vez(es) nas últimas conversas` : "As palavras usadas no chat aparecerão aqui."}
            </div>
            <div className="progress-line">
              <span style={{ width: `${weeklyProgress}%` }} />
            </div>
            <div className="row-meta">
              Meta semanal: {home.words.weeklyNew}/{weeklyGoal} palavras
            </div>
          </div>
        </div>
        <div className="cta-row">
          <button
            className="dark-button"
            disabled={Boolean(pendingAction)}
            onClick={() => startConversation({ mode: "free_conversation", title: "Conversa livre" })}
            type="button"
          >
            {pendingAction === "free_conversation" ? <Loader2 className="spin" /> : <Mic />}
            Iniciar conversa livre
          </button>
          <button
            className="outline-button"
            disabled={Boolean(pendingAction)}
            onClick={() => startConversation({ mode: "free_conversation", title: "Conversa por texto" })}
            type="button"
            aria-label="Digitar conversa"
          >
            <Keyboard />
          </button>
        </div>
      </section>
    </>
  );
}
