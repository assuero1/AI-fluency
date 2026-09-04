import { BarChart3, Check, MessageCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { plura } from "@/lib/plural";
import { FocusPracticeButton } from "@/components/FocusPracticeButton";
import { IconBubble } from "@/components/IconBubble";
import { ListRow } from "@/components/ListRow";
import { MetricGrid } from "@/components/MetricGrid";
import { Pill } from "@/components/Pill";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TalkitoIcon } from "@/components/TalkitoIcon";
import { getProgressData } from "@/lib/learning/progress";
import { MiniChart } from "@/components/MiniChart";

export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  const progress = await getProgressData();
  const metrics = [
    {
      value: progress.metrics.correctionScore ? `${progress.metrics.correctionScore}/10` : "—",
      label: "Correções aplicadas",
      foot: plura(progress.profile.monthlyConversations, "sessão neste mês", "sessões neste mês"),
      talkitoIcon: "check-stamp" as const,
      tone: "primary" as const
    },
    {
      value: String(progress.metrics.flashcardWords),
      label: "Palavras revisadas",
      foot: `${progress.metrics.flashcardMinutes} min em cards`,
      talkitoIcon: "check-stamp" as const,
      tone: "warning" as const
    },
    {
      value: String(progress.metrics.consolidatedWords),
      label: "Consolidadas",
      foot: `${progress.metrics.difficultWords} difíceis · ${progress.metrics.recoveredWords} recuperadas`,
      talkitoIcon: "growth-stairs" as const,
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
    <AppShell section="progresso">
      <ScreenHeader title="Progresso" subtitle="Seu panorama de fluência" streak={progress.streak} />
      <section className="section">
        <div className="progress-level-card">
          <div className="top-row">
            <div>
              <div className="word-big text-accent">
                {shortLevel(progress.profile.level)}
              </div>
              <div className="row-title">{longLevel(progress.profile.level)}</div>
            </div>
            <Pill tone="primary">{progress.profile.xpTotal} XP</Pill>
          </div>
          <div className="row-meta">{progress.profile.languageName} · {fluencyLabel}</div>
          <div className="progress-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.profile.levelDetail.percent} aria-label={`${progress.profile.levelDetail.percent}% rumo a ${progress.profile.levelDetail.label}`}>
            <span style={{ width: `${progress.profile.levelDetail.percent}%` }} />
          </div>
          {progress.profile.levelDetail.missing ? (
            <>
              <div className="row-meta">{progress.profile.levelDetail.missing}</div>
              <div className="row-meta">Próximo nível: {progress.profile.levelDetail.label} ({progress.profile.levelDetail.code})</div>
            </>
          ) : (
            <div className="row-meta text-accent">Nível conquistado!</div>
          )}
        </div>
      </section>

      <section className="section">
        <MetricGrid metrics={metrics} />
      </section>

      {progress.charts.fluency.length > 1 ? (
        <section className="section">
          <h2 className="section-title">Fluidez — últimos feedbacks</h2>
          <MiniChart
            ariaLabel={`Gráfico de fluência dos últimos ${progress.charts.fluency.length} feedbacks`}
            labels={progress.charts.fluency.map((point) => point.date)}
            tone="primary"
            values={progress.charts.fluency.map((point) => point.value)}
          />
        </section>
      ) : null}
      {progress.charts.weeklyWords.some((week) => week.value > 0) ? (
        <section className="section">
          <h2 className="section-title">Palavras novas por semana</h2>
          <MiniChart
            ariaLabel="Palavras novas por semana nas últimas 8 semanas"
            labels={progress.charts.weeklyWords.map((week) => week.label)}
            tone="info"
            values={progress.charts.weeklyWords.map((week) => week.value)}
          />
        </section>
      ) : null}

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
            <TalkitoIcon name="target" size={24} />
            <Pill tone="primary">recomendado</Pill>
          </div>
          <div className="row-title mt-4">
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
                <IconBubble talkitoIcon="alert-badge" tone="warning" />
                <div className="row-copy">
                  <div className="row-title">{formatErrorLabel(error.type)}</div>
                  <div className="row-meta">
                    {plura(error.count, "ocorrência recente", "ocorrências recentes")}
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
        <h2 className="section-title">Sequência</h2>
        <div className="level-pills" aria-label="Atividade desta semana" role="list">
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

function longLevel(level: string) {
  return level.replace(/\s*\([ABC][12]\)/, "");
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
