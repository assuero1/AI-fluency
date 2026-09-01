import { BookOpen, Brain, ChevronRight, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { IconBubble } from "@/components/IconBubble";
import { ScreenHeader } from "@/components/ScreenHeader";
import { VoiceButton } from "@/components/VoiceButton";
import { WordPracticeButton } from "@/components/WordPracticeButton";
import { getWordsData, normalizeWordFilter, wordFilters, wordStrengthLabels } from "@/lib/learning/words";

export const dynamic = "force-dynamic";

const filterLabels = {
  all: "Todas",
  recent: "Recentes",
  review: "Revisar",
  corrected: "Corrigidas"
} as const;

type WordsPageProps = {
  searchParams?: Promise<{
    filter?: string;
    q?: string;
    page?: string;
  }>;
};

export default async function WordsPage({ searchParams }: WordsPageProps) {
  const params = await searchParams;
  const filter = normalizeWordFilter(params?.filter);
  const data = await getWordsData(filter, params?.q ?? "", Number(params?.page ?? "1"));
  const progress = Math.max(0, Math.min(100, (data.summary.weeklyNew / Math.max(1, data.summary.weeklyGoal)) * 100));

  return (
    <AppShell activeNav="palavras" section="palavras">
      <ScreenHeader title="Suas palavras" subtitle={`${data.summary.totalWords} palavras salvas`} />
      <Link className="flashcard-entry" href="/palavras/treino">
        <div className="flashcard-entry-icon"><Brain /></div><div className="row-copy"><div className="eyebrow"><Sparkles size={14} /> Revisão inteligente</div><div className="row-title">Treinar com cards</div><div className="row-meta">{data.dailyQueue && data.dailyQueue.dueCount + data.dailyQueue.newCount > 0 ? `Hoje: ${data.dailyQueue.dueCount} revisões + ${data.dailyQueue.newCount} novas` : "Palavras e frases do seu vocabulário"}</div></div><ChevronRight />
      </Link>
      <section className="section">
        <div className="word-summary">
          <div>
            <div className="word-big">{data.summary.totalUses}</div>
            <div className="row-meta">usos em conversas</div>
          </div>
          <div>
            <div className="row-title" style={{ color: "var(--section-text)" }}>
              +{data.summary.weeklyNew}
            </div>
            <div className="row-meta">novas esta semana</div>
            <div className="row-title" style={{ marginTop: 12 }}>
              {data.summary.toReview}
            </div>
            <div className="row-meta">para revisar</div>
          </div>
        </div>
        <div className="progress-line">
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="row-meta">Meta semanal: {data.summary.weeklyNew}/{data.summary.weeklyGoal} novas palavras</div>
      </section>
      <section className="section word-review-states" aria-label="Estados de revisão">
        <div><strong>{data.summary.toReview}</strong><span>para hoje</span></div><div><strong>{data.summary.newWords}</strong><span>novas</span></div><div><strong>{data.summary.learningWords}</strong><span>aprendendo</span></div><div><strong>{data.summary.reviewWords}</strong><span>consolidadas</span></div><div><strong>{data.summary.strongWords}</strong><span>fortes</span></div><div><strong>{data.summary.unusedWords}</strong><span>não usadas</span></div>
      </section>

      <form className="word-search-form" action="/palavras" role="search">
        <Search size={20} />
        <input aria-label="Buscar palavra ou tradução" maxLength={80} name="q" defaultValue={data.query} placeholder="Buscar palavra ou tradução" />
        <input name="filter" type="hidden" value={filter} />
        <button type="submit">Buscar</button>
      </form>

      <nav className="level-pills" aria-label="Filtros de palavras">
        {wordFilters.map((item) => (
          <Link
            className={item === filter ? "pill primary" : "pill"}
            aria-current={item === filter ? "page" : undefined}
            href={buildWordsHref(item, data.query)}
            key={item}
          >
            {filterLabels[item]}
          </Link>
        ))}
        <SlidersHorizontal className="filter-icon" aria-hidden="true" />
      </nav>

      <section className="section row-list">
        {data.words.length > 0 ? (
          data.words.map((word) => (
            <div className="list-row word-row" key={word.id}>
              <IconBubble Icon={BookOpen} tone={word.needsReview ? "warning" : "primary"} />
              <Link className="row-copy word-row-link" href={`/palavras/${word.id}`}>
                <div className="row-title">
                  {word.displayText} <span className="word-use-count">+{word.totalUses}</span> <span className={`word-strength ${word.strengthLevel}`}>{wordStrengthLabels[word.strengthLevel]}</span>
                </div>
                <div className="row-meta">{word.translation}</div>
                <div className="word-row-foot">
                  {word.needsReview ? "Revisar agora" : formatLastUsed(word.lastUsedAt)}
                  {word.correctionCount > 0 ? ` · ${word.correctionCount} correção(ões)` : ""}
                </div>
              </Link>
              <VoiceButton languageCode={data.languageCode} text={word.displayText} label="Ouvir pronúncia" compact />
            </div>
          ))
        ) : (
          <div className="empty-state">
            <BookOpen size={30} />
            <div className="row-title">Nenhuma palavra encontrada</div>
            <div className="row-meta">Use uma conversa para salvar vocabulário novo ou ajuste os filtros.</div>
          </div>
        )}
      </section>
      {data.totalPages > 1 ? (
        <nav aria-label="Paginação de palavras" className="pagination-row">
          {data.page > 1 ? (
            <Link className="outline-button" href={buildWordsHref(filter, data.query, data.page - 1)}>Anterior</Link>
          ) : <span />}
          <span className="row-meta">Página {data.page} de {data.totalPages}</span>
          {data.page < data.totalPages ? (
            <Link className="outline-button" href={buildWordsHref(filter, data.query, data.page + 1)}>Próxima</Link>
          ) : <span />}
        </nav>
      ) : null}
      <WordPracticeButton />
    </AppShell>
  );
}

function buildWordsHref(filter: string, query: string, page?: number) {
  const params = new URLSearchParams({ filter });
  if (query) params.set("q", query);
  if (page && page > 1) params.set("page", String(page));
  return `/palavras?${params.toString()}`;
}

function formatLastUsed(value: string) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "Uso recente";
  const days = Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
  if (days === 0) return "Usada hoje";
  if (days === 1) return "Usada ontem";
  return `Usada há ${days} dias`;
}
