import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BackButton } from "@/components/BackButton";
import { CopyButton } from "@/components/CopyButton";
import { IconBubble } from "@/components/IconBubble";
import { MetricGrid } from "@/components/MetricGrid";
import { Pill } from "@/components/Pill";
import { TalkitoIcon } from "@/components/TalkitoIcon";
import { VoiceButton } from "@/components/VoiceButton";
import { WordPracticeButton } from "@/components/WordPracticeButton";
import { WordSensesSection } from "@/components/WordSensesSection";
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
    <AppShell activeNav="palavras" section="palavras">
      <BackButton href="/palavras" label="Voltar às palavras" />

      <section className="word-detail-hero">
        <IconBubble talkitoIcon="book-open" tone={word.needsReview ? "warning" : "primary"} />
        <div className="row-copy">
          <h1 className="title">{word.displayText}</h1>
          <p className="subtitle">{word.translation}</p>
          <div className="level-pills">
            {word.partOfSpeech ? <Pill>{word.partOfSpeech}</Pill> : null}
            <Pill tone={word.needsReview ? "warning" : "primary"}>{word.needsReview ? "Revisar agora" : "Em prática"}</Pill>
          </div>
          <p className="row-meta">{wordStrengthLabels[word.strengthLevel]} · domínio {word.strengthScore}/100</p>
        </div>
      </section>

      <section className="section">
        <MetricGrid
          bordered
          metrics={[
            { value: String(word.totalUses), label: "usos" },
            { value: String(word.conversationCount), label: "conversas" },
            { value: String(word.correctionCount), label: "correções" }
          ]}
        />
      </section>

      <div className="word-detail-actions">
        <VoiceButton languageCode={data.languageCode} text={word.displayText} label="Ouvir pronúncia" />
        <CopyButton label="Copiar palavra" text={word.displayText} />
      </div>

      <WordSensesSection senses={data.senses} wordId={word.id} />

      <section className="section">
        <div className="practice-tip">
          <TalkitoIcon name="target" size={24} />
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
