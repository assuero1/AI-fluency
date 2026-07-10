import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const worker = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");
const middleware = fs.readFileSync(path.join(root, "middleware.ts"), "utf8");
const nextConfig = fs.readFileSync(path.join(root, "next.config.mjs"), "utf8");
const audioRoute = fs.readFileSync(path.join(root, "app/api/voice/[audioId]/route.ts"), "utf8");

describe("PWA privacy policy", () => {
  it("uses network-first navigation with the offline page and never writes navigation HTML to cache", () => {
    expect(worker).toContain('fetch(request).catch(() => caches.match("/offline"))');
    expect(worker).not.toContain("cache.put(request, copy)");
    expect(worker).toContain('url.pathname.startsWith("/_next/static/")');
    expect(worker).not.toContain('APP_SHELL = ["/",');
    expect(worker).toContain('event.data?.type === "SKIP_WAITING"');
    expect(worker).not.toContain("event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));\n  self.skipWaiting()");
  });

  it("keeps API responses no-store except an existing cached audio response", () => {
    expect(middleware).toContain('response.headers.set("Cache-Control", "no-store, max-age=0")');
    expect(middleware).toContain("const isAudioRoute");
    expect(audioRoute).toContain('"Cache-Control": "private, max-age=604800"');
    expect(audioRoute).toContain('response.headers.set("Cache-Control", "no-store, max-age=0")');
  });

  it("keeps a restrictive content security policy in the application configuration", () => {
    expect(nextConfig).toContain("Content-Security-Policy");
    expect(nextConfig).toContain("frame-ancestors 'none'");
    expect(nextConfig).toContain("default-src 'self'");
  });
});
