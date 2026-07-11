import { ArrowLeft, BookOpen, Target } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { CopyButton } from "@/components/CopyButton";
import { IconBubble } from "@/components/IconBubble";
import { Pill } from "@/components/Pill";
import { VoiceButton } from "@/components/VoiceButton";
import { WordPracticeButton } from "@/components/WordPracticeButton";
import { getWordDetail, wordStrengthLabels } from "@/lib/learning/words";

export const dynamic = "force-dynamic";

type WordDetailPageProps = {
  params: Promise<{ wordId: string }>;
};

export default async function WordDetailPage({ params }: WordDetailPageProps) {
  const { wordId } = await params;
  const data = await getWordDetail(wordId);
  if (!data) notFound();

  const { word } = data;

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
            <Pill>{wordStrengthLabels[word.strengthLevel]} · {word.strengthScore}/100</Pill>
          </div>
        </div>
      </section>

      <section className="section word-detail-metrics">
        <div>
          <strong>{word.totalUses}</strong>
          <span>usos</span>
        </div>
        <div>
          <strong>{word.conversationCount}</strong>
          <span>conversas</span>
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
