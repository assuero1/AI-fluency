import { ArrowLeft, BookOpen, CircleAlert, MessageCircle, Target } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { CopyButton } from "@/components/CopyButton";
import { IconBubble } from "@/components/IconBubble";
import { Pill } from "@/components/Pill";
import { VoiceButton } from "@/components/VoiceButton";
import { WordPracticeButton } from "@/components/WordPracticeButton";
import { getWordDetail } from "@/lib/learning/words";

export const dynamic = "force-dynamic";

type WordDetailPageProps = {
  params: Promise<{ wordId: string }>;
};

export default async function WordDetailPage({ params }: WordDetailPageProps) {
  const { wordId } = await params;
  const data = await getWordDetail(wordId);
  if (!data) notFound();

  const { word, occurrences } = data;

  return (
    <AppShell activeNav="palavras">
      <Link className="back-link" href="/palavras">
        <ArrowLeft /> Todas as palavras
      </Link>

      <section className="word-detail-hero">
        <IconBubble Icon={BookOpen} tone={word.needsReview ? "warning" : "primary"} />
        <div className="row-copy">
          <h1 className="title">{word.displayText}</h1>
          <p className="subtitle">{word.translation}</p>
          <div className="level-pills">
            {word.partOfSpeech ? <Pill>{word.partOfSpeech}</Pill> : null}
            <Pill tone={word.needsReview ? "warning" : "primary"}>{word.needsReview ? "Revisar agora" : "Em prática"}</Pill>
          </div>
        </div>
      </section>

      <section className="section word-detail-metrics">
        <div>
          <strong>{word.totalUses}</strong>
          <span>usos</span>
        </div>
        <div>
          <strong>{word.occurrenceCount}</strong>
          <span>contextos</span>
        </div>
        <div>
          <strong>{word.correctionCount}</strong>
          <span>correções</span>
        </div>
      </section>

      <div className="word-detail-actions">
        <VoiceButton languageCode={data.languageCode} text={word.displayText} label="Ouvir pronúncia" />
        <CopyButton label="Copiar palavra" text={word.displayText} />
      </div>

      <section className="section">
        <h2 className="section-title">Como você usou</h2>
        <div className="occurrence-list">
          {occurrences.length > 0 ? (
            occurrences.map((occurrence) => (
              <article className={occurrence.corrections.length ? "occurrence-card has-correction" : "occurrence-card"} key={occurrence.id}>
                <div className="occurrence-topline">
                  <span>{formatOccurrenceDate(occurrence.createdAt)}</span>
                  <span>{occurrence.topicTitle}</span>
                </div>
                <p className="occurrence-context">{occurrence.sentenceContext || occurrence.usedText}</p>
                <CopyButton label="Copiar exemplo" text={occurrence.sentenceContext || occurrence.usedText} />
                {occurrence.corrections.map((correction) => (
                  <div className="occurrence-correction" key={correction.id}>
                    <CircleAlert size={18} />
                    <span>
                      <s>{correction.originalText}</s> → <strong>{correction.correctedText}</strong>
                    </span>
                  </div>
                ))}
                <div className="occurrence-source">
                  <MessageCircle size={16} /> {occurrence.conversationTitle}
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <MessageCircle size={30} />
              <div className="row-meta">O contexto de uso aparecerá após a próxima conversa.</div>
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="practice-tip">
          <Target />
          <div>
            <div className="row-title">Use “{word.displayText}” numa conversa</div>
            <div className="row-meta">A IA cria situações para você aplicar a palavra naturalmente.</div>
          </div>
        </div>
      </section>
      <WordPracticeButton wordId={word.id} />
    </AppShell>
  );
}

function formatOccurrenceDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Conversa recente";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date);
}
