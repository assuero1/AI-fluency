import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isPublicPath, updateSession } from "@/lib/supabase/middleware";

describe("isPublicPath", () => {
  it("libera rotas de auth e assets públicos", () => {
    for (const path of ["/login", "/auth/callback", "/reset-password", "/offline", "/sw.js", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/manifest.webmanifest"]) {
      expect(isPublicPath(path)).toBe(true);
    }
  });

  it("protege páginas e APIs do app", () => {
    for (const path of ["/", "/chat", "/palavras", "/perfil", "/settings", "/onboarding", "/api/home", "/api/conversations/start"]) {
      expect(isPublicPath(path)).toBe(false);
    }
  });
});

describe("updateSession sem SUPABASE_URL/SUPABASE_ANON_KEY (fail-closed)", () => {
  const saved = { url: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY };

  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
  });

  afterEach(() => {
    if (saved.url === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = saved.url;
    if (saved.anonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = saved.anonKey;
  });

  it("redireciona páginas protegidas para /login", async () => {
    const response = await updateSession(new NextRequest("http://localhost/chat"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("responde 401 JSON com mensagem de misconfig em APIs protegidas", async () => {
    const response = await updateSession(new NextRequest("http://localhost/api/home"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("SUPABASE_URL");
  });

  it("mantém rotas públicas acessíveis", async () => {
    for (const path of ["/login", "/offline", "/sw.js"]) {
      const response = await updateSession(new NextRequest(`http://localhost${path}`));
      expect(response.status).toBe(200);
    }
  });
});
