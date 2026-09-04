import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { plura } from "@/lib/plural";
import { CalendarPracticeButton, CalendarTopicButton } from "@/components/CalendarPracticeButton";
import { EmptyState } from "@/components/EmptyState";
import { IconBubble } from "@/components/IconBubble";
import { Pill } from "@/components/Pill";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TalkitoIcon } from "@/components/TalkitoIcon";
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
    <AppShell activeNav="calendario" section="calendario">
      <ScreenHeader title="Calendário" subtitle="Conversas e revisões em um só panorama" />
      <section className="section">
        <div className="calendar-month-nav">
          <Link aria-label="Mês anterior" className="calendar-month-button" href={`/calendario?month=${calendar.previousMonth}`}>
            <TalkitoIcon name="chevron-left" size={18} />
          </Link>
          <div>
            <div className="calendar-month-title">{capitalize(calendar.monthLabel)}</div>
            <div className="calendar-month-meta">
              {plura(calendar.feedbackCount, "feedback")} · {plura(calendar.conversationCount, "conversa")}
              {calendar.streak > 0 ? ` · sequência de ${calendar.streak} ${calendar.streak === 1 ? "dia" : "dias"}` : null}
            </div>
          </div>
          <Link aria-label="Próximo mês" className="calendar-month-button" href={`/calendario?month=${calendar.nextMonth}`}>
            <TalkitoIcon name="chevron-right" size={18} />
          </Link>
        </div>
        <div className="calendar-grid calendar-grid-interactive mt-5">
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
              day.intensity > 0 ? `heat-${day.intensity}` : "",
              isToday ? "today" : ""
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <Link
                aria-current={isToday ? "date" : undefined}
                aria-label={`${formatDate(day.date)}${isToday ? ", hoje" : ""}${day.hasFeedback ? ", com feedback" : ""}${day.flashcardWords ? `, ${plura(day.flashcardWords, "palavra revisada", "palavras revisadas")}` : ""}`}
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
        <div className="calendar-heat-legend" aria-hidden="true">
          menos <span /><span /><span /><span /> mais
        </div>
      </section>

      <section className="section">
        <div className="calendar-feedback-card">
          <div className="top-row"><div><div className="eyebrow">Tempo de treino no mês</div><div className="title">{formatDuration(calendar.totalPracticeSeconds)}</div></div><TalkitoIcon name="clock-timer" size={28} /></div>
          <div className="level-pills"><Pill tone="info">Últimos 7 dias: {formatDuration(calendar.weekPracticeSeconds)}</Pill></div>
          <p className="row-meta">Soma de conversas finalizadas e revisões de flashcards em {calendar.monthLabel}.</p>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Memória de conversas</h2>
        {latestDate ? (
          <div className="card">
            <Link className="settings-row" href={`/calendario/${latestDate}`}>
              <div>
                <div className="row-title">Última prática registrada</div>
                <div className="row-meta">{latestDate}</div>
              </div>
              <TalkitoIcon name="chevron-right" size={18} />
            </Link>
            <CalendarPracticeButton date={latestDate} />
          </div>
        ) : (
          <EmptyState
            talkitoIcon="calendar-desk"
            title="Seu calendário começa com uma conversa"
            description="Ao finalizar uma prática, a IA salva um feedback deste dia aqui."
          />
        )}
      </section>

      <section className="section">
        <h2 className="section-title">Sugerido pela IA</h2>
        <div className="row-list">
          {suggestions.length > 0 ? (
            suggestions.slice(0, 3).map((item, index) => (
              <div className="list-row" key={`${item.title}-${index}`}>
                <IconBubble talkitoIcon={index === 0 ? "target" : "listening-bubble"} tone={index === 0 ? "primary" : "info"} />
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
