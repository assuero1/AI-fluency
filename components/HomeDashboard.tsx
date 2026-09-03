"use client";

import {
  BriefcaseBusiness,
  ChevronDown,
  Edit3,
  Laptop,
  Loader2,
  MessageCircle,
  Sparkles,
  TrendingUp
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MilestoneModal } from "./MilestoneModal";
import { HomeTodayCard } from "./HomeTodayCard";
import { PushOptInCard } from "./PushOptInCard";
import { QuestList } from "./QuestList";
import { IconBubble } from "./IconBubble";
import { ConversationSetupDialog, ConfirmedConversationStart, ConversationStartDraft } from "./ConversationSetupDialog";
import { EmptyState } from "./EmptyState";
import { MetricGrid } from "./MetricGrid";
import { Pill } from "./Pill";
import { ScreenHeader } from "./ScreenHeader";
import { SectionHeader } from "./SectionHeader";
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
    activityDays?: Array<{ label: string; date: string; active: boolean }>;
    milestoneToCelebrate?: number | null;
  };
  today?: {
    goalMinutes: number;
    minutesToday: number;
    percent: number;
    complete: boolean;
    weekConversations: number;
    weekConversationGoal: number;
  };
  quests?: Array<{ key: string; title: string; target: number; progress: number; complete: boolean }>;
  completedConversations?: number;
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
  const [milestone, setMilestone] = useState<number | null>(home.practice.milestoneToCelebrate ?? null);
  const [topic, setTopic] = useState("");
  const [suggestions, setSuggestions] = useState(home.suggestions);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startDraft, setStartDraft] = useState<ConversationStartDraft | null>(null);

  const profile = home.profile;
  const languageCode = (profile?.languageCode ?? "en").slice(0, 2).toUpperCase();
  const totalWords = home.words.totalUsed || 0;

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

  async function confirmConversationStart(input: ConfirmedConversationStart) {
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
      setStartDraft(null);
      router.push(data.redirectTo ?? "/chat");
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Erro inesperado ao iniciar conversa.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <>
      <ScreenHeader title={home.user.name ? `Olá, ${home.user.name} 👋` : "Olá 👋"} subtitle="Pronto para praticar hoje?" streak={home.practice.streak} />

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
            <ChevronDown size={20} aria-hidden="true" />
          </span>
        </Link>
        <div aria-hidden="true" className="selector-divider" />
        <div className="selector-item level-summary">
          <TrendingUp aria-hidden="true" size={20} />
          <span>Nível {profile?.level ?? "Intermediário (B1)"}</span>
        </div>
      </div>

      <div className="divider" />

      {home.today ? (
        <HomeTodayCard
          complete={home.today.complete}
          goalMinutes={home.today.goalMinutes}
          minutesToday={home.today.minutesToday}
          onStartPractice={() => setStartDraft({ mode: "free_conversation", title: "Conversa livre" })}
          percent={home.today.percent}
          practicedToday={home.practice.practicedToday}
          streak={home.practice.streak}
          weekConversationGoal={home.today.weekConversationGoal}
          weekConversations={home.today.weekConversations}
        />
      ) : null}

      <QuestList quests={home.quests ?? []} />

      {(home.completedConversations ?? 0) >= 2 ? <PushOptInCard show /> : null}

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
            {pendingAction === "suggest" ? <Loader2 className="spin" /> : <Sparkles />}
            Sugerir um tema para mim
          </button>
        </div>
        <button
          className="green-button full-button mt-4"
          disabled={!topic.trim() || Boolean(pendingAction)}
          onClick={() => setStartDraft({ title: topic, mode: "custom_topic", source: "user_custom" })}
          type="button"
        >
          {pendingAction === topic ? <Loader2 className="spin" /> : null}
          Começar com este tema
        </button>
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
      </section>

      <section className="section">
        <SectionHeader actionHref="/calendario" actionLabel="Ver calendário" title="Sugestões para sua prática" />
        <div className="row-list">
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
                    setStartDraft({
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
          }) : (
            <EmptyState
              Icon={MessageCircle}
              title="Sem sugestões ainda"
              description="Conclua uma conversa ou peça uma sugestão da IA para criar seus próximos temas."
            />
          )}
        </div>
        <button className="link-action plain-button mt-4" onClick={suggestTopic} type="button">
          Ver mais temas <Sparkles aria-hidden="true" size={16} />
        </button>
      </section>

      <section className="section">
        <SectionHeader actionHref="/progresso" actionLabel="Ver tudo" title="Seu feedback recente" />
        <MetricGrid metrics={feedbackMetrics} />
      </section>

      <div className="divider" />

      <section className="section">
        <SectionHeader actionHref="/palavras" actionLabel="Ver tudo" title="Suas palavras" />
        <div className="word-summary mt-4">
          <div>
            <div className="word-big">{totalWords}</div>
            <div className="row-meta">palavras usadas</div>
            <div className="metric-foot">↑+{home.words.weeklyNew} esta semana</div>
          </div>
          <div>
            <div className="row-meta">Mais usada recentemente</div>
            <div className="row-title text-accent">{home.words.mostRecent?.displayText || "Sem palavras registradas"}</div>
            <div className="row-meta">
              {home.words.mostRecent ? `usada ${home.words.mostRecent.totalUses} vezes nas últimas conversas` : "As palavras usadas no chat aparecerão aqui."}
            </div>
          </div>
        </div>
      </section>

      {milestone ? (
        <MilestoneModal
          onAck={() => {
            setMilestone(null);
            void fetch("/api/streak/ack-milestone", { method: "POST" }).catch(() => undefined);
          }}
          streak={milestone}
        />
      ) : null}

      {startDraft ? (
        <ConversationSetupDialog
          busy={Boolean(pendingAction)}
          draft={startDraft}
          onCancel={() => setStartDraft(null)}
          onConfirm={confirmConversationStart}
        />
      ) : null}
    </>
  );
}
