import { redirect } from "next/navigation";
import { after } from "next/server";
import { AppShell } from "@/components/AppShell";
import { HomeDashboard } from "@/components/HomeDashboard";
import { getLearningGate } from "@/lib/learning/access";
import { getHomeData } from "@/lib/learning/home";
import { warmKokoroLanguage } from "@/lib/kokoro/cache";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const gate = await getLearningGate();
  if (gate.gate === "onboarding") redirect("/onboarding");
  if (gate.gate === "connections") redirect("/settings/connections");
  const home = await getHomeData();
  if (home.profile?.languageCode) after(() => warmKokoroLanguage(home.profile?.languageCode));

  return (
    <AppShell activeNav="inicio">
      <HomeDashboard home={home} />
    </AppShell>
  );
}
