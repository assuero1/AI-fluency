import { ArrowLeft, CalendarDays, Check, Clock3, MessageCircle, Target } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { CalendarPracticeButton, CalendarTopicButton } from "@/components/CalendarPracticeButton";
import { IconBubble } from "@/components/IconBubble";
import { Pill } from "@/components/Pill";
import { getDailyFeedback } from "@/lib/learning/feedback";

export const dynamic = "force-dynamic";

type CalendarDetailPageProps = {
  params: Promise<{ date: string }>;
};

export default async function CalendarDetailPage({ params }: CalendarDetailPageProps) {
  const { date } = await params;
  const detail = await getDailyFeedback(date);
  if (!detail) notFound();

  const { feedback, completedConversations, recurringErrors, suggestedTopics } = detail;
  const month = date.slice(0, 7);

  return (
    <AppShell activeNav="calendario">
      <Link className="back-link" href={`/calendario?month=${month}`}>
        <ArrowLeft /> Calendário
      </Link>
      <section className="calendar-detail-heading">
        <IconBubble Icon={CalendarDays} tone="primary" />
        <div>
          <h1 className="title">{formatLongDate(date)}</h1>
          <p className="subtitle">Memória da sua prática</p>
        </div>
      </section>

      {feedback ? (
        <>
          <section className="section calendar-score-grid">
            <div>
              <Check />
              <strong>{feedback.fields.correction_score}/10</strong>
              <span>correções</span>
            </div>
            <div>
              <Target />
              <strong>{feedback.fields.fluency_score}/10</strong>
              <span>fluência</span>
            </div>
            <div>
              <MessageCircle />
              <strong>+{feedback.fields.new_words_count}</strong>
              <span>palavras</span>
            </div>
          </section>

          <section className="section">
            <h2 className="section-title">O que a IA observou</h2>
            <div className="calendar-observation-card">
              <div className="row-title">{feedback.fields.strengths}</div>
              <p className="row-meta">{feedback.fields.weaknesses}</p>
              <div className="calendar-focus-line">
                <Target size={20} />
                <span>{feedback.fields.recommended_focus}</span>
              </div>
              <div className="level-pills">
                {recurringErrors.map((error) => (
                  <Pill key={error} tone="warning">
                    {error}
                  </Pill>
                ))}
                {recurringErrors.length === 0 ? <Pill tone="primary">bom ritmo</Pill> : null}
              </div>
            </div>
          </section>

          <CalendarPracticeButton date={date} />
        </>
      ) : (
        <section className="section empty-state">
          <CalendarDays size={32} />
          <div className="row-title">Nenhum feedback salvo neste dia</div>
          <div className="row-meta">As conversas finalizadas geram uma memória pedagógica no calendário.</div>
        </section>
      )}

      <section className="section">
        <h2 className="section-title">Conversas deste dia</h2>
        <div className="row-list">
          {completedConversations.length > 0 ? (
            completedConversations.map((conversation) => (
              <div className="list-row" key={conversation.id}>
                <IconBubble Icon={MessageCircle} tone="info" />
                <div className="row-copy">
                  <div className="row-title">{conversation.title}</div>
                  <div className="row-meta">{conversation.summary}</div>
                </div>
                <Pill>
                  <Clock3 size={15} /> {Math.max(1, Math.round(conversation.durationSeconds / 60))} min
                </Pill>
              </div>
            ))
          ) : (
            <div className="row-meta">Nenhuma conversa finalizada foi encontrada neste dia.</div>
          )}
        </div>
      </section>

      {suggestedTopics.length > 0 ? (
        <section className="section">
          <h2 className="section-title">Continue a partir daqui</h2>
          <div className="row-list">
            {suggestedTopics.slice(0, 3).map((item, index) => (
              <div className="list-row" key={`${item.title}-${index}`}>
                <IconBubble Icon={index === 0 ? Target : MessageCircle} tone={index === 0 ? "primary" : "info"} />
                <div className="row-copy">
                  <div className="row-title">{item.title}</div>
                  <div className="row-meta">{item.reason}</div>
                </div>
                <CalendarTopicButton reason={item.reason} title={item.title} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </AppShell>
  );
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00Z`)
  );
}
