import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BackButton } from "@/components/BackButton";
import { CalendarPracticeButton, CalendarTopicButton } from "@/components/CalendarPracticeButton";
import { EmptyState } from "@/components/EmptyState";
import { IconBubble } from "@/components/IconBubble";
import { MetricGrid } from "@/components/MetricGrid";
import { Pill } from "@/components/Pill";
import { TalkitoIcon } from "@/components/TalkitoIcon";
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
    <AppShell activeNav="calendario" section="calendario">
      <BackButton href={`/calendario?month=${month}`} label="Voltar ao calendário" />
      <section className="calendar-detail-heading">
        <IconBubble talkitoIcon="calendar-desk" tone="primary" />
        <div>
          <h1 className="title">{formatLongDate(date)}</h1>
          <p className="subtitle">Memória da sua prática</p>
        </div>
      </section>

      {feedback ? (
        <>
          <section className="section">
            <MetricGrid
              bordered
              metrics={[
                { value: `${feedback.fields.correction_score}/10`, label: "correções" },
                { value: `${feedback.fields.fluency_score}/10`, label: "fluência" },
                { value: `+${feedback.fields.new_words_count}`, label: "palavras" }
              ]}
            />
          </section>

          <section className="section">
            <h2 className="section-title">O que a IA observou</h2>
            <div className="card card-soft">
              <p className="card-copy">{feedback.fields.strengths}</p>
              <p className="row-meta">{feedback.fields.weaknesses}</p>
              <div className="calendar-focus-line">
                <TalkitoIcon name="target" size={20} />
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
        <section className="section">
          <EmptyState
            talkitoIcon="calendar-desk"
            title="Nenhum feedback salvo neste dia"
            description="As conversas finalizadas geram uma memória pedagógica no calendário."
          />
        </section>
      )}

      <section className="section">
        <h2 className="section-title">Conversas deste dia</h2>
        <div className="row-list">
          {completedConversations.length > 0 ? (
            completedConversations.map((conversation) => (
              <div className="list-row" key={conversation.id}>
                <IconBubble talkitoIcon="listening-bubble" tone="info" />
                <div className="row-copy">
                  <div className="row-title">{conversation.title}</div>
                  <div className="row-meta">{conversation.summary}</div>
                </div>
                <Pill>
                  <TalkitoIcon name="clock-timer" size={16} /> {Math.max(1, Math.round(conversation.durationSeconds / 60))} min
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
                <IconBubble talkitoIcon={index === 0 ? "target" : "listening-bubble"} tone={index === 0 ? "primary" : "info"} />
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
