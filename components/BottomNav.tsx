"use client";

import Link from "next/link";
import { BookOpen, CalendarDays, Home, MessageCircle, UserRound } from "lucide-react";

export type NavKey = "inicio" | "chat" | "palavras" | "calendario" | "perfil";

const items = [
  { key: "inicio" as const, label: "Início", href: "/", Icon: Home },
  { key: "chat" as const, label: "Chat", href: "/chat", Icon: MessageCircle },
  { key: "palavras" as const, label: "Palavras", href: "/palavras", Icon: BookOpen },
  { key: "calendario" as const, label: "Calendário", href: "/calendario", Icon: CalendarDays },
  { key: "perfil" as const, label: "Perfil", href: "/perfil", Icon: UserRound }
];

export function BottomNav({ active }: { active?: NavKey }) {
  return (
    <nav className="bottom-nav" aria-label="Navegação principal">
      {items.map(({ key, label, href, Icon }) => (
        <Link
          aria-current={active === key ? "page" : undefined}
          className={active === key ? "nav-item active" : "nav-item"}
          href={href}
          key={key}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
