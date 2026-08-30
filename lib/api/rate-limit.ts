/**
 * Rate limit por usuário para as rotas de API caras (Kokoro/LLM), aplicado no
 * middleware — que já verifica o JWT de cada requisição e conhece o userId
 * antes de qualquer handler rodar.
 *
 * Janela fixa de 60s em memória de processo: sem dependências externas e
 * suficiente como freio de custo num deploy de instância única (VPS). Em
 * memória os limites valem por processo; um deploy multi-instância divide o
 * orçamento entre réplicas — aceitável como proteção, não como cobrança.
 */

export type ApiRateLimitRule = {
  /** Nome curto que identifica a regra (e compõe a chave do balde). */
  name: string;
  /** Caminho da requisição (pathname), sem query string. */
  pattern: RegExp;
  limitPerMinute: number;
};

// Síntese TTS: cada frase de uma mensagem é um POST; o preload da última
// resposta consome alguns por turno — 30/min sustenta o uso real com folga.
// O GET /api/voice/{id} é leitura de cache disparada por <audio> (inclusive
// range requests ao buscar), então tem teto bem mais alto.
export const apiRateLimitRules: ApiRateLimitRule[] = [
  { name: "voice-synthesize", pattern: /^\/api\/voice\/(synthesize|captioned)$/, limitPerMinute: 30 },
  { name: "voice-audio", pattern: /^\/api\/voice\/[^/]+$/, limitPerMinute: 240 },
  { name: "chat-message", pattern: /^\/api\/conversations\/[^/]+\/messages$/, limitPerMinute: 12 },
  { name: "teacher-question", pattern: /^\/api\/conversations\/[^/]+\/teacher$/, limitPerMinute: 12 },
  { name: "translate", pattern: /^\/api\/translate$/, limitPerMinute: 40 },
  { name: "explain-selection", pattern: /^\/api\/explain-selection$/, limitPerMinute: 40 },
  { name: "topics-suggest", pattern: /^\/api\/topics\/suggest$/, limitPerMinute: 10 },
  { name: "flashcards-create", pattern: /^\/api\/practice\/flashcards$/, limitPerMinute: 6 },
  { name: "settings-test", pattern: /^\/api\/settings\/test-(ai|kokoro|supabase)$/, limitPerMinute: 6 }
];

export function matchApiRateLimitRule(pathname: string): ApiRateLimitRule | null {
  return apiRateLimitRules.find((rule) => rule.pattern.test(pathname)) ?? null;
}

const WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 10_000;

type RateWindow = { count: number; windowStart: number };

const windows = new Map<string, RateWindow>();

export type RateLimitVerdict = {
  allowed: boolean;
  remaining: number;
  /** Segundos até a janela virar (header Retry-After); 0 quando permitido. */
  retryAfterSeconds: number;
};

export function checkRateLimit(key: string, limitPerMinute: number, now = Date.now()): RateLimitVerdict {
  if (windows.size >= MAX_TRACKED_KEYS) evictStaleWindows(now);
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const entry = windows.get(key);
  if (!entry || entry.windowStart !== windowStart) {
    windows.set(key, { count: 1, windowStart });
    return { allowed: true, remaining: limitPerMinute - 1, retryAfterSeconds: 0 };
  }
  entry.count += 1;
  if (entry.count > limitPerMinute) {
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000)) };
  }
  return { allowed: true, remaining: limitPerMinute - entry.count, retryAfterSeconds: 0 };
}

/** Descarta janelas de minutos anteriores quando o mapa estoura. */
function evictStaleWindows(now: number) {
  const currentWindowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  for (const [key, entry] of windows) {
    if (entry.windowStart < currentWindowStart) windows.delete(key);
  }
  // Sob ataque com chaves distintas dentro do mesmo minuto, zera para não
  // crescer sem limite — os baldes se recriam nas próximas requisições.
  if (windows.size >= MAX_TRACKED_KEYS) windows.clear();
}

/** Testes podem zerar o estado de processo entre casos. */
export function resetRateLimitsForTests() {
  windows.clear();
}
