import { BarChart3, Check, CircleAlert, Flame, MessageCircle, Target, TrendingUp } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { FocusPracticeButton } from "@/components/FocusPracticeButton";
import { IconBubble } from "@/components/IconBubble";
import { ListRow } from "@/components/ListRow";
import { MetricGrid } from "@/components/MetricGrid";
import { Pill } from "@/components/Pill";
import { ScreenHeader } from "@/components/ScreenHeader";
import { getProgressData } from "@/lib/learning/progress";
import { formatPracticeStreak } from "@/lib/learning/practice-activity";

export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  const progress = await getProgressData();
  const metrics = [
    {
      value: progress.metrics.correctionScore ? `${progress.metrics.correctionScore}/10` : "—",
      label: "Correções aplicadas",
      foot: `${progress.profile.monthlyConversations} sessão(ões) neste mês`,
      icon: Check,
      tone: "primary" as const
    },
    {
      value: String(progress.metrics.recurringErrors),
      label: "Erros recorrentes",
      foot: "últimos 30 dias",
      icon: CircleAlert,
      tone: "warning" as const
    },
    {
      value: `+${progress.metrics.newWordsMonth}`,
      label: "Palavras este mês",
      foot: "capturadas no chat",
      icon: TrendingUp,
      tone: "info" as const
    }
  ];
  const monthlyFluency = progress.profile.monthlyFluency;
  const fluencyLabel = progress.profile.fluencyChange === null
    ? monthlyFluency
      ? `${monthlyFluency}/10 de fluidez recente`
      : "Conclua uma conversa para medir"
    : `${progress.profile.fluencyChange >= 0 ? "+" : ""}${progress.profile.fluencyChange}% de fluidez neste mês`;

  return (
    <AppShell>
      <ScreenHeader title="Progresso" subtitle="Seu panorama de fluência" streak={progress.streak} />
      <section className="section">
        <div className="progress-level-card">
          <div className="word-big" style={{ color: "var(--primary)" }}>
            {shortLevel(progress.profile.level)}
          </div>
          <div className="row-title">{progress.profile.level}</div>
          <div className="row-meta">{progress.profile.languageName} · {fluencyLabel}</div>
          <div className="progress-line">
            <span style={{ width: `${progress.profile.levelProgress}%` }} />
          </div>
        </div>
      </section>

      <section className="section">
        <MetricGrid metrics={metrics} />
      </section>

      <section className="section">
        <h2 className="section-title">Pontos fortes</h2>
        <div className="row-list">
          {progress.strengths.map((item, index) => (
            <ListRow
              Icon={index === 0 ? Check : index === 1 ? MessageCircle : BarChart3}
              key={item.title}
              meta={item.meta}
              title={item.title}
              tone={item.tone}
            />
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Foco da semana</h2>
        <div className="progress-focus-card">
          <div className="top-row">
            <Target color="#2f9d4a" />
            <Pill tone="primary">recomendado</Pill>
          </div>
          <div className="row-title" style={{ marginTop: 16 }}>
            {progress.focus.title}
          </div>
          <p className="row-meta">{progress.focus.detail}</p>
          <FocusPracticeButton />
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Erros que se repetem</h2>
        <div className="row-list">
          {progress.errors.length > 0 ? (
            progress.errors.slice(0, 3).map((error) => (
              <div className="list-row progress-error-row" key={error.type}>
                <IconBubble Icon={CircleAlert} tone="warning" />
                <div className="row-copy">
                  <div className="row-title">{formatErrorLabel(error.type)}</div>
                  <div className="row-meta">
                    {error.count} ocorrência(s) recente(s)
                    {error.example ? ` · “${error.example.original}” → “${error.example.corrected}”` : ""}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="row-meta">As correções das próximas conversas vão revelar padrões aqui.</div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="top-row">
          <h2 className="section-title" style={{ margin: 0 }}>
            Sequência
          </h2>
          <Pill tone="primary">
            <Flame size={16} /> {formatPracticeStreak(progress.streak)}
          </Pill>
        </div>
        <div className="level-pills" aria-label="Atividade dos últimos sete dias" role="list">
          {progress.activityDays.map((day) => (
            <Pill
              aria-label={`${formatActivityDate(day.date)}: ${day.active ? "prática concluída" : "sem prática"}`}
              key={day.date}
              role="listitem"
              tone={day.active ? "primary" : "default"}
            >
              {day.label}
            </Pill>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

function shortLevel(level: string) {
  return level.match(/[ABC][12]/)?.[0] ?? level.slice(0, 2).toUpperCase();
}

function formatActivityDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(value));
}

function formatErrorLabel(type: string) {
  const labels: Record<string, string> = {
    grammar: "Gramática",
    vocabulary: "Vocabulário",
    pronunciation: "Pronúncia",
    tense: "Tempos verbais",
    preposition: "Preposições",
    word_order: "Ordem das palavras",
    naturalness: "Naturalidade",
    spelling: "Ortografia"
  };
  return labels[type] ?? type;
}
