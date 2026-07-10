import fs from "node:fs";

const evidencePath = process.argv[2] ?? "docs/phase-8-acceptance.json";
if (!fs.existsSync(evidencePath)) fail(`Acceptance evidence not found: ${evidencePath}`);

const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const failures = [];
const requiredLanguages = ["en", "es", "fr", "it"];

required(Boolean(evidence.testedAt && !Number.isNaN(Date.parse(evidence.testedAt))), "testedAt must be an ISO date.");
required(evidence.appVersion === packageJson.version, "appVersion must match package.json.");
required(isHttpsOrigin(evidence.origin), "origin must be a non-local HTTPS URL.");
requiredText(evidence.release?.deployedRevision, "release.deployedRevision");
requiredText(evidence.release?.nodeVersion, "release.nodeVersion");

for (const key of ["releaseGate", "productionHost", "httpsOrigin", "qaEmpty"]) {
  required(evidence.automated?.[key] === "pass", `automated.${key} must be pass.`);
}

for (const platform of ["android", "ios"]) validateDevice(platform, evidence.devices?.[platform]);

for (const key of [
  "privateAccessOutsideNetwork",
  "fullLearningLoop",
  "teableCrossScreenConsistency",
  "privacyInspection",
  "persistentPrivateAudioCache"
]) {
  required(evidence.manual?.[key]?.status === "pass", `manual.${key}.status must be pass.`);
  requiredText(evidence.manual?.[key]?.evidence, `manual.${key}.evidence`);
}

const loop = evidence.learningLoop;
for (const key of ["conversationId", "feedbackDate", "calendarEvidence", "wordsEvidence", "progressEvidence"]) {
  requiredText(loop?.[key], `learningLoop.${key}`);
}
required(Number.isInteger(loop?.correctionCount) && loop.correctionCount >= 0, "learningLoop.correctionCount must be a non-negative integer.");
required(Number.isInteger(loop?.wordCount) && loop.wordCount >= 0, "learningLoop.wordCount must be a non-negative integer.");
requiredText(evidence.acceptedBy, "acceptedBy");
required(Array.isArray(evidence.acceptedLimitations), "acceptedLimitations must be an array.");

if (failures.length) {
  console.error(JSON.stringify({ ok: false, evidencePath, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  evidencePath,
  origin: new URL(evidence.origin).origin,
  devices: [evidence.devices.android.model, evidence.devices.ios.model],
  languages: requiredLanguages,
  acceptedLimitations: evidence.acceptedLimitations.length
}));

function validateDevice(platform, device) {
  for (const key of ["model", "osVersion", "browser", "browserVersion"]) requiredText(device?.[key], `devices.${platform}.${key}`);
  for (const key of ["pwaInstall", "standaloneLaunch", "offlineHome", "offlineChat", "sttDenial", "kokoroPlayback", "textFallback"]) {
    required(device?.checks?.[key] === "pass", `devices.${platform}.checks.${key} must be pass.`);
  }
  for (const language of requiredLanguages) {
    required(device?.sttLanguages?.[language] === "pass", `devices.${platform}.sttLanguages.${language} must be pass.`);
  }
}

function required(condition, message) {
  if (!condition) failures.push(message);
}

function requiredText(value, name) {
  required(typeof value === "string" && value.trim().length > 0, `${name} is required.`);
}

function isHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}
