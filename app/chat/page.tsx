import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ChatConversation } from "@/components/ChatConversation";
import { getConversationWithTutorStart } from "@/lib/learning/conversations";
import { getLearningGate } from "@/lib/learning/access";
import { getProgressData } from "@/lib/learning/progress";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type ChatPageProps = {
  searchParams?: Promise<{
    conversationId?: string;
  }>;
};

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const params = await searchParams;
  const gate = await getLearningGate();
  if (gate.gate === "onboarding") redirect("/onboarding");
  if (gate.gate === "connections") redirect("/settings/connections");
  const [context, progress] = await Promise.all([
    getConversationWithTutorStart(params?.conversationId),
    getProgressData()
  ]);

  if (!context) {
    return (
      <AppShell activeNav="chat">
        <section className="section empty-state">
          <div className="row-title">Nenhuma conversa em andamento</div>
          <div className="row-meta">Escolha um tema ou inicie uma conversa livre para começar a praticar.</div>
          <Link className="dark-button" href="/">
            Escolher um tema
          </Link>
        </section>
      </AppShell>
    );
  }

  const isActiveTraining = context.conversation.fields.status === "active";

  return (
    <AppShell activeNav="chat" noNav={isActiveTraining}>
      <ChatConversation
        corrections={context.corrections}
        conversation={context.conversation}
        audioEnabled={Boolean(context.profile?.fields.audio_enabled)}
        speechLanguage={context.profile?.fields.language_code}
        messages={context.messages}
        transcriptEnabled={Boolean(context.profile?.fields.transcript_enabled)}
        topicTitle={context.topicTitle}
        readOnly={!isActiveTraining}
        streak={progress.streak}
      />
    </AppShell>
  );
}
