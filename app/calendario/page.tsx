import { CalendarDays, ChevronLeft, ChevronRight, Clock3, MessageCircle, Target } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { CalendarPracticeButton, CalendarTopicButton } from "@/components/CalendarPracticeButton";
import { IconBubble } from "@/components/IconBubble";
import { Pill } from "@/components/Pill";
import { ScreenHeader } from "@/components/ScreenHeader";
import { getCalendarData } from "@/lib/learning/feedback";

export const dynamic = "force-dynamic";

type CalendarPageProps = {
  searchParams?: Promise<{ month?: string }>;
};

const weekdayLabels = ["D", "S", "T", "Q", "Q", "S", "S"];

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const params = await searchParams;
  const calendar = await getCalendarData(params?.month);
  const latest = calendar.latestFeedback;
  const latestDate = latest ? toDateKey(latest.fields.date) : "";
  const suggestions = calendar.suggestedTopics;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <AppShell activeNav="calendario">
      <ScreenHeader title="Calendário" subtitle="Conversas e revisões em um só panorama" />
      <section className="section">
        <div className="calendar-month-nav">
          <Link aria-label="Mês anterior" className="calendar-month-button" href={`/calendario?month=${calendar.previousMonth}`}>
            <ChevronLeft />
          </Link>
          <div>
            <div className="calendar-month-title">{capitalize(calendar.monthLabel)}</div>
            <div className="calendar-month-meta">{calendar.feedbackCount} feedback(s) · {calendar.conversationCount} conversa(s)</div>
          </div>
          <Link aria-label="Próximo mês" className="calendar-month-button" href={`/calendario?month=${calendar.nextMonth}`}>
            <ChevronRight />
          </Link>
        </div>
        <div className="calendar-grid calendar-grid-interactive" style={{ marginTop: 22 }}>
          {weekdayLabels.map((day, index) => (
            <div className="calendar-weekday" key={`${day}-${index}`}>
              {day}
            </div>
          ))}
          {Array.from({ length: calendar.firstWeekday }, (_, index) => (
            <div className="calendar-empty" key={`empty-${index}`} />
          ))}
          {calendar.days.map((day) => {
            const isToday = day.date === today;
            const className = [
              "calendar-day",
              day.hasFeedback || day.flashcardWords > 0 ? "has-note" : "",
              isToday ? "today" : ""
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <Link
                aria-current={isToday ? "date" : undefined}
                aria-label={`${formatDate(day.date)}${isToday ? ", hoje" : ""}${day.hasFeedback ? ", com feedback" : ""}${day.flashcardWords ? `, ${day.flashcardWords} palavra(s) revisada(s)` : ""}`}
                className={className}
                href={`/calendario/${day.date}`}
                key={day.date}
              >
                {day.day}
                {day.hasFeedback || day.flashcardWords ? <span className="calendar-note-dot" aria-hidden="true" /> : null}
              </Link>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="calendar-feedback-card">
          <div className="top-row"><div><div className="eyebrow">Tempo de treino no mês</div><div className="title">{formatDuration(calendar.totalPracticeSeconds)}</div></div><Clock3 color="#2f9d4a" size={30} /></div>
          <div className="level-pills"><Pill tone="info">Últimos 7 dias: {formatDuration(calendar.weekPracticeSeconds)}</Pill></div>
          <p className="row-meta">Soma de conversas finalizadas e revisões de flashcards em {calendar.monthLabel}.</p>
        </div>
      </section>

      <section className="section">
        <div className="top-row">
          <h2 className="section-title" style={{ margin: 0 }}>
            Último feedback
          </h2>
          <CalendarDays color="#2f9d4a" />
        </div>
        {latest ? (
          <div className="calendar-feedback-card">
            <Link href={`/calendario/${latestDate}`}>
              <div className="calendar-feedback-date">{formatDate(latestDate)}</div>
              <div className="row-title">{latest.fields.strengths}</div>
              <p className="row-meta">{latest.fields.recommended_focus}</p>
              <div className="level-pills">
                <Pill tone="primary">{latest.fields.correction_score}/10 correções</Pill>
                <Pill tone="info">{latest.fields.new_words_count} palavras</Pill>
              </div>
            </Link>
            <CalendarPracticeButton date={latestDate} />
          </div>
        ) : (
          <div className="empty-state">
            <CalendarDays size={30} />
            <div className="row-title">Seu calendário começa com uma conversa</div>
            <div className="row-meta">Ao finalizar uma prática, a IA salva um feedback deste dia aqui.</div>
          </div>
        )}
      </section>

      <section className="section">
        <h2 className="section-title">Sugerido pela IA</h2>
        <div className="row-list">
          {suggestions.length > 0 ? (
            suggestions.slice(0, 3).map((item, index) => (
              <div className="list-row" key={`${item.title}-${index}`}>
                <IconBubble Icon={index === 0 ? Target : MessageCircle} tone={index === 0 ? "primary" : "info"} />
                <div className="row-copy">
                  <div className="row-title">{item.title}</div>
                  <div className="row-meta">{item.reason}</div>
                </div>
                <CalendarTopicButton reason={item.reason} title={item.title} />
              </div>
            ))
          ) : (
            <div className="row-meta">A IA sugerirá próximos temas quando houver um feedback salvo.</div>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function capitalize(value: string) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(value));
}

function toDateKey(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toISOString().slice(0, 10);
}

function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}min`;
}
