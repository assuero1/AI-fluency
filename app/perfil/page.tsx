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
      <ScreenHeader streak={progress.streak} title="Perfil" subtitle="Preferências da sua IA" />
      <ProfilePreferences initial={profile} />
      <div className="section settings-list">
        <Link className="outline-button full-button" href="/calendario"><CalendarDays aria-hidden="true" size={20} /> Calendário</Link>
        <Link className="outline-button full-button" href="/perfil/conquistas">
          <Trophy aria-hidden="true" size={20} /> Conquistas
        </Link>
        <LogoutButton />
      </div>
    </AppShell>
  );
}
