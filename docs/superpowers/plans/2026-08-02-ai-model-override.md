# Troca de Modelo de IA via UI (Override no Teable) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir trocar o modelo de IA pela página de conexões, listando modelos do provedor e persistindo a escolha na tabela Teable `AIProviderSettings`, sem restart.

**Architecture:** Novo módulo `lib/ai/model-settings.ts` lê/grava a linha ativa de `AIProviderSettings` com cache em memória de 60s e fallback silencioso para env. `getAiConfig()`/`getAiStatus()`/`getConnectionStatus()` viram async (ripple em 8 call sites, todos já em funções async). Duas rotas novas: `GET /api/settings/ai/models` (consulta `GET {baseUrl}/models` no provedor com fallback estático) e `PUT /api/settings/ai/model` (salva override). Novo client component `components/AiModelSelect.tsx` no card de IA.

**Tech Stack:** Next.js App Router, TypeScript, Vitest (`npm run test:unit`), Teable via `lib/teable/client.ts`, fetch puro (sem SDK de IA).

**Spec:** `docs/superpowers/specs/2026-08-02-ai-model-override-design.md`

## Global Constraints

- Copy da UI e mensagens de erro das rotas novas em **pt-BR** (seguir `ConnectionTestButton`).
- **Somente o modelo** é editável; provider/baseUrl/apiKey/temperature/maxTokens continuam exclusivamente em env (`lib/ai/config.ts`).
- Segredos nunca saem do servidor; UI só recebe status/máscaras.
- Padrão de rota: `jsonOk`/`jsonError`/`handleApiError` de `@/lib/api/responses`.
- Timeout de 10s em chamadas ao provedor (`AbortSignal.timeout(10_000)`), `cache: "no-store"`.
- Testes em `tests/unit/*.test.ts` com Vitest; `server-only` já é stubado em `vitest.config.ts`.
- Verificação por task: `npm run test:unit` (e `npm run typecheck` quando houver mudança de assinatura).

---

### Task 1: `lib/ai/model-settings.ts` — leitura/escrita do override com cache

**Files:**
- Create: `lib/ai/model-settings.ts`
- Test: `tests/unit/ai-model-settings.test.ts`

**Interfaces:**
- Consumes: `getTeableClient()` de `@/lib/teable/client` (métodos `listRecords`, `updateRecord`, `createRecord`); `getEnv` de `@/lib/env`.
- Produces (usado pelas Tasks 2 e 4):
  - `getActiveModelOverride(): Promise<{ chatModel: string | null; source: "teable" | "env" }>`
  - `saveModelOverride(chatModel: string): Promise<void>` (propaga erros do Teable)
  - `invalidateModelCache(): void`

- [ ] **Step 1: Write the failing test**

Criar `tests/unit/ai-model-settings.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listRecords: vi.fn(),
  updateRecord: vi.fn(),
  createRecord: vi.fn()
}));

vi.mock("@/lib/teable/client", () => ({
  getTeableClient: () => mocks
}));

import { getActiveModelOverride, invalidateModelCache, saveModelOverride } from "@/lib/ai/model-settings";

describe("getActiveModelOverride", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00Z"));
    invalidateModelCache();
    mocks.listRecords.mockReset();
    mocks.updateRecord.mockReset();
    mocks.createRecord.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns env source when there are no records", async () => {
    mocks.listRecords.mockResolvedValue([]);
    const result = await getActiveModelOverride();
    expect(result).toEqual({ chatModel: null, source: "env" });
    expect(mocks.listRecords).toHaveBeenCalledWith("aiProviderSettings", 100);
  });

  it("returns the most recent active row with a chat_model", async () => {
    mocks.listRecords.mockResolvedValue([
      { id: "rec1", createdTime: "2026-07-01T00:00:00Z", fields: { is_active: true, chat_model: "old-model" } },
      { id: "rec2", createdTime: "2026-08-01T00:00:00Z", fields: { is_active: true, chat_model: "new-model" } },
      { id: "rec3", createdTime: "2026-08-02T00:00:00Z", fields: { is_active: false, chat_model: "inactive-model" } }
    ]);
    const result = await getActiveModelOverride();
    expect(result).toEqual({ chatModel: "new-model", source: "teable" });
  });

  it("falls back to env silently when Teable throws", async () => {
    mocks.listRecords.mockRejectedValue(new Error("connection refused"));
    const result = await getActiveModelOverride();
    expect(result).toEqual({ chatModel: null, source: "env" });
  });

  it("caches the result for 60 seconds", async () => {
    mocks.listRecords.mockResolvedValue([]);
    await getActiveModelOverride();
    await getActiveModelOverride();
    expect(mocks.listRecords).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-08-02T12:01:01Z"));
    await getActiveModelOverride();
    expect(mocks.listRecords).toHaveBeenCalledTimes(2);
  });
});

describe("saveModelOverride", () => {
  beforeEach(() => {
    invalidateModelCache();
    mocks.listRecords.mockReset();
    mocks.updateRecord.mockReset();
    mocks.createRecord.mockReset();
  });

  it("updates the existing active row", async () => {
    mocks.listRecords.mockResolvedValue([
      { id: "rec1", createdTime: "2026-08-01T00:00:00Z", fields: { is_active: true, chat_model: "old" } }
    ]);
    await saveModelOverride("deepseek-reasoner");
    expect(mocks.updateRecord).toHaveBeenCalledWith("aiProviderSettings", "rec1", { chat_model: "deepseek-reasoner" });
    expect(mocks.createRecord).not.toHaveBeenCalled();
  });

  it("creates a row when there is no active one", async () => {
    vi.stubEnv("AI_PROVIDER", "deepseek");
    mocks.listRecords.mockResolvedValue([]);
    await saveModelOverride("deepseek-chat");
    expect(mocks.createRecord).toHaveBeenCalledWith("aiProviderSettings", {
      provider: "deepseek",
      chat_model: "deepseek-chat",
      is_active: true
    });
    vi.unstubAllEnvs();
  });

  it("invalidates the cache after saving", async () => {
    mocks.listRecords.mockResolvedValue([]);
    await getActiveModelOverride();
    expect(mocks.listRecords).toHaveBeenCalledTimes(1);
    await saveModelOverride("deepseek-chat");
    await getActiveModelOverride();
    expect(mocks.listRecords).toHaveBeenCalledTimes(2);
  });

  it("propagates Teable errors", async () => {
    mocks.listRecords.mockRejectedValue(new Error("boom"));
    await expect(saveModelOverride("x")).rejects.toThrow("boom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ai-model-settings.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/model-settings'`

- [ ] **Step 3: Write the implementation**

Criar `lib/ai/model-settings.ts`:

```ts
import { getEnv } from "@/lib/env";
import { getTeableClient } from "@/lib/teable/client";

type AiProviderSettingsFields = {
  provider?: string;
  chat_model?: string;
  is_active?: boolean;
};

export type ModelOverride = {
  chatModel: string | null;
  source: "teable" | "env";
};

const CACHE_TTL_MS = 60_000;

let cache: { value: ModelOverride; expiresAt: number } | null = null;

export function invalidateModelCache() {
  cache = null;
}

function pickActiveRow(records: Array<{ id: string; createdTime?: string; fields: AiProviderSettingsFields }>) {
  return records
    .filter((record) => record.fields.is_active === true)
    .sort((a, b) => (b.createdTime ?? "").localeCompare(a.createdTime ?? ""))[0];
}

export async function getActiveModelOverride(): Promise<ModelOverride> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  let value: ModelOverride = { chatModel: null, source: "env" };
  try {
    const client = getTeableClient();
    const records = await client.listRecords<AiProviderSettingsFields>("aiProviderSettings", 100);
    const active = pickActiveRow(records);
    const chatModel = active?.fields.chat_model?.trim();
    if (chatModel) value = { chatModel, source: "teable" };
  } catch {
    // Teable indisponível ou tabela não mapeada: fallback silencioso para env.
  }

  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function saveModelOverride(chatModel: string) {
  const client = getTeableClient();
  const records = await client.listRecords<AiProviderSettingsFields>("aiProviderSettings", 100);
  const active = pickActiveRow(records);

  if (active) {
    await client.updateRecord<AiProviderSettingsFields>("aiProviderSettings", active.id, { chat_model: chatModel });
  } else {
    await client.createRecord<AiProviderSettingsFields>("aiProviderSettings", {
      provider: getEnv("AI_PROVIDER") ?? "openai",
      chat_model: chatModel,
      is_active: true
    });
  }

  invalidateModelCache();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ai-model-settings.test.ts`
Expected: PASS (7 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/ai/model-settings.ts tests/unit/ai-model-settings.test.ts
git commit -m "feat(ai): override de modelo persistido no Teable com cache de 60s"
```

---

### Task 2: `getAiConfig()`/`getAiStatus()`/`getConnectionStatus()` async + ripple

**Files:**
- Modify: `lib/ai/config.ts` (arquivo inteiro)
- Modify: `lib/ai/client.ts:45` e `lib/ai/client.ts:139` (adicionar `await`)
- Modify: `lib/settings/status.ts` (arquivo inteiro)
- Modify: `lib/learning/conversations.ts:158` (`const ai = getAiConfig();` → `await`)
- Modify: `lib/learning/access.ts:25-32` (`hasMappedTeableSchema` recebe status por parâmetro)
- Modify: `lib/learning/home.ts:122` (`readiness: getConnectionStatus()` → `await`)
- Modify: `lib/learning/account.ts:86` (`connections: getConnectionStatus()` → `await`)
- Modify: `lib/learning/profile.ts:156` (`getOnboardingRedirectTarget` vira async)
- Modify: `app/api/onboarding/route.ts:16,34` (`await getOnboardingRedirectTarget()`)
- Modify: `app/api/settings/connections/route.ts:11` (`await getConnectionStatus()`)
- Test: `tests/unit/ai-config.test.ts`

**Interfaces:**
- Consumes: `getActiveModelOverride` da Task 1.
- Produces:
  - `getAiConfig(): Promise<{ provider: string; baseUrl?: string; apiKey?: string; chatModel?: string; modelSource: "teable" | "env"; temperature: number; maxTokens: number }>`
  - `getAiStatus(): Promise<{ configured: boolean; provider: string; baseUrlConfigured: boolean; apiKeyConfigured: boolean; apiKeyMasked: string | null; chatModelConfigured: boolean; chatModel: string | null; modelSource: "teable" | "env" }>`
  - `getConnectionStatus(): Promise<{ ai: AiStatus; teable: TeableStatus; kokoro: KokoroStatus }>` (mesmo shape anterior + `ai.modelSource`)
  - `getOnboardingRedirectTarget(): Promise<{ status; readyForPractice: boolean; redirectTo: string }>`

- [ ] **Step 1: Write the failing test**

Criar `tests/unit/ai-config.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getActiveModelOverride = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/model-settings", () => ({ getActiveModelOverride }));

import { getAiConfig, getAiStatus } from "@/lib/ai/config";

describe("getAiConfig", () => {
  beforeEach(() => {
    vi.stubEnv("AI_PROVIDER", "deepseek");
    vi.stubEnv("AI_CHAT_MODEL", "env-model");
    getActiveModelOverride.mockReset();
    getActiveModelOverride.mockResolvedValue({ chatModel: null, source: "env" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the env model when there is no override", async () => {
    const config = await getAiConfig();
    expect(config.chatModel).toBe("env-model");
    expect(config.modelSource).toBe("env");
  });

  it("applies the Teable override over the env model", async () => {
    getActiveModelOverride.mockResolvedValue({ chatModel: "deepseek-reasoner", source: "teable" });
    const config = await getAiConfig();
    expect(config.chatModel).toBe("deepseek-reasoner");
    expect(config.modelSource).toBe("teable");
  });
});

describe("getAiStatus", () => {
  beforeEach(() => {
    vi.stubEnv("AI_PROVIDER", "deepseek");
    vi.stubEnv("AI_BASE_URL", "https://api.deepseek.com/v1");
    vi.stubEnv("AI_API_KEY", "sk-test-key-1234");
    vi.stubEnv("AI_CHAT_MODEL", "env-model");
    getActiveModelOverride.mockReset();
    getActiveModelOverride.mockResolvedValue({ chatModel: "deepseek-chat", source: "teable" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exposes modelSource and the overridden model", async () => {
    const status = await getAiStatus();
    expect(status.configured).toBe(true);
    expect(status.chatModel).toBe("deepseek-chat");
    expect(status.modelSource).toBe("teable");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ai-config.test.ts`
Expected: FAIL — `getAiConfig` retorna objeto síncrono (`.chatModel` undefined em await de objeto não-Promise resolve, mas `config.chatModel` será `"env-model"`... na real falha porque `getActiveModelOverride` nunca é chamado e `modelSource` é undefined).

- [ ] **Step 3: Rewrite `lib/ai/config.ts` como async**

Substituir o arquivo inteiro por:

```ts
import { getEnv, maskSecret } from "@/lib/env";
import { getActiveModelOverride } from "./model-settings";

export async function getAiConfig() {
  const override = await getActiveModelOverride();
  return {
    provider: getEnv("AI_PROVIDER") ?? "openai",
    baseUrl: getEnv("AI_BASE_URL"),
    apiKey: getEnv("AI_API_KEY"),
    chatModel: override.chatModel ?? getEnv("AI_CHAT_MODEL"),
    modelSource: override.chatModel ? ("teable" as const) : ("env" as const),
    temperature: Number(getEnv("AI_TEMPERATURE") ?? 0.4),
    maxTokens: Number(getEnv("AI_MAX_TOKENS") ?? 1200)
  };
}

export async function getAiStatus() {
  const config = await getAiConfig();
  return {
    configured: Boolean(config.baseUrl && config.apiKey && config.chatModel),
    provider: config.provider,
    baseUrlConfigured: Boolean(config.baseUrl),
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeyMasked: maskSecret(config.apiKey),
    chatModelConfigured: Boolean(config.chatModel),
    chatModel: config.chatModel ?? null,
    modelSource: config.modelSource
  };
}
```

- [ ] **Step 4: Propagar o async pelos call sites**

`lib/ai/client.ts:45` — trocar `const config = getAiConfig();` por `const config = await getAiConfig();`
`lib/ai/client.ts:139` — mesma troca.

`lib/settings/status.ts` — substituir o arquivo por:

```ts
import { getAiStatus } from "@/lib/ai/config";
import { getKokoroStatus } from "@/lib/kokoro/config";
import { getTeableStatus } from "@/lib/teable/config";

export async function getConnectionStatus() {
  return {
    ai: await getAiStatus(),
    teable: getTeableStatus(),
    kokoro: getKokoroStatus()
  };
}
```

`lib/learning/conversations.ts:158` — `const ai = getAiConfig();` → `const ai = await getAiConfig();` (função `startConversation` já é async).

`lib/learning/access.ts` — trocar as linhas 25-32 por:

```ts
function hasMappedTeableSchema(status: Awaited<ReturnType<typeof getConnectionStatus>>) {
  return status.teable.configured && status.teable.mappedTableCount === status.teable.totalTableCount;
}

export async function getLearningGate() {
  const status = await getConnectionStatus();
  const teableReady = hasMappedTeableSchema(status);
```

`lib/learning/home.ts:122` — `readiness: getConnectionStatus()` → `readiness: await getConnectionStatus()` (`getHomeData` já é async).

`lib/learning/account.ts:86` — `connections: getConnectionStatus()` → `connections: await getConnectionStatus()` (`getProfileSettings` já é async).

`lib/learning/profile.ts:156` — `export function getOnboardingRedirectTarget() {` → `export async function getOnboardingRedirectTarget() {` e, na linha seguinte, `const status = getConnectionStatus();` → `const status = await getConnectionStatus();`.

`app/api/onboarding/route.ts:16,34` — `const readiness = getOnboardingRedirectTarget();` → `const readiness = await getOnboardingRedirectTarget();` (ambas as ocorrências, handlers já são async).

`app/api/settings/connections/route.ts:11` — `connections: getConnectionStatus()` → `connections: await getConnectionStatus()`.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/unit/ai-config.test.ts tests/unit/ai-model-settings.test.ts && npm run typecheck && npm run test:unit`
Expected: tudo PASS, typecheck sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/config.ts lib/ai/client.ts lib/settings/status.ts lib/learning/conversations.ts lib/learning/access.ts lib/learning/home.ts lib/learning/account.ts lib/learning/profile.ts app/api/onboarding/route.ts app/api/settings/connections/route.ts tests/unit/ai-config.test.ts
git commit -m "feat(ai): getAiConfig async aplicando override de modelo do Teable"
```

---

### Task 3: `GET /api/settings/ai/models` — listagem com fallback estático

**Files:**
- Create: `app/api/settings/ai/models/route.ts`
- Test: `tests/unit/ai-models-route.test.ts`

**Interfaces:**
- Consumes: `getEnv` de `@/lib/env`; `jsonOk`/`jsonError` de `@/lib/api/responses`.
- Produces: `GET /api/settings/ai/models` → `200 { ok: true, models: string[], source: "provider" | "fallback" }` ou `503 { ok: false, error: string }`. Consumido pela Task 5 (`AiModelSelect`).

- [ ] **Step 1: Write the failing test**

Criar `tests/unit/ai-models-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/settings/ai/models/route";

describe("GET /api/settings/ai/models", () => {
  beforeEach(() => {
    vi.stubEnv("AI_PROVIDER", "deepseek");
    vi.stubEnv("AI_BASE_URL", "https://api.deepseek.com/v1");
    vi.stubEnv("AI_API_KEY", "sk-test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns sorted unique models from the provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: "deepseek-reasoner" }, { id: "deepseek-chat" }, { id: "deepseek-chat" }, {}] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, models: ["deepseek-chat", "deepseek-reasoner"], source: "provider" });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://api.deepseek.com/v1/models");
  });

  it("falls back to the static provider list when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    const response = await GET();
    const body = await response.json();
    expect(body).toEqual({ ok: true, models: ["deepseek-chat", "deepseek-reasoner"], source: "fallback" });
  });

  it("falls back when the payload has an unexpected shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ weird: true }), { status: 200 })));
    const response = await GET();
    const body = await response.json();
    expect(body.source).toBe("fallback");
  });

  it("returns 503 when AI is not configured", async () => {
    vi.stubEnv("AI_BASE_URL", "");
    vi.stubEnv("AI_API_KEY", "");
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("Configure a IA no servidor primeiro.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ai-models-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/settings/ai/models/route'`

- [ ] **Step 3: Write the route**

Criar `app/api/settings/ai/models/route.ts`:

```ts
import { jsonError, jsonOk } from "@/lib/api/responses";
import { getEnv } from "@/lib/env";

// A lista reflete a configuração do servidor e o provedor em tempo real.
export const dynamic = "force-dynamic";

const FALLBACK_MODELS: Record<string, string[]> = {
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  anthropic: ["claude-sonnet-4-5", "claude-haiku-4-5"],
  google: ["gemini-2.5-pro", "gemini-2.5-flash"],
  openrouter: ["openai/gpt-4o", "anthropic/claude-sonnet-4-5", "deepseek/deepseek-chat"],
  custom: []
};

export async function GET() {
  const baseUrl = getEnv("AI_BASE_URL");
  const apiKey = getEnv("AI_API_KEY");
  const provider = getEnv("AI_PROVIDER") ?? "openai";

  if (!baseUrl || !apiKey) {
    return jsonError("Configure a IA no servidor primeiro.", 503);
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Provider returned ${response.status}`);

    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const models = [
      ...new Set((body.data ?? []).map((entry) => (typeof entry.id === "string" ? entry.id.trim() : "")).filter(Boolean))
    ].sort();
    if (models.length === 0) throw new Error("Unexpected models payload.");

    return jsonOk({ ok: true, models, source: "provider" });
  } catch {
    return jsonOk({ ok: true, models: FALLBACK_MODELS[provider] ?? FALLBACK_MODELS.custom, source: "fallback" });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ai-models-route.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add app/api/settings/ai/models/route.ts tests/unit/ai-models-route.test.ts
git commit -m "feat(settings): endpoint de listagem de modelos do provedor com fallback"
```

---

### Task 4: `PUT /api/settings/ai/model` — salvar o modelo escolhido

**Files:**
- Create: `app/api/settings/ai/model/route.ts`
- Test: `tests/unit/ai-model-route.test.ts`

**Interfaces:**
- Consumes: `saveModelOverride` (Task 1), `getAiStatus` (Task 2), `TeableConfigError`/`TeableRequestError` de `@/lib/teable/client`.
- Produces: `PUT /api/settings/ai/model` body `{ chatModel: string }` → `200 { ok: true, status: AiStatus }` | `400 { ok: false, error: "Informe um modelo válido." }` | `503 { ok: false, error: "Não foi possível salvar o modelo. Tente novamente." }`. Consumido pela Task 5.

- [ ] **Step 1: Write the failing test**

Criar `tests/unit/ai-model-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeableRequestError } from "@/lib/teable/client";

const mocks = vi.hoisted(() => ({
  saveModelOverride: vi.fn(),
  getActiveModelOverride: vi.fn()
}));

vi.mock("@/lib/ai/model-settings", () => ({
  saveModelOverride: mocks.saveModelOverride,
  getActiveModelOverride: mocks.getActiveModelOverride,
  invalidateModelCache: vi.fn()
}));

import { PUT } from "@/app/api/settings/ai/model/route";

function putRequest(body: unknown) {
  return new Request("http://localhost/api/settings/ai/model", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("PUT /api/settings/ai/model", () => {
  beforeEach(() => {
    vi.stubEnv("AI_PROVIDER", "deepseek");
    vi.stubEnv("AI_BASE_URL", "https://api.deepseek.com/v1");
    vi.stubEnv("AI_API_KEY", "sk-test-key-1234");
    vi.stubEnv("AI_CHAT_MODEL", "env-model");
    mocks.saveModelOverride.mockReset();
    mocks.getActiveModelOverride.mockReset();
    mocks.getActiveModelOverride.mockResolvedValue({ chatModel: "deepseek-reasoner", source: "teable" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 400 for an empty model", async () => {
    const response = await PUT(putRequest({ chatModel: "  " }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Informe um modelo válido.");
    expect(mocks.saveModelOverride).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing model field", async () => {
    const response = await PUT(putRequest({}));
    expect(response.status).toBe(400);
  });

  it("returns 503 in pt-BR when Teable fails", async () => {
    mocks.saveModelOverride.mockRejectedValue(new TeableRequestError("Teable request failed: 500", 500));
    const response = await PUT(putRequest({ chatModel: "deepseek-reasoner" }));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("Não foi possível salvar o modelo. Tente novamente.");
  });

  it("saves and returns the updated status", async () => {
    mocks.saveModelOverride.mockResolvedValue(undefined);
    const response = await PUT(putRequest({ chatModel: "deepseek-reasoner" }));
    expect(response.status).toBe(200);
    expect(mocks.saveModelOverride).toHaveBeenCalledWith("deepseek-reasoner");
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.status.chatModel).toBe("deepseek-reasoner");
    expect(body.status.modelSource).toBe("teable");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ai-model-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/settings/ai/model/route'`

- [ ] **Step 3: Write the route**

Criar `app/api/settings/ai/model/route.ts`:

```ts
import { jsonError, jsonOk } from "@/lib/api/responses";
import { getAiStatus } from "@/lib/ai/config";
import { saveModelOverride } from "@/lib/ai/model-settings";
import { TeableConfigError, TeableRequestError } from "@/lib/teable/client";

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { chatModel?: unknown } | null;
  const chatModel = typeof body?.chatModel === "string" ? body.chatModel.trim() : "";
  if (!chatModel) {
    return jsonError("Informe um modelo válido.", 400);
  }

  try {
    await saveModelOverride(chatModel);
  } catch (error) {
    if (error instanceof TeableConfigError || error instanceof TeableRequestError) {
      return jsonError("Não foi possível salvar o modelo. Tente novamente.", 503);
    }
    throw error;
  }

  return jsonOk({ ok: true, status: await getAiStatus() });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ai-model-route.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add app/api/settings/ai/model/route.ts tests/unit/ai-model-route.test.ts
git commit -m "feat(settings): endpoint para salvar o modelo de IA escolhido"
```

---

### Task 5: UI — `AiModelSelect` no card de IA

**Files:**
- Create: `components/AiModelSelect.tsx`
- Modify: `app/settings/connections/page.tsx` (page vira async; `ConnectionCard` aceita `children`; card de IA recebe o select)

**Interfaces:**
- Consumes: rotas das Tasks 3 e 4; status de Task 2 (`status.ai.chatModel`, `status.ai.modelSource`, `status.ai.configured`).
- Produces: `AiModelSelect({ currentModel: string | null; modelSource: "teable" | "env"; aiConfigured: boolean })` — client component.

- [ ] **Step 1: Create the client component**

Criar `components/AiModelSelect.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

type LoadState = "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "success" | "error";

export function AiModelSelect({
  currentModel,
  modelSource,
  aiConfigured
}: {
  currentModel: string | null;
  modelSource: "teable" | "env";
  aiConfigured: boolean;
}) {
  const [loadState, setLoadState] = useState<LoadState>(aiConfigured ? "loading" : "error");
  const [models, setModels] = useState<string[]>(currentModel ? [currentModel] : []);
  const [source, setSource] = useState<"provider" | "fallback">("provider");
  const [selected, setSelected] = useState(currentModel ?? "");
  const [saved, setSaved] = useState(currentModel ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!aiConfigured) return;
    let cancelled = false;

    fetch("/api/settings/ai/models", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as
          | { models?: string[]; source?: "provider" | "fallback" }
          | null;
        if (!response.ok || !data?.models) throw new Error("models load failed");
        if (cancelled) return;
        const list = currentModel && !data.models.includes(currentModel) ? [currentModel, ...data.models] : data.models;
        setModels(list);
        setSource(data.source ?? "provider");
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [aiConfigured, currentModel]);

  async function save() {
    setSaveState("saving");
    setMessage("");

    try {
      const response = await fetch("/api/settings/ai/model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatModel: selected })
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setSaveState("error");
        setMessage(data?.error ?? "Não foi possível salvar o modelo.");
        return;
      }

      setSaved(selected);
      setSaveState("success");
      setMessage("Modelo atualizado.");
    } catch {
      setSaveState("error");
      setMessage("Não foi possível salvar o modelo. Tente novamente.");
    }
  }

  if (!aiConfigured) {
    return <div className="row-meta">Configure a IA no servidor primeiro.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label className="muted" htmlFor="ai-model-select">
        Trocar modelo{modelSource === "teable" ? " (personalizado)" : ""}
      </label>
      <select
        aria-label="Modelo de IA"
        className="outline-button full-button"
        disabled={loadState !== "ready" || saveState === "saving"}
        id="ai-model-select"
        onChange={(event) => {
          setSelected(event.target.value);
          setSaveState("idle");
          setMessage("");
        }}
        value={selected}
      >
        {loadState === "loading" ? <option value="">Carregando modelos...</option> : null}
        {models.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>
      {loadState === "ready" && source === "fallback" ? (
        <div className="row-meta">Lista estimada — não foi possível consultar o provedor.</div>
      ) : null}
      {loadState === "error" ? <div className="row-meta">Não foi possível carregar a lista de modelos.</div> : null}
      <button
        aria-busy={saveState === "saving"}
        className="dark-button full-button"
        disabled={saveState === "saving" || !selected || selected === saved}
        onClick={save}
        type="button"
      >
        {saveState === "saving" ? "Salvando..." : "Salvar modelo"}
      </button>
      {message ? (
        <div
          aria-live="polite"
          className={saveState === "error" ? "row-meta" : "metric-foot"}
          role={saveState === "error" ? "alert" : "status"}
          style={{ marginTop: 8 }}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Wire into the connections page**

Em `app/settings/connections/page.tsx`:

1. Adicionar imports:

```ts
import { ReactNode } from "react";
import { AiModelSelect } from "@/components/AiModelSelect";
```

2. `ConnectionCard` aceita e renderiza `children` (entre `lines` e o `ConnectionTestButton`):

```tsx
function ConnectionCard({
  title,
  meta,
  Icon,
  tone,
  connected,
  lines,
  testEndpoint,
  children
}: {
  title: string;
  meta: string;
  Icon: typeof KeyRound;
  tone: "primary" | "warning" | "info";
  connected: boolean;
  lines: Array<{ label: string; value: string }>;
  testEndpoint: string;
  children?: ReactNode;
}) {
```

e dentro do JSX, depois do `lines.map(...)` e antes de `<ConnectionTestButton .../>`:

```tsx
        {children}
```

3. Page vira async e passa o select ao card de IA:

```tsx
export default async function ConnectionsPage() {
  const status = await getConnectionStatus();
```

e no card de IA, depois de `testEndpoint="/api/settings/test-ai"`:

```tsx
        >
          <AiModelSelect
            aiConfigured={status.ai.configured}
            currentModel={status.ai.chatModel}
            modelSource={status.ai.modelSource}
          />
        </ConnectionCard>
```

(fechar o `ConnectionCard` do card de IA com `</ConnectionCard>` em vez de `/>`; os cards de Teable e Kokoro continuam self-closing.)

- [ ] **Step 3: Verify typecheck, lint, unit tests and build**

Run: `npm run typecheck && npm run lint && npm run test:unit && npm run build`
Expected: tudo PASS sem erros.

- [ ] **Step 4: Manual smoke (dev server)**

Run: `npm run dev` e abrir `http://localhost:3000/settings/connections`
Expected:
- Card "IA de conversa" mostra o select com modelos do DeepSeek (`deepseek-chat`, `deepseek-reasoner` vindos da API, ou fallback com aviso).
- Trocar o modelo, clicar "Salvar modelo" → "Modelo atualizado."
- Clicar "Testar conexão" → "Conexão validada." com o modelo novo.
- Recarregar a página → linha "Modelo" mostra o modelo escolhido.

- [ ] **Step 5: Commit**

```bash
git add components/AiModelSelect.tsx app/settings/connections/page.tsx
git commit -m "feat(settings): select para trocar o modelo de IA na página de conexões"
```

---

### Task 6: Verificação final

**Files:** nenhum (somente verificação)

- [ ] **Step 1: Full gate**

Run: `npm run lint && npm run typecheck && npm run test:unit && npm run build`
Expected: tudo verde.

- [ ] **Step 2: Spec cross-check**

Reler `docs/superpowers/specs/2026-08-02-ai-model-override-design.md` seção por seção e confirmar: módulo model-settings com cache (Task 1), config async + `modelSource` (Task 2), `GET models` com fallback + timeout 10s (Task 3), `PUT model` com 400/503 pt-BR (Task 4), UI com select + aviso de fallback + estado não-configurado (Task 5). Fora de escopo intacto: nenhuma UI para provider/baseUrl/apiKey; `reasoning_model`/`temperature`/`max_tokens` não tocados.
