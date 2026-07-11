import { AppShell } from "@/components/AppShell";
import { FlashcardTrainer } from "@/components/FlashcardTrainer";

export const dynamic = "force-dynamic";

export default function FlashcardPracticePage() {
  return <AppShell activeNav="palavras"><FlashcardTrainer /></AppShell>;
}
