import { AppShell } from "@/components/AppShell";
import { LoadingScene } from "@/components/LoadingScene";

export default function Loading() {
  return (
    <AppShell activeNav="chat" section="chat">
      <LoadingScene moment="enter" palette="chat" title="Preparando sua conversa" />
    </AppShell>
  );
}
