import { AchievementToast } from "./AchievementToast";
import { BottomNav, NavKey } from "./BottomNav";

export type SectionKey = "chat" | "palavras" | "novas" | "calendario" | "progresso" | "neutral";

type AppShellProps = {
  children: React.ReactNode;
  activeNav?: NavKey;
  noNav?: boolean;
  section?: SectionKey;
};

export function AppShell({ children, activeNav, noNav = false, section }: AppShellProps) {
  const shellClass = section ? `phone-shell section-${section}` : "phone-shell";
  return (
    <>
      <a className="skip-link" href="#main-content">Pular para o conteúdo</a>
      <main className={shellClass}>
        <div className={noNav ? "screen no-nav" : "screen"} id="main-content" tabIndex={-1}>{children}</div>
        {!noNav ? <BottomNav active={activeNav} /> : null}
        <AchievementToast />
      </main>
    </>
  );
}
