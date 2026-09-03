import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ChatConversation } from "@/components/ChatConversation";
import { EmptyState } from "@/components/EmptyState";
import { getConversationWithTutorStart } from "@/lib/learning/conversations";
import { getLearningGate } from "@/lib/learning/access";
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
  if (gate.gate === "login") redirect("/login");
  if (gate.gate === "onboarding") redirect("/onboarding");
  if (gate.gate === "connections") redirect("/settings/connections");
  const context = await getConversationWithTutorStart(params?.conversationId);

  if (!context) {
    return (
      <AppShell activeNav="chat" section="chat">
        <section className="section">
          <EmptyState
            Icon={MessageCircle}
            title="Nenhuma conversa em andamento"
            description="Escolha um tema ou inicie uma conversa livre para começar a praticar."
          >
            <Link className="green-button" href="/">
              Escolher um tema
            </Link>
          </EmptyState>
        </section>
      </AppShell>
    );
  }

  const isActiveTraining = context.conversation.fields.status === "active";

  return (
    <AppShell activeNav="chat" noNav={isActiveTraining} section="chat">
      <ChatConversation
        corrections={context.corrections}
        conversation={context.conversation}
        audioEnabled={true}
        speechLanguage={context.profile?.fields.language_code}
        messages={context.messages}
        transcriptEnabled={Boolean(context.profile?.fields.transcript_enabled)}
        topicTitle={context.topicTitle}
        readOnly={!isActiveTraining}
      />
    </AppShell>
  );
}
