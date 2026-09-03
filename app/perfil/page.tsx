import Link from "next/link";
import { CalendarDays, Trophy } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { LogoutButton } from "@/components/LogoutButton";
import { ProfilePreferences } from "@/components/ProfilePreferences";
import { ScreenHeader } from "@/components/ScreenHeader";
import { getProfileSettings } from "@/lib/learning/account";
import { getProgressData } from "@/lib/learning/progress";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const [profile, progress] = await Promise.all([getProfileSettings(), getProgressData()]);

  return (
    <AppShell activeNav="perfil" section="neutral">
      <ScreenHeader title="Perfil" subtitle="Preferências da sua IA" />
      <ProfilePreferences initial={profile} streak={progress.streak} />
      <div className="px-4 pb-6">
        <Link className="outline-button full-button" href="/calendario"><CalendarDays /> Calendário</Link>
      </div>
      <div className="px-4 pb-6">
        <Link className="outline-button full-button" href="/perfil/conquistas">
          <Trophy aria-hidden="true" /> Conquistas
        </Link>
        <LogoutButton />
      </div>
    </AppShell>
  );
}
