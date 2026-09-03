"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Home, MessageCircle, Sparkles, UserRound } from "lucide-react";

export type NavKey = "inicio" | "chat" | "palavras" | "novas" | "calendario" | "perfil";

const items = [
  { key: "inicio" as const, label: "Início", href: "/", Icon: Home },
  { key: "chat" as const, label: "Chat", href: "/chat", Icon: MessageCircle },
  { key: "palavras" as const, label: "Palavras", href: "/palavras", Icon: BookOpen },
  { key: "novas" as const, label: "Novas", href: "/palavras/novas", Icon: Sparkles },
  { key: "perfil" as const, label: "Perfil", href: "/perfil", Icon: UserRound }
];

export function BottomNav({ active }: { active?: NavKey }) {
  const [queueBadge, setQueueBadge] = useState(0);

  useEffect(() => {
    // Cache curto no sessionStorage evita bater na API em toda troca de aba.
    try {
      const cached = sessionStorage.getItem("ai-fluency:queue-count");
      if (cached) {
        const parsed = JSON.parse(cached) as { value: number; at: number };
        if (Date.now() - parsed.at < 5 * 60_000) setQueueBadge(parsed.value);
      }
    } catch { /* cache inválido: segue para o fetch */ }
    const controller = new AbortController();
    void fetch("/api/practice/queue-count", { signal: controller.signal })
      .then((response) => response.json() as Promise<{ ok?: boolean; dueCount?: number; newCount?: number }>)
      .then((data) => {
        if (!data.ok) return;
        const value = (data.dueCount ?? 0) + (data.newCount ?? 0);
        setQueueBadge(value);
        sessionStorage.setItem("ai-fluency:queue-count", JSON.stringify({ value, at: Date.now() }));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

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
          {key === "palavras" && queueBadge > 0 ? <span className="nav-badge" aria-label={`${queueBadge} cards aguardando revisão`}>{queueBadge > 9 ? "9+" : queueBadge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
