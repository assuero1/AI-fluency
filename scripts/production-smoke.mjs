import { startQaServer, stopQaServer } from "./qa-test-runtime.mjs";

let server;
const checks = [];
try {
  server = await startQaServer(3014);
  const root = await fetch(`${server.baseUrl}/`, { redirect: "manual" });
  const rootHtml = await root.text();
  const redirectTarget = root.headers.get("location") ?? "";
  const onboardingRedirect = redirectTarget.endsWith("/onboarding") || rootHtml.includes("/onboarding");
  if (!onboardingRedirect && !root.ok) throw new Error(`The QA home route returned ${root.status} (location ${redirectTarget || "none"}).`);
  checks.push(onboardingRedirect ? "/ -> /onboarding" : "/ -> learner home");
  for (const [path, expectedStatus] of [["/offline", 200], ["/sw.js", 200], ["/api/settings/connections", 200], [`/api/voice/${"a".repeat(64)}`, 404]]) {
    const response = await fetch(`${server.baseUrl}${path}`);
    if (response.status !== expectedStatus) throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}.`);
    checks.push(path);
  }
  console.log(JSON.stringify({ ok: true, checks }));
} finally {
  if (server) await stopQaServer(server.child);
}
