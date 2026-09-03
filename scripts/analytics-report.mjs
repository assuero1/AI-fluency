// Relatório de engajamento — agrega app_events, practice_sessions, users e
// push_subscriptions em memória (base pequena, sem SQL avançado).
// Uso: node scripts/analytics-report.mjs --env .env.local
// Métricas e alvos: docs/ANALYTICS_ENGAJAMENTO.md
import { createClient } from "@supabase/supabase-js";
import { readEnv, required } from "./qa-env.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const envPath = option("--env") ?? ".env.local";
const env = readEnv(envPath);
const supabaseUrl = required(env, "SUPABASE_URL").replace(/\/+$/, "");
const serviceKey = required(env, "SUPABASE_SERVICE_ROLE_KEY");
const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 60;
const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS).toISOString();

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

function dayKey(value, timeZone = "America/Sao_Paulo") {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

const [events, sessions, users, subscriptions] = await Promise.all([
  fetchAll("app_events", "user_id,event_name,payload,created_at").then((rows) => rows.filter((row) => row.created_at >= since)),
  fetchAll("practice_sessions", "user_id,type,status,started_at,ended_at,duration_seconds,focus").then((rows) => rows.filter((row) => (row.started_at || row.created_at) >= since)),
  fetchAll("users", "id,timezone,current_streak,last_practice_day,reminder_hour"),
  fetchAll("push_subscriptions", "user_id")
]);

// ── DAU / WAU ──
const activeByDay = new Map(); // dayKey -> Set(user)
for (const event of events) {
  const key = dayKey(event.created_at);
  if (!key) continue;
  if (!activeByDay.has(key)) activeByDay.set(key, new Set());
  activeByDay.get(key).add(event.user_id);
}
for (const session of sessions) {
  const key = dayKey(session.started_at || session.ended_at);
  if (!key) continue;
  if (!activeByDay.has(key)) activeByDay.set(key, new Set());
  activeByDay.get(key).add(session.user_id);
}
const days = [...activeByDay.keys()].sort();
const last28 = days.slice(-28);
const dailyActives = last28.map((day) => activeByDay.get(day).size);
const dauAverage = dailyActives.length ? (dailyActives.reduce((sum, value) => sum + value, 0) / dailyActives.length).toFixed(1) : "0";

// ── Retenção D1 / D7 (proxy: 1º dia ativo do usuário no período) ──
const firstDayByUser = new Map();
for (const day of days) {
  for (const userId of activeByDay.get(day)) {
    if (!firstDayByUser.has(userId) || day < firstDayByUser.get(userId)) firstDayByUser.set(userId, day);
  }
}
function retention(offsetDays) {
  let started = 0;
  let returned = 0;
  for (const [userId, firstDay] of firstDayByUser) {
    const startTime = Date.parse(`${firstDay}T12:00:00Z`);
    if (Date.now() - startTime < offsetDays * DAY_MS) continue; // janela ainda aberta
    started += 1;
    const target = new Date(startTime + offsetDays * DAY_MS).toISOString().slice(0, 10);
    if (activeByDay.get(target)?.has(userId)) returned += 1;
  }
  return started ? `${Math.round((returned / started) * 100)}% (${returned}/${started})` : "sem dados";
}

// ── Conclusão por modalidade ──
const byType = new Map();
for (const session of sessions) {
  if (!byType.has(session.type)) byType.set(session.type, { completed: 0, abandoned: 0 });
  const bucket = byType.get(session.type);
  if (session.status === "completed") bucket.completed += 1;
  if (session.status === "abandoned") bucket.abandoned += 1;
}

// ── Streaks / XP / push ──
const streakBuckets = { "0": 0, "1-6": 0, "7-29": 0, "30+": 0 };
for (const user of users) {
  const streak = Number(user.current_streak ?? 0);
  if (streak >= 30) streakBuckets["30+"] += 1;
  else if (streak >= 7) streakBuckets["7-29"] += 1;
  else if (streak >= 1) streakBuckets["1-6"] += 1;
  else streakBuckets["0"] += 1;
}
const usersWithReminder = users.filter((user) => user.reminder_hour !== null && user.reminder_hour !== undefined).length;
const ctaCounter = new Map();
for (const event of events.filter((row) => row.event_name === "cta_clicked")) {
  let cta = "unknown";
  try {
    cta = JSON.parse(typeof event.payload === "string" ? event.payload : JSON.stringify(event.payload ?? {})).cta ?? "unknown";
  } catch { /* payload inválido */ }
  ctaCounter.set(cta, (ctaCounter.get(cta) ?? 0) + 1);
}

const fmt = (rows) => rows.map(([label, value]) => `| ${label} | ${value} |`).join("\n");

console.log(`# Relatório de engajamento — janela de ${WINDOW_DAYS} dias (${since.slice(0, 10)} → hoje)

| Métrica | Valor |
| --- | --- |
${fmt([
  ["DAU médio (28d)", dauAverage],
  ["Dias com atividade", days.length],
  ["Retenção D1", retention(1)],
  ["Retenção D7", retention(7)],
  ["Usuários com lembrete ativo", `${usersWithReminder}/${users.length}`],
  ["Usuários com assinatura push", subscriptions.length]
])}

**Streaks:** ${fmt(Object.entries(streakBuckets))}

**Sessões por modalidade (concluídas / abandonadas):**
${fmt([...byType.entries()].map(([type, bucket]) => [type, `${bucket.completed} / ${bucket.abandoned}`]))}

**CTAs de fim de sessão (cliques):**
${ctaCounter.size ? fmt([...ctaCounter.entries()]) : "_sem cliques registrados ainda_"}
`);
