import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/supabase/middleware";

describe("isPublicPath", () => {
  it("libera rotas de auth e assets públicos", () => {
    for (const path of ["/login", "/auth/callback", "/reset-password", "/offline", "/sw.js", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"]) {
      expect(isPublicPath(path)).toBe(true);
    }
  });

  it("protege páginas e APIs do app", () => {
    for (const path of ["/", "/chat", "/palavras", "/perfil", "/settings", "/onboarding", "/api/home", "/api/conversations/start"]) {
      expect(isPublicPath(path)).toBe(false);
    }
  });
});
