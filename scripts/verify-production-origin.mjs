const appUrl = productionUrl(process.env.APP_URL);
const accessHeaderName = process.env.PHASE8_ACCESS_HEADER_NAME?.trim();
const accessHeaderValue = process.env.PHASE8_ACCESS_HEADER_VALUE?.trim();
const headers = {};

if ((accessHeaderName && !accessHeaderValue) || (!accessHeaderName && accessHeaderValue)) {
  fail("PHASE8_ACCESS_HEADER_NAME and PHASE8_ACCESS_HEADER_VALUE must be configured together.");
}
if (accessHeaderName && accessHeaderValue) headers[accessHeaderName] = accessHeaderValue;

const checks = [];
const root = await request("/", { headers });
expect(root.response.ok, `Home returned ${root.response.status}.`);
expect(root.response.headers.get("x-content-type-options") === "nosniff", "Missing X-Content-Type-Options.");
expect(root.response.headers.get("x-frame-options") === "DENY", "Missing X-Frame-Options.");
expect(Boolean(root.response.headers.get("content-security-policy")), "Missing Content-Security-Policy.");
expect(!root.response.headers.has("x-ai-fluency-environment"), "Production origin exposes the QA marker.");
checks.push("HTTPS home and security headers");

const manifest = await request("/manifest.webmanifest", { headers, json: true });
expect(manifest.response.ok, `Manifest returned ${manifest.response.status}.`);
expect(manifest.body?.display === "standalone", "Manifest display must be standalone.");
expect(manifest.body?.start_url === "/" && manifest.body?.scope === "/", "Manifest start URL or scope is invalid.");
const icons = Array.isArray(manifest.body?.icons) ? manifest.body.icons : [];
for (const size of ["192x192", "512x512"]) {
  const icon = icons.find((candidate) => candidate.sizes === size && candidate.type === "image/png");
  expect(Boolean(icon?.src), `Manifest is missing the ${size} PNG icon.`);
  const response = await request(icon.src, { headers });
  expect(response.response.ok, `${size} icon returned ${response.response.status}.`);
}
expect(icons.some((icon) => String(icon.purpose).includes("maskable")), "Manifest is missing a maskable icon.");
checks.push("installable manifest and PNG icons");

const worker = await request("/sw.js", { headers });
expect(worker.response.ok, `Service worker returned ${worker.response.status}.`);
expect(/no-store|no-cache/.test(worker.response.headers.get("cache-control") ?? ""), "Service worker must not be publicly cached.");
expect(
  worker.body.includes('url.pathname.startsWith("/api/")') && worker.body.includes('caches.match("/offline")'),
  "Service worker offline policy is invalid."
);
checks.push("service worker and offline fallback policy");

const connections = await request("/api/settings/connections", { headers, json: true });
expect(connections.response.ok, `Connections endpoint returned ${connections.response.status}.`);
expect((connections.response.headers.get("cache-control") ?? "").includes("no-store"), "API response is missing no-store.");
const status = connections.body?.connections;
expect(status?.ai?.configured === true, "AI connection is not configured.");
expect(status?.teable?.configured === true && status?.teable?.hasBaseId === true, "Teable connection is not configured.");
expect(status?.teable?.mappedTableCount === status?.teable?.totalTableCount, "Teable table mapping is incomplete.");
expect(status?.kokoro?.configured === true && status?.kokoro?.audioCacheEnabled === true, "Kokoro connection or cache is not configured.");
checks.push("server-only AI, Teable, and Kokoro readiness");

console.log(JSON.stringify({ ok: true, origin: appUrl.origin, checks }));

async function request(pathname, options = {}) {
  const response = await fetch(new URL(pathname, appUrl), { headers: options.headers, redirect: "follow" });
  const body = options.json ? await response.json().catch(() => null) : await response.text();
  return { response, body };
}

function productionUrl(value) {
  try {
    const parsed = new URL(value ?? "");
    if (parsed.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
      fail("APP_URL must be a non-local HTTPS production URL.");
    }
    return parsed;
  } catch {
    fail("APP_URL must be a valid non-local HTTPS production URL.");
  }
}

function expect(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}
