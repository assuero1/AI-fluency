// Diagnóstico rápido para el middleware/AuthRetryableFetchError en producción.
// Uso (dentro del contenedor de EasyPanel, en la raíz del proyecto):
//   node scripts/diagnose-vps-middleware.mjs
//
// Comprueba, SIN imprimir secretos:
//   1. Config de Supabase visible para el proceso (entorno + .env.local si existe).
//   2. El mismo GET /auth/v1/user que hace el middleware (usa fetch nativo, igual que @supabase/ssr),
//      para distinguir red rota de credencial inválida.
//   3. Checklist corto de lo que exige el middleware para abrir la app.
import fs from "node:fs";
import { readEnv } from "./qa-env.mjs";

const envFile = ".env.local";
const hasEnvFile = fs.existsSync(envFile);
const fileEnv = hasEnvFile ? readEnv(envFile) : {};

function nonPlaceholder(value) {
  const v = value?.trim();
  if (!v || v.startsWith("replace-with") || v.includes("your-")) return undefined;
  return v;
}

// 1. Config visible en runtime
const url = nonPlaceholder(process.env.SUPABASE_URL) ?? nonPlaceholder(fileEnv.SUPABASE_URL);
const anonKey = nonPlaceholder(process.env.SUPABASE_ANON_KEY) ?? nonPlaceholder(fileEnv.SUPABASE_ANON_KEY);
const serviceKey =
  nonPlaceholder(process.env.SUPABASE_SERVICE_ROLE_KEY) ?? nonPlaceholder(fileEnv.SUPABASE_SERVICE_ROLE_KEY);

console.log("== 1. Config de Supabase ==");
console.log(`  .env.local presente: ${hasEnvFile}`);
console.log(
  `  SUPABASE_URL           (processo) ${nonPlaceholder(process.env.SUPABASE_URL) ? "configurada" : "AUSENTE"}   (archivo) ${nonPlaceholder(fileEnv.SUPABASE_URL) ? "configurada" : "AUSENTE"}`
);
console.log(
  `  SUPABASE_ANON_KEY      (processo) ${nonPlaceholder(process.env.SUPABASE_ANON_KEY) ? "configurada" : "AUSENTE"}   (archivo) ${nonPlaceholder(fileEnv.SUPABASE_ANON_KEY) ? "configurada" : "AUSENTE"}`
);
console.log(
  `  SERVICE_ROLE           (processo) ${nonPlaceholder(process.env.SUPABASE_SERVICE_ROLE_KEY) ? "configurada" : "AUSENTE"}   (archivo) ${nonPlaceholder(fileEnv.SUPABASE_SERVICE_ROLE_KEY) ? "configurada" : "AUSENTE"}`
);

if (!url || !anonKey) {
  console.log("\n  >>> Falta SUPABASE_URL o SUPABASE_ANON_KEY en el proceso runtime.");
  console.log("      Esta es EXACTAMENTE la causa del middleware fail-closed:");
  console.log("      páginas -> redirect 307 /login,  /api/* -> 401 JSON.");
  console.log("      Defina ambas en el panel EasyPanel (App > Settings > Env) que así se inyectan");
  console.log("      en el proceso; el middleware solo lee de environ, nunca del repositorio.");
  process.exit(0);
}

// 2. Comprobación real del mismo endpoint que usa el middleware
console.log(`\n== 2. GET /auth/v1/user (igual que supabase.auth.getUser del middleware) ==`);
try {
  const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
      "User-Agent": "ai-fluency-diagnose/1"
    }
  });
  const body = await res.text();
  console.log(`  status: ${res.status}`);
  if (res.status === 200) {
    console.log("  anon key VÁLIDA y red OK. El middleware no debería dar 'fetch failed'.");
    console.log("  (Si aun así cae en /login: el navegador no tiene sesión, o las cookies no viajan.)");
  } else if (res.status === 401) {
    console.log("  >>> CLAVE ANON INCORRECTA o el proyecto no autoriza la petición.");
    console.log("      - Copia la anon (public) key DEL proyecto, no la service_role.");
    console.log("      - Verifica que el proyecto Supabase no esté en pausa.");
  } else {
    console.log(`  respuesta inesperada: ${body.slice(0, 200)}`);
    console.log("  >>> Verifica que SUPABASE_URL sea el Project URL (https://<proj>.supabase.co).");
  }
} catch (err) {
  const cause = err.cause?.message ?? err.message ?? String(err);
  console.log(`  FALLO en la petición: ${cause}`);
  console.log("  >>> El VPS no alcanza el host de Supabase:");
  console.log("      - DNS roto en el VPS (resuelve otros hosts?)");
  console.log("      - Firewall del VPS / bloqueo de rangos Cloudflare o el proveedor");
  console.log("      - Proyecto Supabase en pausa / región caída");
  console.log("  Reproduce desde el VPS con:  curl -i https://<SUPABASE_HOST>/auth/v1/health");
}

// 3. Resumen de lo que decide el middleware
console.log("\n== 3. Qué decide el middleware ==");
console.log("  Rutas públicas: /login /auth/callback /reset-password /offline, /sw.js, /icon*, /manifest.");
console.log("  Sin SUPABASE_URL/ANON_KEY -> fail-closed: páginas redirigen a /login, /api/* da 401.");
console.log("  Con config y sesión válida -> páginas abren normal.");
console.log("  Con config y SIN sesión -> redirige a /login (esperado: la app requiere login).");
console.log(`  service_role (admin, scripts) ${serviceKey ? "configurada" : "AUSENTE (solo hace falta si usas scripts admin/seed)"}`);