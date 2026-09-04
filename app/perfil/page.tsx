import Link from "next/link";
import { CalendarDays, ChevronRight, Trophy } from "lucide-react";
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
      <section className="section">
        <h2 className="section-title">Navegação e conta</h2>
        <div className="settings-list">
          <Link className="settings-row" href="/calendario">
            <span className="selector-item"><CalendarDays aria-hidden="true" size={20} /> Calendário de prática</span>
            <ChevronRight aria-hidden="true" size={18} />
          </Link>
          <Link className="settings-row" href="/perfil/conquistas">
            <span className="selector-item"><Trophy aria-hidden="true" size={20} /> Conquistas</span>
            <ChevronRight aria-hidden="true" size={18} />
          </Link>
        </div>
        <div className="mt-4">
          <LogoutButton />
        </div>
      </section>
    </AppShell>
  );
}
