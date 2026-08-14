import { qaAuthCookieHeader, startQaServer, stopQaServer } from "./qa-test-runtime.mjs";
import { readEnv } from "./qa-env.mjs";

let server;
const checks = [];
try {
  const envPath = ".env.qa.local";
  const cookieHeader = await qaAuthCookieHeader(readEnv(envPath));
  // O readiness probe de startQaServer faz polling em /api/settings/connections,
  // que exige sessão — por isso o cookie QA vai nas options.
  server = await startQaServer(3014, envPath, { headers: { cookie: cookieHeader } });

  // Sem sessão: páginas redirecionam para /login e APIs respondem 401.
  const root = await fetch(`${server.baseUrl}/`, { redirect: "manual" });
  const rootLocation = root.headers.get("location") ?? "";
  if (!rootLocation.endsWith("/login")) {
    throw new Error(`The QA home route returned ${root.status} (location ${rootLocation || "none"}), expected a redirect to /login.`);
  }
  checks.push("/ -> /login (anonymous)");
  for (const [path, expectedStatus] of [["/api/settings/connections", 401], [`/api/voice/${"a".repeat(64)}`, 401]]) {
    const response = await fetch(`${server.baseUrl}${path}`);
    if (response.status !== expectedStatus) throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}.`);
    checks.push(`${path} -> ${expectedStatus} (anonymous)`);
  }

  // Com a sessão QA: comportamento normal do app.
  const authed = (path, init = {}) =>
    fetch(`${server.baseUrl}${path}`, { ...init, headers: { cookie: cookieHeader, ...(init.headers ?? {}) } });
  const home = await authed("/", { redirect: "manual" });
  const homeLocation = home.headers.get("location") ?? "";
  if (homeLocation.endsWith("/login") || (!home.ok && !homeLocation)) {
    throw new Error(`The authenticated home route returned ${home.status} (location ${homeLocation || "none"}).`);
  }
  checks.push(homeLocation ? `/ -> ${homeLocation} (authenticated)` : "/ -> learner home (authenticated)");
  for (const [path, expectedStatus] of [["/offline", 200], ["/sw.js", 200], ["/api/settings/connections", 200], [`/api/voice/${"a".repeat(64)}`, 404]]) {
    const response = await authed(path);
    if (response.status !== expectedStatus) throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}.`);
    checks.push(path);
  }
  console.log(JSON.stringify({ ok: true, checks }));
} finally {
  if (server) await stopQaServer(server.child);
}
