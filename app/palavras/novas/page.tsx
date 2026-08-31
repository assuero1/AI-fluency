import { AppShell } from "@/components/AppShell";
import { NewWordsTrainer } from "@/components/NewWordsTrainer";

export const dynamic = "force-dynamic";

export default function NewWordsPracticePage() {
  return <AppShell activeNav="palavras" section="palavras" noNav><NewWordsTrainer /></AppShell>;
}
