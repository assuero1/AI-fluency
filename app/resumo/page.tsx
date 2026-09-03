import { BookOpen, Check, Clock, MessageCircle, MessageSquareOff } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { IconBubble } from "@/components/IconBubble";
import { ListRow } from "@/components/ListRow";
import { MetricGrid } from "@/components/MetricGrid";
import { ResumoConfetti } from "@/components/ResumoConfetti";
import { ResumoPracticeCta } from "@/components/ResumoPracticeCta";
import { ScreenHeader } from "@/components/ScreenHeader";
import { LearningStateError } from "@/lib/learning/access";
import { getConversationSummary } from "@/lib/learning/feedback";
import { formatSavedWordMeta } from "@/lib/learning/vocabulary-picker-ui";
import { VocabularyPicker } from "@/components/VocabularyPicker";

export const dynamic = "force-dynamic";

type SummaryPageProps = {
  searchParams?: Promise<{
    conversationId?: string;
  }>;
};

export default async function SummaryPage({ searchParams }: SummaryPageProps) {
  const params = await searchParams;
  const conversationId = params?.conversationId;

  if (!conversationId) {
    return <SummaryUnavailable message="Finalize uma conversa para gerar um resumo com dados reais da sua prática." />;
  }

  let data: Awaited<ReturnType<typeof getConversationSummary>>;
  try {
    data = await getConversationSummary(conversationId);
  } catch (error) {
    if (error instanceof LearningStateError && (error.status === 404 || error.status === 409)) {
      return <SummaryUnavailable message={error.message} />;
    }
    throw error;
  }

  const feedback = data.dailyFeedback;
  const duration = Math.max(1, Math.round(Number(data.conversation.fields.duration_seconds) / 60));
  const words = data.words.slice(0, 5);
  const correctionsCount = data.corrections.length;
  const topicTitle = data.topicTitle;
  const learnerName = data.user.fields.Name?.trim() || data.user.fields.name?.trim() || "Você";
  const metrics = [
    {
      value: `${feedback.fields.correction_score}/10`,
      label: "Correções aplicadas",
      icon: Check,
      tone: "primary" as const
    },
    {
      value: `+${feedback.fields.new_words_count}`,
      label: "Novas palavras",
      icon: MessageCircle,
      tone: "info" as const
    },
    {
      value: String(correctionsCount),
      label: "Erros recorrentes",
      icon: Clock,
      tone: "warning" as const
    },
    {
      value: String(data.unusedWordCount),
      label: "Nunca usadas",
      icon: BookOpen,
      tone: "info" as const
    }
  ];

  return (
    <AppShell activeNav="chat" section="chat">
      <ResumoConfetti />
      <ScreenHeader title="Conversa finalizada" subtitle={`${duration} min · Feedback salvo no calendário`} />
      <section className="section">
        <div className="choice-card active pop-in">
          <IconBubble Icon={Check} />
          <div>
            <div className="row-title">Muito bem, {learnerName}!</div>
            <div className="row-meta">{topicTitle}</div>
          </div>
        </div>
      </section>
      <section className="section">
        <MetricGrid metrics={metrics} />
      </section>
      <section className="section">
        <h2 className="section-title">Feedback de hoje</h2>
        <div className="soft-card">
          <p className="card-copy">{feedback.fields.strengths}</p>
          <p className="card-copy mt-3">{feedback.fields.recommended_focus}</p>
        </div>
      </section>
      <VocabularyPicker conversationId={conversationId} />
      <section className="section">
        <h2 className="section-title">Já salvas desta conversa</h2>
        <div className="row-list">
          {words.length > 0 ? (
            words.map((word) => (
              <ListRow
                key={word.id}
                title={word.fields.display_text || word.fields.lemma}
                meta={formatSavedWordMeta(word, data.wordSensesUsage)}
                Icon={MessageCircle}
                tone="primary"
              />
            ))
          ) : (
            <div className="row-meta">Nenhuma palavra nova foi capturada nessa conversa.</div>
          )}
        </div>
      </section>
      {words.length > 0 ? (
        <section className="section">
          <ResumoPracticeCta wordIds={data.words.map((word) => word.id)} />
        </section>
      ) : null}
      <div className="choice-list">
        <Link className="outline-button full-button" href="/calendario">
          Ver no calendário
        </Link>
      </div>
    </AppShell>
  );
}

function SummaryUnavailable({ message }: { message: string }) {
  return (
    <AppShell activeNav="chat" section="chat">
      <section className="section empty-state summary-unavailable">
        <IconBubble Icon={MessageSquareOff} tone="info" />
        <h1 className="title">Resumo indisponível</h1>
        <p className="row-meta">{message}</p>
        <div className="choice-list summary-unavailable-actions">
          <Link className="green-button full-button" href="/">
            Escolher um tema
          </Link>
          <Link className="outline-button full-button" href="/chat">
            Voltar ao chat
          </Link>
        </div>
      </section>
    </AppShell>
  );
}
