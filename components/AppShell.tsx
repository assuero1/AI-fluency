import { BottomNav, NavKey } from "./BottomNav";

type AppShellProps = {
  children: React.ReactNode;
  activeNav?: NavKey;
  noNav?: boolean;
};

export function AppShell({ children, activeNav, noNav = false }: AppShellProps) {
  return (
    <>
      <a className="skip-link" href="#main-content">Pular para o conteúdo</a>
      <main className="phone-shell">
        <div className={noNav ? "screen no-nav" : "screen"} id="main-content" tabIndex={-1}>{children}</div>
        {!noNav ? <BottomNav active={activeNav} /> : null}
      </main>
    </>
  );
}
