import { startQaServer, stopQaServer } from "./qa-test-runtime.mjs";

let server;
const checks = [];
try {
  server = await startQaServer(3014);
  const root = await fetch(`${server.baseUrl}/`, { redirect: "manual" });
  const rootHtml = await root.text();
  if (!rootHtml.includes("/onboarding")) throw new Error("A clean QA base did not direct the learner to onboarding.");
  checks.push("/ -> /onboarding");
  for (const [path, expectedStatus] of [["/offline", 200], ["/sw.js", 200], ["/api/settings/connections", 200], [`/api/voice/${"a".repeat(64)}`, 404]]) {
    const response = await fetch(`${server.baseUrl}${path}`);
    if (response.status !== expectedStatus) throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}.`);
    checks.push(path);
  }
  console.log(JSON.stringify({ ok: true, checks }));
} finally {
  if (server) await stopQaServer(server.child);
}
