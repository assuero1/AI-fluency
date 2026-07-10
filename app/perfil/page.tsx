import { AppShell } from "@/components/AppShell";
import { ProfilePreferences } from "@/components/ProfilePreferences";
import { ScreenHeader } from "@/components/ScreenHeader";
import { getProfileSettings } from "@/lib/learning/account";
import { getProgressData } from "@/lib/learning/progress";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const [profile, progress] = await Promise.all([getProfileSettings(), getProgressData()]);

  return (
    <AppShell activeNav="perfil">
      <ScreenHeader title="Perfil" subtitle="Preferências da sua IA" />
      <ProfilePreferences initial={profile} streak={progress.streak} />
    </AppShell>
  );
}
