# Teable → Supabase Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar 100% dos dados e do backend de dados do AI Fluency de Teable para Supabase, sem quebrar nada no app, com rollback instantâneo via env var.

**Architecture:** Adapter drop-in: `lib/supabase/client.ts` implementa a mesma interface pública do `TeableClient` (shape `{ id, fields }`, mesmos métodos, mesmas classes de erro). `getTeableClient()` em `lib/teable/client.ts` vira factory que escolhe o backend via `DATA_BACKEND`/configuração — nenhum consumidor muda. Migração de dados via script em 2 passadas (insert sem FKs, depois resolve FKs por `legacy_id`).

**Tech Stack:** Next.js 15, TypeScript strict, Vitest 4, `@supabase/supabase-js` (única dependência nova), Node >=20.19 <23.

**Spec:** `docs/superpowers/specs/2026-08-12-teable-to-supabase-migration-design.md`

## Global Constraints

- **Paridade 100%:** todo comportamento observável do app se mantém; todos os 17 tables e todos os registros migram, incluindo AppEvents.
- Única dependência nova permitida: `@supabase/supabase-js`.
- `SUPABASE_SERVICE_ROLE_KEY` é server-only: só pode ser importada por `lib/supabase/*` e scripts Node. Nunca em components client.
- Record shape preservado: `{ id: string, fields: Record<string, unknown>, createdTime?: string }`.
- Erros preservados: adapter lança `TeableConfigError` (config ausente, status 503) e `TeableRequestError` (request, com status) de `lib/teable/types.ts`.
- Strings vazias (`""`) gravadas pelo app viram `null` no Postgres; leitura de `null` é equivalente a ausente/`""` para todos os consumidores atuais (`String(fields.x ?? "")`).
- Colunas jsonb: leitura devolve **string JSON** em `fields.*` (paridade com Teable); escrita faz `JSON.parse` de strings (parse inválido → `TeableRequestError` 400, nunca grava string em jsonb).
- IDs: app passa a usar uuids após cutover. `getRecord`/`updateRecord`/`deleteRecord` aceitam ids legados `recXxx` (fallback por `legacy_id`) — necessário porque `AI_FLUENCY_USER_ID` no `.env.local` guarda um `recXxx`.
- O código Teable (`lib/teable/*`, scripts `ensure-*`/`backfill-*`) permanece intacto e funcional.
- Node scripts são `.mjs` puro e NÃO podem importar `.ts`. Metadados de schema vivem em `lib/supabase/tables.json` (importável por TS via `resolveJsonModule` e por Node 20.19 via `with { type: "json" }`).
- Commits: um commit por task, mensagens em inglês estilo conventional commits, seguindo o padrão do repo. **Pedir confirmação do usuário antes de cada commit.**

## File Structure

**Novos:**
- `lib/supabase/tables.json` — metadados das 17 tabelas (key, tableName, jsonbColumns, fkColumns, hasCreatedAt). Fonte única para app e scripts.
- `lib/supabase/config.ts` — config env, `resolveDataBackend()`, `getSupabaseStatus()`.
- `lib/supabase/client.ts` — `SupabaseTeableClient` (adapter) + `createSupabaseTeableClient()`.
- `lib/teable/types.ts` — `TeableRecord`, `TeableConfigError`, `TeableRequestError` (extraídos de client.ts).
- `supabase/migrations/0001_initial_schema.sql` — DDL completo.
- `scripts/apply-supabase-schema.mjs` — aplica/verifica o DDL.
- `scripts/migrate-teable-to-supabase.mjs` — migração + verificação.
- `tests/unit/supabase-config.test.ts`, `tests/unit/supabase-client.test.ts`, `tests/unit/supabase-tables.test.ts`, `tests/unit/data-backend-factory.test.ts`.

**Modificados:**
- `lib/teable/client.ts` — importa tipos de `./types` (re-exporta para compat); `getTeableClient()` vira factory.
- `lib/settings/status.ts` — adiciona `backend` e `supabase` ao status.
- `scripts/backup-learning-data.mjs` — paginação completa (skip).
- `.env.example` — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATA_BACKEND`.
- `package.json` — dependência + scripts `supabase:apply-schema`, `supabase:migrate`.

**Intocados (por design):** `lib/learning/*`, `lib/ai/model-settings.ts`, todos os components, todas as API routes (a factory faz `health/teable` e `settings/test-teable` funcionarem contra o backend ativo).

---

### Task 1: Dependência e env vars

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Produces: `@supabase/supabase-js` importável; env vars documentadas.

- [ ] **Step 1: Instalar dependência**

```bash
npm install @supabase/supabase-js
```

- [ ] **Step 2: Adicionar env vars ao `.env.example`**

Adicionar ao final de `.env.example`:

```bash
# Supabase (data backend ativo quando configurado)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
# supabase (default quando SUPABASE_* configurado) | teable (rollback)
DATA_BACKEND=
```

- [ ] **Step 3: Adicionar scripts ao `package.json`**

Na seção `"scripts"`, adicionar:

```json
    "supabase:apply-schema": "node scripts/apply-supabase-schema.mjs",
    "supabase:migrate": "node scripts/migrate-teable-to-supabase.mjs",
```

- [ ] **Step 4: Verificar**

Run: `npm run typecheck && npm run lint`
Expected: PASS (sem mudanças de código ainda)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add @supabase/supabase-js dependency and env var placeholders"
```

---

### Task 2: Extrair tipos e erros para `lib/teable/types.ts`

Refactor sem mudança de comportamento: permite que `lib/supabase/client.ts` importe os erros sem ciclo de imports com `lib/teable/client.ts`.

**Files:**
- Create: `lib/teable/types.ts`
- Modify: `lib/teable/client.ts:1-38`

**Interfaces:**
- Consumes: nada novo.
- Produces: `lib/teable/types.ts` exporta `TeableRecord<TFields>`, `TeableConfigError`, `TeableRequestError`. `lib/teable/client.ts` re-exporta os três (imports existentes de consumidores continuam válidos).

- [ ] **Step 1: Criar `lib/teable/types.ts`**

```ts
export type TeableRecord<TFields extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  fields: TFields;
  createdTime?: string;
};

export class TeableConfigError extends Error {
  status = 503;
}

export class TeableRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: unknown
  ) {
    super(message);
  }
}
```

- [ ] **Step 2: Atualizar `lib/teable/client.ts`**

Substituir as linhas 1-38 (imports, `TeableRecord`, `TeableConfigError`, `TeableRequestError`) por:

```ts
import { getTeableConfig } from "./config";
import { getSchemaTable, TeableTableKey } from "./schema";
import { TeableConfigError, TeableRequestError } from "./types";
import type { TeableRecord } from "./types";

export { TeableConfigError, TeableRequestError } from "./types";
export type { TeableRecord } from "./types";

export type TeableListResponse<TFields extends Record<string, unknown> = Record<string, unknown>> = {
  records?: TeableRecord<TFields>[];
  data?: {
    records?: TeableRecord<TFields>[];
  };
};

export type TeableCreateResponse<TFields extends Record<string, unknown> = Record<string, unknown>> =
  | TeableRecord<TFields>
  | {
      records?: TeableRecord<TFields>[];
      data?: {
        records?: TeableRecord<TFields>[];
      };
    };
```

(O restante do arquivo — `trimSlash`, timeout, `TeableClient`, `safeUpdateRecord`, `getTeableClient` — permanece igual nesta task.)

- [ ] **Step 3: Rodar suite existente**

Run: `npm run test:unit && npm run typecheck`
Expected: PASS — todos os testes atuais verdes sem alteração (re-exports preservam a API).

- [ ] **Step 4: Commit**

```bash
git add lib/teable/types.ts lib/teable/client.ts
git commit -m "refactor: extract TeableRecord and error classes to lib/teable/types.ts"
```

---

### Task 3: Metadados de schema — `lib/supabase/tables.json`

**Files:**
- Create: `lib/supabase/tables.json`
- Test: `tests/unit/supabase-tables.test.ts`

**Interfaces:**
- Consumes: chaves de `lib/teable/schema.ts` (`TeableTableKey`).
- Produces: `tables.json` com shape `{ "tables": TableMeta[] }` onde `TableMeta = { key: string; tableName: string; jsonbColumns: string[]; fkColumns: Record<string, string>; hasCreatedAt: boolean }`. Importado pelo adapter (Task 5), pelo script de migração (Task 9) e pelo helper de QA (Task 11).

- [ ] **Step 1: Escrever o teste que falha**

`tests/unit/supabase-tables.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import tablesJson from "@/lib/supabase/tables.json";
import { teableSchema } from "@/lib/teable/schema";

const tables = tablesJson.tables as Array<{
  key: string;
  tableName: string;
  jsonbColumns: string[];
  fkColumns: Record<string, string>;
  hasCreatedAt: boolean;
}>;

describe("lib/supabase/tables.json", () => {
  it("covers every TeableTableKey exactly once", () => {
    expect(tables.map((t) => t.key).sort()).toEqual(teableSchema.map((t) => t.key).sort());
  });

  it("uses unique snake_case table names", () => {
    const names = tables.map((t) => t.tableName);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("only marks Teable json fields as jsonb columns", () => {
    for (const meta of tables) {
      const teableTable = teableSchema.find((t) => t.key === meta.key)!;
      const jsonFields = teableTable.fields.filter((f) => f.type === "json").map((f) => f.name);
      for (const column of meta.jsonbColumns) {
        // review_snapshot (flashcardAttempts) foi adicionado por ensure-flashcard-undo-fields
        // e não consta em teableSchema; é o único jsonb fora da lista.
        if (meta.key === "flashcardAttempts" && column === "review_snapshot") continue;
        expect(jsonFields).toContain(column);
      }
      for (const field of jsonFields) {
        expect(meta.jsonbColumns).toContain(field);
      }
    }
  });

  it("fkColumns target existing table names", () => {
    const names = new Set(tables.map((t) => t.tableName));
    for (const meta of tables) {
      for (const target of Object.values(meta.fkColumns)) {
        expect(names.has(target)).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/unit/supabase-tables.test.ts`
Expected: FAIL — módulo `@/lib/supabase/tables.json` não existe.

- [ ] **Step 3: Criar `lib/supabase/tables.json`**

```json
{
  "tables": [
    { "key": "users", "tableName": "users", "jsonbColumns": [], "fkColumns": { "active_language_id": "language_profiles" }, "hasCreatedAt": true },
    { "key": "languageProfiles", "tableName": "language_profiles", "jsonbColumns": [], "fkColumns": { "user_id": "users" }, "hasCreatedAt": true },
    { "key": "aiProviderSettings", "tableName": "ai_provider_settings", "jsonbColumns": [], "fkColumns": { "user_id": "users" }, "hasCreatedAt": false },
    { "key": "voiceProviderSettings", "tableName": "voice_provider_settings", "jsonbColumns": [], "fkColumns": { "user_id": "users" }, "hasCreatedAt": false },
    { "key": "conversations", "tableName": "conversations", "jsonbColumns": [], "fkColumns": { "user_id": "users", "language_profile_id": "language_profiles", "topic_id": "topics" }, "hasCreatedAt": false },
    { "key": "messages", "tableName": "messages", "jsonbColumns": [], "fkColumns": { "conversation_id": "conversations" }, "hasCreatedAt": true },
    { "key": "corrections", "tableName": "corrections", "jsonbColumns": [], "fkColumns": { "conversation_id": "conversations", "message_id": "messages" }, "hasCreatedAt": true },
    { "key": "words", "tableName": "words", "jsonbColumns": ["forms_json"], "fkColumns": { "user_id": "users", "language_profile_id": "language_profiles" }, "hasCreatedAt": false },
    { "key": "wordSenses", "tableName": "word_senses", "jsonbColumns": [], "fkColumns": { "word_id": "words" }, "hasCreatedAt": true },
    { "key": "wordOccurrences", "tableName": "word_occurrences", "jsonbColumns": [], "fkColumns": { "word_id": "words", "conversation_id": "conversations", "message_id": "messages" }, "hasCreatedAt": true },
    { "key": "wordUsageSummaries", "tableName": "word_usage_summaries", "jsonbColumns": ["forms_json"], "fkColumns": { "word_id": "words", "conversation_id": "conversations" }, "hasCreatedAt": false },
    { "key": "dailyFeedbacks", "tableName": "daily_feedbacks", "jsonbColumns": ["recurring_errors", "suggested_topics"], "fkColumns": { "user_id": "users", "language_profile_id": "language_profiles" }, "hasCreatedAt": true },
    { "key": "topics", "tableName": "topics", "jsonbColumns": [], "fkColumns": { "user_id": "users", "language_profile_id": "language_profiles", "related_feedback_id": "daily_feedbacks" }, "hasCreatedAt": true },
    { "key": "practiceSessions", "tableName": "practice_sessions", "jsonbColumns": ["configuration_json"], "fkColumns": { "user_id": "users", "language_profile_id": "language_profiles", "conversation_id": "conversations", "parent_session_id": "practice_sessions" }, "hasCreatedAt": true },
    { "key": "flashcards", "tableName": "flashcards", "jsonbColumns": ["supporting_word_ids", "accepted_answers"], "fkColumns": { "practice_session_id": "practice_sessions", "target_word_id": "words", "target_sense_id": "word_senses" }, "hasCreatedAt": true },
    { "key": "flashcardAttempts", "tableName": "flashcard_attempts", "jsonbColumns": ["review_snapshot"], "fkColumns": { "practice_session_id": "practice_sessions", "flashcard_id": "flashcards", "word_id": "words", "sense_id": "word_senses" }, "hasCreatedAt": true },
    { "key": "appEvents", "tableName": "app_events", "jsonbColumns": ["payload"], "fkColumns": { "user_id": "users" }, "hasCreatedAt": true }
  ]
}
```

Nota: `topics.related_words` NÃO é FK (é texto legado, cópia 1:1 — ver spec).

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/unit/supabase-tables.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/tables.json tests/unit/supabase-tables.test.ts
git commit -m "feat: add Supabase table metadata shared by app and scripts"
```

---

### Task 4: `lib/supabase/config.ts`

**Files:**
- Create: `lib/supabase/config.ts`
- Test: `tests/unit/supabase-config.test.ts`

**Interfaces:**
- Consumes: `getEnv`, `maskSecret` de `@/lib/env`.
- Produces:
  - `getSupabaseConfig(): { url?: string; serviceRoleKey?: string }`
  - `isSupabaseConfigured(): boolean`
  - `resolveDataBackend(): "teable" | "supabase"` — `DATA_BACKEND` explícito vence; ausente → `supabase` se configurado, senão `teable` (refinamento do spec: mantém testes/dev sem env Supabase funcionando no backend antigo).
  - `getSupabaseStatus(): { configured: boolean; urlConfigured: boolean; serviceRoleKeyConfigured: boolean; serviceRoleKeyMasked?: string; backend: "teable" | "supabase" }`

- [ ] **Step 1: Escrever o teste que falha**

`tests/unit/supabase-config.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupabaseConfig, getSupabaseStatus, isSupabaseConfigured, resolveDataBackend } from "@/lib/supabase/config";

describe("lib/supabase/config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports not configured when env vars are missing", () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(isSupabaseConfigured()).toBe(false);
    expect(getSupabaseConfig()).toEqual({ url: undefined, serviceRoleKey: undefined });
  });

  it("reports configured when both env vars are set", () => {
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    expect(isSupabaseConfigured()).toBe(true);
  });

  it("resolveDataBackend honors explicit DATA_BACKEND", () => {
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    vi.stubEnv("DATA_BACKEND", "teable");
    expect(resolveDataBackend()).toBe("teable");
    vi.stubEnv("DATA_BACKEND", "supabase");
    expect(resolveDataBackend()).toBe("supabase");
  });

  it("resolveDataBackend defaults to supabase when configured, teable otherwise", () => {
    vi.stubEnv("DATA_BACKEND", "");
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    expect(resolveDataBackend()).toBe("supabase");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(resolveDataBackend()).toBe("teable");
  });

  it("getSupabaseStatus never leaks the raw key", () => {
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key-secret");
    const status = getSupabaseStatus();
    expect(status.configured).toBe(true);
    expect(JSON.stringify(status)).not.toContain("service-key-secret");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/unit/supabase-config.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `lib/supabase/config.ts`**

```ts
import { getEnv, maskSecret } from "@/lib/env";

export type DataBackend = "teable" | "supabase";

export type SupabaseConfig = {
  url?: string;
  serviceRoleKey?: string;
};

export function getSupabaseConfig(): SupabaseConfig {
  return {
    url: getEnv("SUPABASE_URL"),
    serviceRoleKey: getEnv("SUPABASE_SERVICE_ROLE_KEY")
  };
}

export function isSupabaseConfigured() {
  const config = getSupabaseConfig();
  return Boolean(config.url && config.serviceRoleKey);
}

export function resolveDataBackend(): DataBackend {
  const explicit = (process.env.DATA_BACKEND ?? "").trim().toLowerCase();
  if (explicit === "teable" || explicit === "supabase") return explicit;
  return isSupabaseConfigured() ? "supabase" : "teable";
}

export function getSupabaseStatus() {
  const config = getSupabaseConfig();
  return {
    configured: isSupabaseConfigured(),
    urlConfigured: Boolean(config.url),
    serviceRoleKeyConfigured: Boolean(config.serviceRoleKey),
    serviceRoleKeyMasked: maskSecret(config.serviceRoleKey),
    backend: resolveDataBackend()
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/unit/supabase-config.test.ts`
Expected: PASS (5 testes). Se `getEnv`/`maskSecret` tiverem assinaturas diferentes das assumidas, conferir `lib/env.ts` e ajustar.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/config.ts tests/unit/supabase-config.test.ts
git commit -m "feat: add Supabase config with data backend resolution"
```

---

### Task 5: Adapter `lib/supabase/client.ts`

**Files:**
- Create: `lib/supabase/client.ts`
- Test: `tests/unit/supabase-client.test.ts`

**Interfaces:**
- Consumes: `lib/supabase/config.ts` (`getSupabaseConfig`), `lib/supabase/tables.json`, `lib/teable/types.ts` (`TeableRecord`, `TeableConfigError`, `TeableRequestError`), `TeableTableKey` de `lib/teable/schema`.
- Produces: `SupabaseTeableClient` com os mesmos métodos públicos de `TeableClient` (`healthcheck`, `listRecords`, `listAllRecords`, `listRecordsWhere`, `listRecordsWhereAll`, `getRecord`, `createRecord`, `updateRecord`, `deleteRecord`, `createEvent`) e `createSupabaseTeableClient()`. Usado pela factory na Task 6.

- [ ] **Step 1: Escrever o teste que falha**

`tests/unit/supabase-client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeableConfigError } from "@/lib/teable/types";

type BuilderResult = { data: unknown; error: unknown };

// Query builder thenable: cada método retorna o próprio builder; await resolve data/error.
function makeBuilder(result: BuilderResult) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "range", "eq", "is", "insert", "update", "delete"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (value: BuilderResult) => unknown) => resolve(result);
  return builder;
}

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  createClient: vi.fn()
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient
}));

import { createSupabaseTeableClient, SupabaseTeableClient } from "@/lib/supabase/client";

describe("SupabaseTeableClient", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    mocks.from.mockReset();
    mocks.createClient.mockReset();
    mocks.createClient.mockReturnValue({ from: mocks.from });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws TeableConfigError when env is missing", () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => new SupabaseTeableClient()).toThrow(TeableConfigError);
  });

  it("listRecords returns {id, fields} and stringifies jsonb columns", async () => {
    mocks.from.mockReturnValue(makeBuilder({
      data: [{ id: "uuid-1", legacy_id: "rec1", lemma: "hola", forms_json: ["hola", "holas"], total_uses: 3, created_at: null }],
      error: null
    }));
    const client = createSupabaseTeableClient();
    const records = await client.listRecords("words");
    expect(mocks.from).toHaveBeenCalledWith("words");
    expect(records).toEqual([
      {
        id: "uuid-1",
        createdTime: undefined,
        fields: { lemma: "hola", forms_json: "[\"hola\",\"holas\"]", total_uses: 3, created_at: null }
      }
    ]);
    expect(records[0].fields).not.toHaveProperty("legacy_id");
  });

  it("createRecord parses JSON strings into jsonb and converts empty strings to null", async () => {
    const builder = makeBuilder({ data: { id: "uuid-9", payload: { a: 1 }, event_name: "evt", created_at: "2026-08-12T00:00:00Z" }, error: null });
    mocks.from.mockReturnValue(builder);
    const client = createSupabaseTeableClient();
    await client.createRecord("appEvents", { event_name: "evt", payload: "{\"a\":1}", user_id: "" });
    expect(builder.insert).toHaveBeenCalledWith({ event_name: "evt", payload: { a: 1 }, user_id: null });
  });

  it("createRecord rejects invalid JSON strings for jsonb columns", async () => {
    mocks.from.mockReturnValue(makeBuilder({ data: null, error: null }));
    const client = createSupabaseTeableClient();
    await expect(client.createRecord("appEvents", { event_name: "evt", payload: "{not json" })).rejects.toThrow(/Invalid JSON/);
  });

  it("getRecord falls back to legacy_id for non-uuid ids", async () => {
    const builder = makeBuilder({ data: [{ id: "uuid-1", legacy_id: "recABC", name: "Personal" }], error: null });
    mocks.from.mockReturnValue(builder);
    const client = createSupabaseTeableClient();
    const record = await client.getRecord("users", "recABC");
    expect(builder.eq).toHaveBeenCalledWith("legacy_id", "recABC");
    expect(record).toEqual({ id: "uuid-1", createdTime: undefined, fields: { name: "Personal" } });
  });

  it("getRecord throws 404 TeableRequestError when missing", async () => {
    mocks.from.mockReturnValue(makeBuilder({ data: [], error: null }));
    const client = createSupabaseTeableClient();
    await expect(client.getRecord("users", "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/not found/);
  });

  it("listRecordsWhereAll maps empty-string filters to IS NULL", async () => {
    const builder = makeBuilder({ data: [], error: null });
    mocks.from.mockReturnValue(builder);
    const client = createSupabaseTeableClient();
    await client.listRecordsWhereAll("messages", [
      { field: "conversation_id", value: "uuid-1" },
      { field: "channel", value: "" }
    ]);
    expect(builder.eq).toHaveBeenCalledWith("conversation_id", "uuid-1");
    expect(builder.is).toHaveBeenCalledWith("channel", null);
  });

  it("createEvent stringifies payload like the Teable client", async () => {
    const builder = makeBuilder({ data: { id: "uuid-e", event_name: "test", payload: {}, created_at: "2026-08-12T00:00:00Z" }, error: null });
    mocks.from.mockReturnValue(builder);
    const client = createSupabaseTeableClient();
    await client.createEvent("uuid-user", "test", { hello: "world" });
    expect(builder.insert).toHaveBeenCalledWith({
      user_id: "uuid-user",
      event_name: "test",
      payload: { hello: "world" },
      created_at: expect.any(String)
    });
  });

  it("wraps supabase errors into TeableRequestError with status 502", async () => {
    mocks.from.mockReturnValue(makeBuilder({ data: null, error: { message: "permission denied" } }));
    const client = createSupabaseTeableClient();
    await expect(client.listRecords("users")).rejects.toThrow(/permission denied/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/unit/supabase-client.test.ts`
Expected: FAIL — módulo `@/lib/supabase/client` não existe.

- [ ] **Step 3: Implementar `lib/supabase/client.ts`**

```ts
import { createClient, type SupabaseClient as SupabaseJsClient } from "@supabase/supabase-js";
import type { TeableTableKey } from "@/lib/teable/schema";
import { TeableConfigError, TeableRequestError, type TeableRecord } from "@/lib/teable/types";
import { getSupabaseConfig } from "./config";
import tablesJson from "./tables.json";

type TableMeta = {
  key: string;
  tableName: string;
  jsonbColumns: string[];
  fkColumns: Record<string, string>;
  hasCreatedAt: boolean;
};

const TABLES = tablesJson.tables as TableMeta[];

const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSIENT_ERROR = /fetch failed|timed out|timeout|network|ECONNRESET|ETIMEDOUT|AbortError/i;

function tableMeta(tableKey: TeableTableKey): TableMeta {
  const meta = TABLES.find((table) => table.key === tableKey);
  if (!meta) throw new TeableConfigError(`Unknown table key: ${tableKey}`);
  return meta;
}

function withTimeoutSignal(signal?: AbortSignal | null) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export class SupabaseTeableClient {
  private db: SupabaseJsClient;

  constructor() {
    const config = getSupabaseConfig();
    if (!config.url) throw new TeableConfigError("SUPABASE_URL is not configured.");
    if (!config.serviceRoleKey) throw new TeableConfigError("SUPABASE_SERVICE_ROLE_KEY is not configured.");
    this.db = createClient(config.url, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (url, init) => fetch(url, { ...init, signal: withTimeoutSignal(init?.signal ?? null) })
      }
    });
  }

  private toRecord<TFields extends Record<string, unknown>>(meta: TableMeta, row: Record<string, unknown>): TeableRecord<TFields> {
    const jsonb = new Set(meta.jsonbColumns);
    const fields: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(row)) {
      if (column === "id" || column === "legacy_id") continue;
      fields[column] = jsonb.has(column) && value !== null && typeof value !== "string" ? JSON.stringify(value) : value;
    }
    const record: TeableRecord<TFields> = { id: String(row.id), fields: fields as TFields };
    if (typeof row.created_at === "string") record.createdTime = row.created_at;
    return record;
  }

  private toRow(meta: TableMeta, fields: Record<string, unknown>): Record<string, unknown> {
    const jsonb = new Set(meta.jsonbColumns);
    const row: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (value === "") {
        row[column] = null;
        continue;
      }
      if (jsonb.has(column) && typeof value === "string") {
        try {
          row[column] = JSON.parse(value);
        } catch {
          throw new TeableRequestError(`Invalid JSON string for column ${meta.tableName}.${column}.`, 400, value);
        }
        continue;
      }
      row[column] = value;
    }
    return row;
  }

  private unwrap<T>(result: { data: T | null; error: { message?: string } | null }, context: string): T {
    if (result.error) {
      throw new TeableRequestError(`Supabase ${context} failed: ${result.error.message ?? "unknown error"}`, 502, result.error);
    }
    return result.data as T;
  }

  // Idempotent reads get one retry on transient network/timeout failures,
  // mirroring TeableClient. Writes are never retried.
  private async read<T>(context: string, run: () => Promise<{ data: T | null; error: { message?: string } | null }>): Promise<T> {
    let result = await run();
    if (result.error && TRANSIENT_ERROR.test(result.error.message ?? "")) {
      result = await run();
    }
    return this.unwrap(result, context);
  }

  private idColumn(recordId: string) {
    return UUID_PATTERN.test(recordId) ? "id" : "legacy_id";
  }

  async healthcheck() {
    const meta = tableMeta("users");
    const result = await this.db.from(meta.tableName).select("id").limit(1);
    const attempts = [{ path: `rest/v1/${meta.tableName}`, status: result.error ? 502 : 200, ok: !result.error }];
    if (result.error) {
      throw new TeableRequestError("Supabase health query failed.", 502, { attempts, error: result.error });
    }
    return { reachable: true, authenticatedEndpoint: true, attempts };
  }

  async listRecords<TFields extends Record<string, unknown> = Record<string, unknown>>(tableKey: TeableTableKey, take = 20) {
    const meta = tableMeta(tableKey);
    const rows = await this.read("listRecords", () => this.db.from(meta.tableName).select("*").order("id").limit(take));
    return (rows ?? []).map((row) => this.toRecord<TFields>(meta, row as Record<string, unknown>));
  }

  async listAllRecords<TFields extends Record<string, unknown> = Record<string, unknown>>(tableKey: TeableTableKey) {
    const meta = tableMeta(tableKey);
    const records: TeableRecord<TFields>[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const rows = await this.read("listAllRecords", () =>
        this.db.from(meta.tableName).select("*").order("id").range(from, from + PAGE_SIZE - 1)
      );
      const page = (rows ?? []) as Array<Record<string, unknown>>;
      records.push(...page.map((row) => this.toRecord<TFields>(meta, row)));
      if (page.length < PAGE_SIZE) return records;
    }
  }

  async listRecordsWhere<TFields extends Record<string, unknown> = Record<string, unknown>>(
    tableKey: TeableTableKey,
    field: string,
    value: string
  ) {
    return this.listRecordsWhereAll<TFields>(tableKey, [{ field, value }]);
  }

  async listRecordsWhereAll<TFields extends Record<string, unknown> = Record<string, unknown>>(
    tableKey: TeableTableKey,
    filters: Array<{ field: string; value: string }>
  ) {
    const meta = tableMeta(tableKey);
    const records: TeableRecord<TFields>[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const rows = await this.read("listRecordsWhereAll", () => {
        let query = this.db.from(meta.tableName).select("*").order("id").range(from, from + PAGE_SIZE - 1);
        for (const { field, value } of filters) {
          if (value === "") {
            query = query.is(field, null);
          } else if (field === "id" && !UUID_PATTERN.test(value)) {
            query = query.eq("legacy_id", value);
          } else {
            query = query.eq(field, value);
          }
        }
        return query;
      });
      const page = (rows ?? []) as Array<Record<string, unknown>>;
      records.push(...page.map((row) => this.toRecord<TFields>(meta, row)));
      if (page.length < PAGE_SIZE) return records;
    }
  }

  async getRecord<TFields extends Record<string, unknown> = Record<string, unknown>>(tableKey: TeableTableKey, recordId: string) {
    const meta = tableMeta(tableKey);
    const rows = await this.read("getRecord", () =>
      this.db.from(meta.tableName).select("*").eq(this.idColumn(recordId), recordId).limit(1)
    );
    const row = (rows as Array<Record<string, unknown>> | null)?.[0];
    if (!row) {
      throw new TeableRequestError(`Supabase record not found in ${meta.tableName}: ${recordId}`, 404);
    }
    return this.toRecord<TFields>(meta, row);
  }

  async createRecord<TFields extends Record<string, unknown> = Record<string, unknown>>(
    tableKey: TeableTableKey,
    fields: TFields
  ) {
    const meta = tableMeta(tableKey);
    const inserted = this.unwrap(
      await this.db.from(meta.tableName).insert(this.toRow(meta, fields)).select("*").single(),
      "createRecord"
    );
    return this.toRecord<TFields>(meta, inserted as Record<string, unknown>);
  }

  async updateRecord<TFields extends Record<string, unknown> = Record<string, unknown>>(
    tableKey: TeableTableKey,
    recordId: string,
    fields: Partial<TFields>
  ) {
    const meta = tableMeta(tableKey);
    const updated = this.unwrap(
      await this.db.from(meta.tableName).update(this.toRow(meta, fields)).eq(this.idColumn(recordId), recordId).select("*").single(),
      "updateRecord"
    );
    return this.toRecord<TFields>(meta, updated as Record<string, unknown>);
  }

  async deleteRecord(tableKey: TeableTableKey, recordId: string) {
    const meta = tableMeta(tableKey);
    this.unwrap(
      await this.db.from(meta.tableName).delete().eq(this.idColumn(recordId), recordId),
      "deleteRecord"
    );
    return { deleted: true };
  }

  async createEvent(userId: string | undefined, eventName: string, payload: Record<string, unknown>) {
    return this.createRecord("appEvents", {
      user_id: userId ?? "",
      event_name: eventName,
      payload: JSON.stringify(payload),
      created_at: new Date().toISOString()
    });
  }
}

export function createSupabaseTeableClient() {
  return new SupabaseTeableClient();
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/unit/supabase-client.test.ts`
Expected: PASS (9 testes)

- [ ] **Step 5: Rodar suite completa + typecheck**

Run: `npm run test:unit && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/supabase/client.ts tests/unit/supabase-client.test.ts
git commit -m "feat: add SupabaseTeableClient adapter with TeableClient-compatible interface"
```

---

### Task 6: Factory em `getTeableClient()` + status de conexão

**Files:**
- Modify: `lib/teable/client.ts` (final do arquivo, função `getTeableClient`)
- Modify: `lib/settings/status.ts`
- Test: `tests/unit/data-backend-factory.test.ts`

**Interfaces:**
- Consumes: `createSupabaseTeableClient` (Task 5), `resolveDataBackend` (Task 4).
- Produces: `getTeableClient(): TeableClient` — retorna `SupabaseTeableClient` (cast) quando o backend ativo é supabase. Nenhum consumidor muda. `getConnectionStatus()` passa a incluir `backend` e `supabase`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/unit/data-backend-factory.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTeableClient } from "@/lib/teable/client";
import { SupabaseTeableClient } from "@/lib/supabase/client";
import { TeableClient } from "@/lib/teable/client";

describe("getTeableClient factory", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns TeableClient when DATA_BACKEND=teable even with Supabase configured", () => {
    vi.stubEnv("DATA_BACKEND", "teable");
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    vi.stubEnv("TEABLE_BASE_URL", "https://teable.local");
    vi.stubEnv("TEABLE_API_KEY", "token");
    expect(getTeableClient()).toBeInstanceOf(TeableClient);
  });

  it("returns SupabaseTeableClient when DATA_BACKEND=supabase", () => {
    vi.stubEnv("DATA_BACKEND", "supabase");
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    expect(getTeableClient()).toBeInstanceOf(SupabaseTeableClient);
  });

  it("defaults to SupabaseTeableClient when Supabase is configured and DATA_BACKEND is unset", () => {
    vi.stubEnv("DATA_BACKEND", "");
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    expect(getTeableClient()).toBeInstanceOf(SupabaseTeableClient);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/unit/data-backend-factory.test.ts`
Expected: FAIL — factory retorna sempre `TeableClient`.

- [ ] **Step 3: Implementar factory e status**

Em `lib/teable/client.ts`, adicionar import no topo:

```ts
import { createSupabaseTeableClient } from "@/lib/supabase/client";
import { resolveDataBackend } from "@/lib/supabase/config";
```

E substituir a função no final do arquivo:

```ts
export function getTeableClient(): TeableClient {
  if (resolveDataBackend() === "supabase") {
    // SupabaseTeableClient implementa a mesma interface pública; o cast evita
    // tocar nos ~15 consumidores que anotam o tipo TeableClient (classe com
    // membros privados não é estruturalmente assignável).
    return createSupabaseTeableClient() as unknown as TeableClient;
  }
  return new TeableClient();
}
```

Em `lib/settings/status.ts`, substituir o arquivo inteiro por:

```ts
import { getAiStatus } from "@/lib/ai/config";
import { getKokoroStatus } from "@/lib/kokoro/config";
import { getSupabaseStatus, resolveDataBackend } from "@/lib/supabase/config";
import { getTeableStatus } from "@/lib/teable/config";

export async function getConnectionStatus() {
  return {
    ai: await getAiStatus(),
    backend: resolveDataBackend(),
    teable: getTeableStatus(),
    supabase: getSupabaseStatus(),
    kokoro: getKokoroStatus()
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/unit/data-backend-factory.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Suite completa + segurança de bundle**

Run: `npm run test:unit && npm run typecheck && npm run lint && npm run security:bundle`
Expected: PASS. Se `security:bundle` falhar por causa de `SUPABASE_SERVICE_ROLE_KEY`, ajustar `scripts/verify-client-secrets.mjs` para tratá-la como secret server-only (mesmo tratamento de `TEABLE_API_KEY`).

- [ ] **Step 6: Commit**

```bash
git add lib/teable/client.ts lib/settings/status.ts tests/unit/data-backend-factory.test.ts
git commit -m "feat: route getTeableClient through DATA_BACKEND factory with Supabase adapter"
```

---

### Task 7: DDL do schema + script de aplicação

**Files:**
- Create: `supabase/migrations/0001_initial_schema.sql`
- Create: `scripts/apply-supabase-schema.mjs`

**Interfaces:**
- Consumes: `lib/supabase/tables.json` (nomes/colunas), `.env.local` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, opcional `SUPABASE_ACCESS_TOKEN`).
- Produces: as 17 tabelas criadas no projeto Supabase; script `apply-supabase-schema.mjs` com modos default (aplicar) e `--check` (verificar existência via PostgREST).

Decisões de DDL (paridade com Teable, sem quebrar deletes do app):
- Todas as FKs são `on delete set null` — no Teable relations eram texto e deletes nunca eram bloqueados; FKs restritivas quebrariam `deleteLearningHistory` (ordem de deleção em `lib/learning/account.ts`).
- FKs criadas via blocos `DO $$ ... IF NOT EXISTS (pg_constraint)` no final do arquivo (idempotente + resolve o ciclo `users.active_language_id` ↔ `language_profiles.user_id`).
- `created_at timestamptz default now()` em toda tabela com `hasCreatedAt: true`.

- [ ] **Step 1: Criar `supabase/migrations/0001_initial_schema.sql`**

```sql
-- AI Fluency — initial Supabase schema (migrated from Teable)
-- Idempotent: safe to re-run. All FKs use ON DELETE SET NULL to preserve
-- Teable semantics (relations were plain text; deletes were never blocked).

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  name text,
  avatar_url text,
  active_language_id uuid,
  timezone text,
  daily_new_cards_quota integer,
  created_at timestamptz default now()
);

create table if not exists language_profiles (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid,
  language_code text,
  language_name text,
  level text check (level is null or level = any (array['Iniciante', 'Intermediário (B1)', 'Avançado'])),
  learning_goal text,
  correction_style text check (correction_style is null or correction_style = any (array['Corrigir sempre', 'Corrigir no final', 'Só quando eu pedir'])),
  audio_enabled boolean,
  transcript_enabled boolean,
  calendar_memory_enabled boolean,
  weekly_conversation_goal integer,
  weekly_word_goal integer,
  created_at timestamptz default now(),
  updated_at timestamptz
);

create table if not exists ai_provider_settings (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid,
  provider text check (provider is null or provider = any (array['openai', 'anthropic', 'google', 'openrouter', 'custom', 'kokoro', 'deepseek'])),
  base_url text,
  api_key_masked text,
  chat_model text,
  reasoning_model text,
  temperature numeric,
  max_tokens integer,
  is_active boolean,
  last_test_status text check (last_test_status is null or last_test_status = any (array['not_tested', 'success', 'error'])),
  last_test_at timestamptz
);

create table if not exists voice_provider_settings (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid,
  provider text,
  base_url text,
  api_key_masked text,
  default_voice text,
  speech_speed numeric,
  output_format text check (output_format is null or output_format = any (array['mp3', 'wav', 'opus'])),
  is_active boolean,
  last_test_status text check (last_test_status is null or last_test_status = any (array['not_tested', 'success', 'error'])),
  last_test_at timestamptz
);

create table if not exists topics (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid,
  language_profile_id uuid,
  title text,
  source text check (source is null or source = any (array['user_custom', 'ai_suggestion', 'calendar_based', 'weak_words', 'recurring_error'])),
  reason text,
  related_feedback_id uuid,
  related_words text,
  difficulty text check (difficulty is null or difficulty = any (array['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])),
  created_at timestamptz default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid,
  language_profile_id uuid,
  topic_id uuid,
  mode text check (mode is null or mode = any (array['free_conversation', 'suggested_topic', 'custom_topic', 'review_words', 'calendar_focus'])),
  interaction_mode text check (interaction_mode is null or interaction_mode = any (array['conversation', 'simulation'])),
  target_user_message_count integer,
  status text check (status is null or status = any (array['preparing', 'active', 'completed', 'abandoned', 'failed', 'paused', 'error'])),
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  ai_model_used text,
  summary text
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  conversation_id uuid,
  role text check (role is null or role = any (array['user', 'assistant', 'system'])),
  text text,
  audio_url text,
  transcript_text text,
  language_detected text,
  tokens_used integer,
  client_request_id text,
  channel text check (channel is null or channel = any (array['practice', 'teacher'])),
  created_at timestamptz default now()
);

create table if not exists corrections (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  conversation_id uuid,
  message_id uuid,
  original_text text,
  corrected_text text,
  error_type text check (error_type is null or error_type = any (array['grammar', 'vocabulary', 'pronunciation', 'tense', 'preposition', 'word_order', 'naturalness', 'spelling'])),
  explanation text,
  severity text check (severity is null or severity = any (array['low', 'medium', 'high'])),
  should_interrupt boolean,
  created_at timestamptz default now()
);

create table if not exists words (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid,
  language_profile_id uuid,
  lemma text,
  canonical_key text unique,
  display_text text,
  forms_json jsonb,
  translation text,
  part_of_speech text,
  familiarity_score numeric,
  total_uses integer,
  last_used_at timestamptz,
  first_used_at timestamptz,
  review_due_at timestamptz,
  review_interval_days numeric,
  review_ease numeric,
  review_streak integer,
  lapse_count integer,
  last_reviewed_at timestamptz,
  last_rating text check (last_rating is null or last_rating = any (array['forgot', 'hard', 'good', 'easy'])),
  average_response_time_ms numeric,
  review_state text check (review_state is null or review_state = any (array['new', 'learning', 'review', 'difficult', 'suspended'])),
  review_version text,
  learning_step integer,
  implicit_review_at timestamptz,
  leech_flagged_at timestamptz
);

create table if not exists word_senses (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  word_id uuid,
  sense_key text unique,
  translation text,
  part_of_speech text,
  example_sentence text,
  source text check (source is null or source = any (array['chat', 'manual', 'backfill'])),
  is_primary boolean,
  sense_order integer,
  total_uses integer,
  review_due_at timestamptz,
  review_interval_days numeric,
  review_ease numeric,
  review_streak integer,
  lapse_count integer,
  learning_step integer,
  last_reviewed_at timestamptz,
  last_rating text check (last_rating is null or last_rating = any (array['forgot', 'hard', 'good', 'easy'])),
  average_response_time_ms numeric,
  review_state text check (review_state is null or review_state = any (array['new', 'learning', 'review', 'difficult', 'suspended'])),
  review_version text,
  leech_flagged_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists word_occurrences (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  word_id uuid,
  occurrence_key text unique,
  conversation_id uuid,
  message_id uuid,
  used_text text,
  sentence_context text,
  was_correct boolean,
  created_at timestamptz default now()
);

create table if not exists word_usage_summaries (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  usage_key text unique,
  word_id uuid,
  conversation_id uuid,
  forms_json jsonb,
  observed_count integer,
  correct_use_count integer,
  correction_count integer,
  first_used_at timestamptz,
  last_used_at timestamptz
);

create table if not exists daily_feedbacks (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid,
  language_profile_id uuid,
  date timestamptz,
  strengths text,
  weaknesses text,
  recommended_focus text,
  recurring_errors jsonb,
  new_words_count integer,
  correction_score numeric,
  fluency_score numeric,
  suggested_topics jsonb,
  created_at timestamptz default now()
);

create table if not exists practice_sessions (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid,
  language_profile_id uuid,
  conversation_id uuid,
  type text check (type is null or type = any (array['conversation', 'flashcards', 'weak_words', 'calendar_focus', 'recurring_error'])),
  focus text,
  status text check (status is null or status = any (array['preparing', 'active', 'completed', 'abandoned', 'failed', 'paused', 'error'])),
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  criterion text,
  requested_word_count integer,
  selected_word_count integer,
  unique_card_count integer,
  presentation_count integer,
  correct_count integer,
  incorrect_count integer,
  score numeric,
  language_code text,
  configuration_json jsonb,
  parent_session_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz
);

create table if not exists flashcards (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  practice_session_id uuid,
  target_word_id uuid,
  target_sense_id uuid,
  supporting_word_ids jsonb,
  card_type text check (card_type is null or card_type = any (array['target_to_native', 'native_to_target', 'cloze', 'listening'])),
  prompt text,
  expected_answer text,
  accepted_answers jsonb,
  translation text,
  explanation text,
  sentence text,
  audio_text text,
  difficulty numeric,
  initial_position integer,
  generation_source text check (generation_source is null or generation_source = any (array['ai', 'deterministic', 'fallback'])),
  created_at timestamptz default now()
);

create table if not exists flashcard_attempts (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  practice_session_id uuid,
  flashcard_id uuid,
  word_id uuid,
  sense_id uuid,
  presentation_number integer,
  client_attempt_id text,
  user_answer text,
  normalized_answer text,
  match_result text check (match_result is null or match_result = any (array['exact', 'acceptable', 'minor_error', 'incorrect', 'unknown'])),
  suggested_rating text check (suggested_rating is null or suggested_rating = any (array['forgot', 'hard', 'good', 'easy'])),
  final_rating text check (final_rating is null or final_rating = any (array['forgot', 'hard', 'good', 'easy'])),
  was_correct boolean,
  response_time_ms numeric,
  used_speech boolean,
  audio_replay_count integer,
  used_slow_audio boolean,
  answered_after_audio_replay boolean,
  audio_failed boolean,
  review_applied boolean,
  resulting_review_state text,
  review_snapshot jsonb,
  undone_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists app_events (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid,
  event_name text not null,
  payload jsonb,
  created_at timestamptz default now()
);

-- Foreign keys (idempotent; ON DELETE SET NULL preserves Teable semantics)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_active_language_id_fkey') then
    alter table users add constraint users_active_language_id_fkey foreign key (active_language_id) references language_profiles (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'language_profiles_user_id_fkey') then
    alter table language_profiles add constraint language_profiles_user_id_fkey foreign key (user_id) references users (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_provider_settings_user_id_fkey') then
    alter table ai_provider_settings add constraint ai_provider_settings_user_id_fkey foreign key (user_id) references users (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'voice_provider_settings_user_id_fkey') then
    alter table voice_provider_settings add constraint voice_provider_settings_user_id_fkey foreign key (user_id) references users (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'topics_user_id_fkey') then
    alter table topics add constraint topics_user_id_fkey foreign key (user_id) references users (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'topics_language_profile_id_fkey') then
    alter table topics add constraint topics_language_profile_id_fkey foreign key (language_profile_id) references language_profiles (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'topics_related_feedback_id_fkey') then
    alter table topics add constraint topics_related_feedback_id_fkey foreign key (related_feedback_id) references daily_feedbacks (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conversations_user_id_fkey') then
    alter table conversations add constraint conversations_user_id_fkey foreign key (user_id) references users (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conversations_language_profile_id_fkey') then
    alter table conversations add constraint conversations_language_profile_id_fkey foreign key (language_profile_id) references language_profiles (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conversations_topic_id_fkey') then
    alter table conversations add constraint conversations_topic_id_fkey foreign key (topic_id) references topics (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'messages_conversation_id_fkey') then
    alter table messages add constraint messages_conversation_id_fkey foreign key (conversation_id) references conversations (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'corrections_conversation_id_fkey') then
    alter table corrections add constraint corrections_conversation_id_fkey foreign key (conversation_id) references conversations (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'corrections_message_id_fkey') then
    alter table corrections add constraint corrections_message_id_fkey foreign key (message_id) references messages (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'words_user_id_fkey') then
    alter table words add constraint words_user_id_fkey foreign key (user_id) references users (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'words_language_profile_id_fkey') then
    alter table words add constraint words_language_profile_id_fkey foreign key (language_profile_id) references language_profiles (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'word_senses_word_id_fkey') then
    alter table word_senses add constraint word_senses_word_id_fkey foreign key (word_id) references words (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'word_occurrences_word_id_fkey') then
    alter table word_occurrences add constraint word_occurrences_word_id_fkey foreign key (word_id) references words (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'word_occurrences_conversation_id_fkey') then
    alter table word_occurrences add constraint word_occurrences_conversation_id_fkey foreign key (conversation_id) references conversations (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'word_occurrences_message_id_fkey') then
    alter table word_occurrences add constraint word_occurrences_message_id_fkey foreign key (message_id) references messages (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'word_usage_summaries_word_id_fkey') then
    alter table word_usage_summaries add constraint word_usage_summaries_word_id_fkey foreign key (word_id) references words (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'word_usage_summaries_conversation_id_fkey') then
    alter table word_usage_summaries add constraint word_usage_summaries_conversation_id_fkey foreign key (conversation_id) references conversations (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'daily_feedbacks_user_id_fkey') then
    alter table daily_feedbacks add constraint daily_feedbacks_user_id_fkey foreign key (user_id) references users (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'daily_feedbacks_language_profile_id_fkey') then
    alter table daily_feedbacks add constraint daily_feedbacks_language_profile_id_fkey foreign key (language_profile_id) references language_profiles (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'practice_sessions_user_id_fkey') then
    alter table practice_sessions add constraint practice_sessions_user_id_fkey foreign key (user_id) references users (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'practice_sessions_language_profile_id_fkey') then
    alter table practice_sessions add constraint practice_sessions_language_profile_id_fkey foreign key (language_profile_id) references language_profiles (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'practice_sessions_conversation_id_fkey') then
    alter table practice_sessions add constraint practice_sessions_conversation_id_fkey foreign key (conversation_id) references conversations (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'practice_sessions_parent_session_id_fkey') then
    alter table practice_sessions add constraint practice_sessions_parent_session_id_fkey foreign key (parent_session_id) references practice_sessions (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flashcards_practice_session_id_fkey') then
    alter table flashcards add constraint flashcards_practice_session_id_fkey foreign key (practice_session_id) references practice_sessions (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flashcards_target_word_id_fkey') then
    alter table flashcards add constraint flashcards_target_word_id_fkey foreign key (target_word_id) references words (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flashcards_target_sense_id_fkey') then
    alter table flashcards add constraint flashcards_target_sense_id_fkey foreign key (target_sense_id) references word_senses (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flashcard_attempts_practice_session_id_fkey') then
    alter table flashcard_attempts add constraint flashcard_attempts_practice_session_id_fkey foreign key (practice_session_id) references practice_sessions (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flashcard_attempts_flashcard_id_fkey') then
    alter table flashcard_attempts add constraint flashcard_attempts_flashcard_id_fkey foreign key (flashcard_id) references flashcards (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flashcard_attempts_word_id_fkey') then
    alter table flashcard_attempts add constraint flashcard_attempts_word_id_fkey foreign key (word_id) references words (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flashcard_attempts_sense_id_fkey') then
    alter table flashcard_attempts add constraint flashcard_attempts_sense_id_fkey foreign key (sense_id) references word_senses (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_events_user_id_fkey') then
    alter table app_events add constraint app_events_user_id_fkey foreign key (user_id) references users (id) on delete set null;
  end if;
end $$;

-- Indexes on hot FK columns
create index if not exists messages_conversation_id_idx on messages (conversation_id);
create index if not exists words_user_id_idx on words (user_id);
create index if not exists words_language_profile_id_idx on words (language_profile_id);
create index if not exists flashcards_practice_session_id_idx on flashcards (practice_session_id);
create index if not exists flashcard_attempts_practice_session_id_idx on flashcard_attempts (practice_session_id);
create index if not exists app_events_user_id_idx on app_events (user_id);
create index if not exists conversations_user_id_idx on conversations (user_id);
create index if not exists daily_feedbacks_user_id_idx on daily_feedbacks (user_id);
```

- [ ] **Step 2: Criar `scripts/apply-supabase-schema.mjs`**

```js
import fs from "node:fs";
import path from "node:path";
import { readEnv, required } from "./qa-env.mjs";
import tablesJson from "../lib/supabase/tables.json" with { type: "json" };

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const envPath = option("--env") ?? ".env.local";
const checkOnly = process.argv.includes("--check");
const env = readEnv(envPath);
const supabaseUrl = required(env, "SUPABASE_URL").replace(/\/+$/, "");
const serviceKey = required(env, "SUPABASE_SERVICE_ROLE_KEY");

const sqlPath = path.resolve("supabase/migrations/0001_initial_schema.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

async function checkTables() {
  const missing = [];
  for (const { tableName } of tablesJson.tables) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${tableName}?select=id&limit=1`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    if (!response.ok) missing.push({ tableName, status: response.status });
  }
  return missing;
}

if (checkOnly) {
  const missing = await checkTables();
  console.log(JSON.stringify({ ok: missing.length === 0, missing }, null, 2));
  process.exit(missing.length === 0 ? 0 : 1);
}

const accessToken = env.SUPABASE_ACCESS_TOKEN;
if (!accessToken) {
  console.log([
    "SUPABASE_ACCESS_TOKEN não configurado — aplicação manual:",
    `1. Abra o SQL Editor do projeto: ${supabaseUrl.replace("https://", "https://supabase.com/dashboard/project/").replace(".supabase.co", "")}/sql/new`,
    `2. Cole o conteúdo de: ${sqlPath}`,
    "3. Execute e depois rode: node scripts/apply-supabase-schema.mjs --check"
  ].join("\n"));
  process.exit(2);
}

const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql })
});
if (!response.ok) {
  throw new Error(`Management API failed: ${response.status} ${await response.text()}`);
}

const missing = await checkTables();
console.log(JSON.stringify({ ok: missing.length === 0, applied: true, missing }, null, 2));
process.exit(missing.length === 0 ? 0 : 1);
```

- [ ] **Step 3: Aplicar o schema no projeto Supabase**

Run: `node scripts/apply-supabase-schema.mjs`
Expected: se `SUPABASE_ACCESS_TOKEN` não estiver no `.env.local`, o script imprime as instruções do SQL Editor — segui-las (colar o SQL no dashboard) e então rodar `node scripts/apply-supabase-schema.mjs --check`.
Expected final: `{"ok": true, "missing": []}` (17/17 tabelas existem).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0001_initial_schema.sql scripts/apply-supabase-schema.mjs
git commit -m "feat: add initial Supabase schema DDL and apply script"
```

---

### Task 8: Backup integral do Teable (paginação corrigida)

`scripts/backup-learning-data.mjs` hoje lê só a primeira página (`take=1000` sem `skip`). Corrigir antes de migrar — este backup é o pré-requisito de segurança.

**Files:**
- Modify: `scripts/backup-learning-data.mjs:35-41`

**Interfaces:**
- Consumes: `teableRequest`, `recordsFrom` de `scripts/qa-env.mjs`.
- Produces: backup completo em `backups/` com contagens reais por tabela.

- [ ] **Step 1: Corrigir paginação**

Substituir o loop de leitura (linhas 35-41) por:

```js
const PAGE_SIZE = 1000;
for (const tableName of tableNames) {
  const all = [];
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const result = await teableRequest(
      env,
      `/api/table/${tableId(tableName)}/record?take=${PAGE_SIZE}&skip=${skip}&fieldKeyType=name`
    );
    const page = recordsFrom(result);
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  tables[tableName] = all;
}
```

- [ ] **Step 2: Rodar backup integral**

Run: `node scripts/backup-learning-data.mjs --env .env.local --out backups/pre-supabase-migration-$(date +%Y-%m-%d).json`
Expected: JSON com `ok: true` e contagens por tabela ≥ às do backup anterior (`backups/ai-fluency-prod-pre-word-senses-2026-08-12.json`: Users 1, LanguageProfiles 5, Topics 51, Conversations 45, Messages 224, Corrections 50, Words 236, WordSenses 3, WordOccurrences 76, WordUsageSummaries 250, DailyFeedbacks 16, PracticeSessions 64, Flashcards 186, FlashcardAttempts 220, AppEvents 571). Anotar as contagens — são o gate da Task 9.

- [ ] **Step 3: Commit**

```bash
git add scripts/backup-learning-data.mjs
git commit -m "fix: paginate backup-learning-data beyond the first 1000 records"
```

(Backups são artefatos locais — `backups/` já contém JSONs commitados no repo; seguir o padrão existente do usuário. Não commitar sem perguntar.)

---

### Task 9: Script de migração + execução + verificação

**Files:**
- Create: `scripts/migrate-teable-to-supabase.mjs`

**Interfaces:**
- Consumes: `readEnv`, `recordsFrom`, `required`, `teableRequest` de `scripts/qa-env.mjs`; `lib/supabase/tables.json`; backup da Task 8; schema aplicado (Task 7).
- Produces: dados no Supabase; `backups/supabase-id-map-<data>.json`; `backups/supabase-migration-report-<data>.json`; exit 0 somente se todos os gates passarem.

- [ ] **Step 1: Criar `scripts/migrate-teable-to-supabase.mjs`**

```js
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { readEnv, recordsFrom, required, teableRequest } from "./qa-env.mjs";
import tablesJson from "../lib/supabase/tables.json" with { type: "json" };

const TABLE_ENV = {
  users: "TEABLE_USERS_TABLE_ID",
  languageProfiles: "TEABLE_LANGUAGE_PROFILES_TABLE_ID",
  aiProviderSettings: "TEABLE_AI_PROVIDER_SETTINGS_TABLE_ID",
  voiceProviderSettings: "TEABLE_VOICE_PROVIDER_SETTINGS_TABLE_ID",
  conversations: "TEABLE_CONVERSATIONS_TABLE_ID",
  messages: "TEABLE_MESSAGES_TABLE_ID",
  corrections: "TEABLE_CORRECTIONS_TABLE_ID",
  words: "TEABLE_WORDS_TABLE_ID",
  wordSenses: "TEABLE_WORD_SENSES_TABLE_ID",
  wordOccurrences: "TEABLE_WORD_OCCURRENCES_TABLE_ID",
  wordUsageSummaries: "TEABLE_WORD_USAGE_SUMMARIES_TABLE_ID",
  dailyFeedbacks: "TEABLE_DAILY_FEEDBACKS_TABLE_ID",
  topics: "TEABLE_TOPICS_TABLE_ID",
  practiceSessions: "TEABLE_PRACTICE_SESSIONS_TABLE_ID",
  flashcards: "TEABLE_FLASHCARDS_TABLE_ID",
  flashcardAttempts: "TEABLE_FLASHCARD_ATTEMPTS_TABLE_ID",
  appEvents: "TEABLE_APP_EVENTS_TABLE_ID"
};

const PAGE_SIZE = 1000;
const BATCH = 200;
const date = new Date().toISOString().slice(0, 10);
const warnings = [];

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const env = readEnv(option("--env") ?? ".env.local");
const supabase = createClient(required(env, "SUPABASE_URL"), required(env, "SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function listAllTeable(tableId) {
  const all = [];
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const result = await teableRequest(env, `/api/table/${tableId}/record?take=${PAGE_SIZE}&skip=${skip}&fieldKeyType=name`);
    const page = recordsFrom(result);
    all.push(...page);
    if (page.length < PAGE_SIZE) return all;
  }
}

function toRow(meta, fields, { skipForeignKeys }) {
  const jsonb = new Set(meta.jsonbColumns);
  const foreignKeys = new Set(Object.keys(meta.fkColumns));
  const row = {};
  for (const [column, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (skipForeignKeys && foreignKeys.has(column)) continue;
    if (value === "") {
      row[column] = null;
      continue;
    }
    if (jsonb.has(column) && typeof value === "string") {
      try {
        row[column] = JSON.parse(value);
      } catch {
        row[column] = null;
        warnings.push(`${meta.tableName}.${column}: invalid JSON string stored as null (${String(value).slice(0, 60)})`);
      }
      continue;
    }
    row[column] = value;
  }
  return row;
}

function valuesEqual(column, meta, teableValue, supabaseValue, idMap) {
  const empty = (v) => v === undefined || v === null || v === "";
  if (empty(teableValue) && empty(supabaseValue)) return true;
  if (column in meta.fkColumns) {
    const expected = empty(teableValue) ? null : idMap[meta.fkColumns[column]]?.[teableValue] ?? null;
    return expected === supabaseValue;
  }
  if (meta.jsonbColumns.includes(column)) {
    try {
      const parsed = typeof teableValue === "string" ? JSON.parse(teableValue) : teableValue;
      return JSON.stringify(parsed) === JSON.stringify(supabaseValue);
    } catch {
      return supabaseValue === null;
    }
  }
  if (typeof supabaseValue === "number" || typeof teableValue === "number") {
    return Number(teableValue) === Number(supabaseValue);
  }
  if (/(_at|^date)$/.test(column) && teableValue && supabaseValue) {
    return Date.parse(teableValue) === Date.parse(supabaseValue);
  }
  return teableValue === supabaseValue;
}

// ---------- Preflight ----------
for (const meta of tablesJson.tables) {
  const { count, error } = await supabase.from(meta.tableName).select("id", { count: "exact", head: true });
  if (error) throw new Error(`Supabase table ${meta.tableName} not reachable: ${error.message}. Rode a Task 7 primeiro.`);
  if (count && count > 0) {
    throw new Error(`Supabase table ${meta.tableName} is not empty (${count} rows). Limpe manualmente antes de re-rodar.`);
  }
}

// ---------- Passada 1: insert sem FKs ----------
const idMap = {};
const teableData = {};
for (const meta of tablesJson.tables) {
  const records = await listAllTeable(required(env, TABLE_ENV[meta.key]));
  teableData[meta.key] = records;
  idMap[meta.tableName] = {};
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const rows = batch.map((record) => {
      const row = toRow(meta, record.fields ?? {}, { skipForeignKeys: true });
      row.legacy_id = record.id;
      if (meta.hasCreatedAt && row.created_at === undefined && record.createdTime) {
        row.created_at = record.createdTime;
      }
      return row;
    });
    if (rows.length === 0) continue;
    const { data, error } = await supabase.from(meta.tableName).insert(rows).select("id, legacy_id");
    if (error) throw new Error(`Insert failed on ${meta.tableName} (batch ${i / BATCH}): ${error.message}`);
    for (const inserted of data) idMap[meta.tableName][inserted.legacy_id] = inserted.id;
  }
  console.log(`pass1 ${meta.tableName}: ${records.length} records`);
}

fs.writeFileSync(path.resolve(`backups/supabase-id-map-${date}.json`), `${JSON.stringify(idMap, null, 2)}\n`, { mode: 0o600 });

// ---------- Passada 2: resolver FKs ----------
for (const meta of tablesJson.tables) {
  const records = teableData[meta.key];
  for (const record of records) {
    const updates = {};
    for (const [column, targetTable] of Object.entries(meta.fkColumns)) {
      const legacyRef = record.fields?.[column];
      if (legacyRef === undefined || legacyRef === null || legacyRef === "") continue;
      const uuid = idMap[targetTable]?.[legacyRef];
      if (uuid) {
        updates[column] = uuid;
      } else {
        warnings.push(`${meta.tableName}.${column}: orphaned reference ${legacyRef} (record ${record.id}) -> null`);
      }
    }
    if (Object.keys(updates).length === 0) continue;
    const { error } = await supabase.from(meta.tableName).update(updates).eq("legacy_id", record.id);
    if (error) throw new Error(`FK update failed on ${meta.tableName} record ${record.id}: ${error.message}`);
  }
  console.log(`pass2 ${meta.tableName}: FKs resolved`);
}

// ---------- Verificação ----------
const report = { createdAt: new Date().toISOString(), tables: {}, warnings, ok: true };
let failures = 0;
for (const meta of tablesJson.tables) {
  const records = teableData[meta.key];
  const { count } = await supabase.from(meta.tableName).select("id", { count: "exact", head: true });
  const countOk = count === records.length;
  if (!countOk) failures++;

  const sample = [...records].sort(() => Math.random() - 0.5).slice(0, Math.min(5, records.length));
  const sampleMismatches = [];
  for (const record of sample) {
    const { data, error } = await supabase.from(meta.tableName).select("*").eq("legacy_id", record.id).limit(1);
    const row = data?.[0];
    if (error || !row) {
      sampleMismatches.push({ legacyId: record.id, error: error?.message ?? "row not found" });
      continue;
    }
    for (const [column, value] of Object.entries(record.fields ?? {})) {
      if (!valuesEqual(column, meta, value, row[column], idMap)) {
        sampleMismatches.push({ legacyId: record.id, column, teable: value, supabase: row[column] });
      }
    }
  }
  if (sampleMismatches.length > 0) failures++;
  report.tables[meta.tableName] = { teable: records.length, supabase: count, countOk, sampleMismatches };
  console.log(`verify ${meta.tableName}: teable=${records.length} supabase=${count} sampleMismatches=${sampleMismatches.length}`);
}

report.ok = failures === 0;
fs.writeFileSync(path.resolve(`backups/supabase-migration-report-${date}.json`), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

const personalUserId = env.AI_FLUENCY_USER_ID;
if (personalUserId && idMap.users?.[personalUserId]) {
  console.log(`\nAÇÃO NECESSÁRIA: atualize AI_FLUENCY_USER_ID no .env.local de ${personalUserId} para ${idMap.users[personalUserId]}`);
}

console.log(`\nMigração ${report.ok ? "OK" : "FALHOU"} — relatório: backups/supabase-migration-report-${date}.json`);
process.exit(report.ok ? 0 : 1);
```

- [ ] **Step 2: Conferir assinatura de `teableRequest`/`recordsFrom`**

Run: `sed -n '40,80p' scripts/qa-env.mjs`
Expected: confirmar que `teableRequest(env, path)` monta a URL base e auth a partir do env (ajustar o script se a assinatura diferir).

- [ ] **Step 3: Rodar a migração**

Run: `node scripts/migrate-teable-to-supabase.mjs --env .env.local`
Expected: pass1/pass2/verify de todas as 17 tabelas; contagens iguais às anotadas na Task 8; `sampleMismatches=0` em todas; exit 0; mensagem com o novo valor de `AI_FLUENCY_USER_ID`.

Se falhar: ler `backups/supabase-migration-report-<data>.json`, corrigir a causa (ex.: valor de select fora dos CHECKs → ajustar o CHECK ou o dado), limpar as tabelas no Supabase (SQL Editor: `truncate <lista> cascade;`) e re-rodar.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-teable-to-supabase.mjs
git commit -m "feat: add Teable to Supabase migration script with verification gates"
```

---

### Task 10: Cutover local

**Files:**
- Modify: `.env.local` (local, não commitado)

**Interfaces:**
- Consumes: migração verificada (Task 9), factory (Task 6).

- [ ] **Step 1: Atualizar `.env.local`**

- `DATA_BACKEND=supabase`
- `AI_FLUENCY_USER_ID=<novo uuid impresso pela Task 9>`

- [ ] **Step 2: Healthcheck**

Run: `npm run dev` (background) e então `curl -s http://localhost:3000/api/health/teable | head -c 400`
Expected: resposta OK refletindo o backend Supabase (`reachable: true`).

- [ ] **Step 3: Testes automatizados**

Run: `npm run test:unit && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 4: Checklist manual no browser** (http://localhost:3000)

- [ ] Onboarding/perfil carrega (nome, perfis de idioma)
- [ ] Chat: enviar mensagem, receber resposta e correções (practice)
- [ ] Canal teacher abre e responde
- [ ] Flashcards: sessão completa, rating, undo
- [ ] /palavras lista palavras e senses
- [ ] /resumo e /calendario carregam feedbacks
- [ ] /settings: status de conexão mostra `backend: supabase`; teste de conexão OK; troca de modelo AI persiste
- [ ] Export de dados pessoais baixa JSON completo
- [ ] (não destrutivo) NÃO testar exclusão de histórico em prod — validar só em QA

- [ ] **Step 5: Rollback drill**

`DATA_BACKEND=teable` no `.env.local`, reiniciar dev server, confirmar que o app volta a ler do Teable. Restaurar `DATA_BACKEND=supabase`.

---

### Task 11: QA harness no Supabase

**Files:**
- Create: `scripts/lib/supabase-admin.mjs`
- Modify: `scripts/qa-fixture.mjs`, `scripts/qa-cleanup.mjs`, `scripts/qa-cleanup-latest.mjs`, `scripts/qa-recover-fixture.mjs`, `scripts/qa-verify-empty.mjs`, `scripts/reset-personal-test-data.mjs`, `scripts/validate-qa-environment.mjs`, `scripts/inspect-learning-scope.mjs`, `scripts/verify-sense-srs-live.mjs`, `scripts/verify-sense-ui-live.mjs`
- Modify: `.env.qa.example` (+ `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- Não migrar (permanecem Teable-only, arquivados): `ensure-*.mjs`, `backfill-*.mjs`, `migrate-*.mjs`, `setup-teable-schema.mjs`.

**Interfaces:**
- Produces: helper `scripts/lib/supabase-admin.mjs`:

```js
import { createClient } from "@supabase/supabase-js";
import tablesJson from "../../lib/supabase/tables.json" with { type: "json" };

const ENV_TO_KEY = {
  TEABLE_USERS_TABLE_ID: "users",
  TEABLE_LANGUAGE_PROFILES_TABLE_ID: "languageProfiles",
  TEABLE_AI_PROVIDER_SETTINGS_TABLE_ID: "aiProviderSettings",
  TEABLE_VOICE_PROVIDER_SETTINGS_TABLE_ID: "voiceProviderSettings",
  TEABLE_CONVERSATIONS_TABLE_ID: "conversations",
  TEABLE_MESSAGES_TABLE_ID: "messages",
  TEABLE_CORRECTIONS_TABLE_ID: "corrections",
  TEABLE_WORDS_TABLE_ID: "words",
  TEABLE_WORD_SENSES_TABLE_ID: "wordSenses",
  TEABLE_WORD_OCCURRENCES_TABLE_ID: "wordOccurrences",
  TEABLE_WORD_USAGE_SUMMARIES_TABLE_ID: "wordUsageSummaries",
  TEABLE_DAILY_FEEDBACKS_TABLE_ID: "dailyFeedbacks",
  TEABLE_TOPICS_TABLE_ID: "topics",
  TEABLE_PRACTICE_SESSIONS_TABLE_ID: "practiceSessions",
  TEABLE_FLASHCARDS_TABLE_ID: "flashcards",
  TEABLE_FLASHCARD_ATTEMPTS_TABLE_ID: "flashcardAttempts",
  TEABLE_APP_EVENTS_TABLE_ID: "appEvents"
};

function metaFor(envNameOrKey) {
  const key = ENV_TO_KEY[envNameOrKey] ?? envNameOrKey;
  const meta = tablesJson.tables.find((table) => table.key === key);
  if (!meta) throw new Error(`Unknown table: ${envNameOrKey}`);
  return meta;
}

export function getSupabaseAdmin(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export async function dbList(env, envNameOrKey, { limit = 1000 } = {}) {
  const meta = metaFor(envNameOrKey);
  const { data, error } = await getSupabaseAdmin(env).from(meta.tableName).select("*").limit(limit);
  if (error) throw new Error(`dbList ${meta.tableName}: ${error.message}`);
  return data.map((row) => ({ id: row.id, fields: Object.fromEntries(Object.entries(row).filter(([k]) => k !== "id" && k !== "legacy_id")) }));
}

export async function dbInsert(env, envNameOrKey, fields) {
  const meta = metaFor(envNameOrKey);
  const { data, error } = await getSupabaseAdmin(env).from(meta.tableName).insert(fields).select("*").single();
  if (error) throw new Error(`dbInsert ${meta.tableName}: ${error.message}`);
  return { id: data.id, fields: Object.fromEntries(Object.entries(data).filter(([k]) => k !== "id" && k !== "legacy_id")) };
}

export async function dbDelete(env, envNameOrKey, id) {
  const meta = metaFor(envNameOrKey);
  const { error } = await getSupabaseAdmin(env).from(meta.tableName).delete().eq("id", id);
  if (error) throw new Error(`dbDelete ${meta.tableName}: ${error.message}`);
}
```

- [ ] **Step 1: Criar o helper e testar conectividade QA**

Adicionar `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` a `.env.qa.example` e `.env.qa.local`.

Run: `node -e "import('./scripts/lib/supabase-admin.mjs').then(async m => { const { readEnv } = await import('./scripts/qa-env.mjs'); console.log(await m.dbList(readEnv('.env.qa.local'), 'TEABLE_USERS_TABLE_ID', { limit: 1 })); })"`
Expected: array (vazio ou com registros), sem erro.

- [ ] **Step 2: Converter os scripts, um por vez**

Padrão de conversão (exemplo com `scripts/reset-personal-test-data.mjs:21`):

Antes:
```js
await teableRequest(env, `/api/table/${tableId(name)}/record?take=${take}&fieldKeyType=name`)
```
Depois:
```js
await dbList(env, name, { limit: take })
```

Regras: leituras de registros → `dbList`; inserts → `dbInsert`; deletes por id → `dbDelete`; o helper devolve o shape `{ id, fields }` que os scripts já consomem. Manter `assertQaEnvironment` e demais guards intactos. **Scripts que gerenciam schema Teable (`ensure-*`, `/field`, `/base/.../table`) não são convertidos.**

Ordem e verificação por script:

1. `scripts/qa-verify-empty.mjs` → Run: `node scripts/qa-verify-empty.mjs --env .env.qa.local`
2. `scripts/qa-fixture.mjs` → Run: `npm run test:qa:seed`
3. `scripts/qa-cleanup.mjs` e `scripts/qa-cleanup-latest.mjs` → Run: `npm run test:qa:cleanup`
4. `scripts/qa-recover-fixture.mjs` → Run: `node scripts/qa-recover-fixture.mjs --env .env.qa.local`
5. `scripts/reset-personal-test-data.mjs` → somente dry-run/inspeção de código (não rodar em prod)
6. `scripts/validate-qa-environment.mjs` → Run: `npm run qa:validate`
7. `scripts/inspect-learning-scope.mjs` → Run: `npm run scope:inspect`
8. `scripts/verify-sense-srs-live.mjs` / `scripts/verify-sense-ui-live.mjs` → Run: `npm run senses:verify-live` no ambiente QA

- [ ] **Step 3: E2E contra Supabase QA**

Run: `npm run test:integration && npm run test:e2e`
Expected: PASS com `.env.qa.local` apontando para Supabase.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/supabase-admin.mjs scripts/qa-fixture.mjs scripts/qa-cleanup.mjs scripts/qa-cleanup-latest.mjs scripts/qa-recover-fixture.mjs scripts/qa-verify-empty.mjs scripts/reset-personal-test-data.mjs scripts/validate-qa-environment.mjs scripts/inspect-learning-scope.mjs scripts/verify-sense-srs-live.mjs scripts/verify-sense-ui-live.mjs .env.qa.example
git commit -m "feat: migrate QA harness scripts to Supabase backend"
```

---

### Task 12: Deploy e validação em produção

**Files:**
- Nenhum (Vercel env vars + deploy)

- [ ] **Step 1: Adicionar env vars no Vercel (Production)**

Via dashboard ou CLI:
```bash
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add DATA_BACKEND production   # valor: supabase
# AI_FLUENCY_USER_ID: atualizar para o novo uuid
```

- [ ] **Step 2: Deploy**

```bash
vercel deploy --prod
```
(ou push para a branch conectada — confirmar com o usuário antes de qualquer git push)

- [ ] **Step 3: Smoke em produção**

Run: `npm run test:smoke`
Expected: PASS contra o backend Supabase.

- [ ] **Step 4: Checklist manual em produção** — mesmo da Task 10 Step 4.

- [ ] **Step 5: Monitorar 48h** — erros atribuíveis ao backend = rollback (`DATA_BACKEND=teable` no Vercel + redeploy). Após 48h limpas, sugerir (não executar) desligamento do Teable e remoção futura do código arquivado.
