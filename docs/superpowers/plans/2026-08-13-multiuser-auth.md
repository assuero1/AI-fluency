# Multiusuário com Supabase Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o AI Fluency de single-user para multiusuário: login/logout com Supabase Auth (email+senha), sessão por cookie, RLS em todas as tabelas e queries executadas com o JWT do usuário.

**Architecture:** Supabase Auth + `@supabase/ssr` (sessão em cookie, middleware protege rotas). A tabela `users` ganha `auth_user_id` ligando a `auth.users`; um trigger cria o registro a cada signup. O adapter `SupabaseTeableClient` passa a usar um client autenticado por request (JWT do usuário), então o Postgres aplica RLS em 100% das queries. Backend Teable é removido ao final.

**Tech Stack:** Next.js 15 (App Router), React 19, `@supabase/supabase-js` 2.112, `@supabase/ssr` (novo), Postgres/Supabase RLS, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-13-multiuser-auth-design.md`

## Global Constraints

- Node `>=20.19.0 <23`; Next `^15.0.0`; TypeScript estrito (`npm run typecheck` deve passar).
- Sem libs de auth além de `@supabase/ssr` + `@supabase/supabase-js` (já presente).
- `SUPABASE_SERVICE_ROLE_KEY` **nunca** no runtime do app — só em `scripts/` e em `lib/supabase/admin.ts` (importado apenas por scripts e routes admin). Verificado por `npm run security:bundle`.
- Nenhuma env `NEXT_PUBLIC_*` nova: o browser nunca fala com o Supabase diretamente; todo acesso passa por server components/actions/routes.
- Padrão de erro existente: classes de erro com `status`, mapeadas em `lib/api/responses.ts` (`handleApiError`).
- Cache por request segue o padrão React `cache()` já usado em `lib/learning/profile.ts`.
- Mensagens de erro de auth são genéricas (não revelar se o email existe).
- Cada task termina com commit próprio (`git add` + `git commit`, mensagens em inglês, conventional commits como o histórico do repo).
- Não modificar `docs/` históricos de features anteriores (specs/plans antigos ficam como registro).

---

### Task 1: Migration SQL — auth_user_id, user_id denormalizado, RLS, trigger de signup

**Files:**
- Create: `supabase/migrations/0003_multiuser_auth_rls.sql`
- Modify: `scripts/apply-supabase-schema.mjs` (aceitar `--file <path>`)

**Interfaces:**
- Produces: coluna `users.auth_user_id uuid unique`; colunas `user_id uuid not null` em `messages`, `corrections`, `word_senses`, `word_occurrences`, `word_usage_summaries`, `flashcards`, `flashcard_attempts`; RLS habilitado nas 17 tabelas; trigger `on_auth_user_created`. Tasks 4 e 8 dependem dessas colunas.

- [ ] **Step 1: Generalizar o script de apply**

Em `scripts/apply-supabase-schema.mjs`, trocar a linha:

```js
const sqlPath = path.resolve("supabase/migrations/0001_initial_schema.sql");
```

por:

```js
const sqlPath = path.resolve(option("--file") ?? "supabase/migrations/0001_initial_schema.sql");
```

- [ ] **Step 2: Escrever a migration**

Criar `supabase/migrations/0003_multiuser_auth_rls.sql`:

```sql
-- Multiusuário: vínculo users↔auth.users, user_id denormalizado nas folhas, RLS.

-- 1. users ↔ auth.users
alter table public.users
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete cascade;

-- 2. user_id denormalizado nas tabelas-folha
alter table public.messages add column if not exists user_id uuid references public.users(id) on delete cascade;
alter table public.corrections add column if not exists user_id uuid references public.users(id) on delete cascade;
alter table public.word_senses add column if not exists user_id uuid references public.users(id) on delete cascade;
alter table public.word_occurrences add column if not exists user_id uuid references public.users(id) on delete cascade;
alter table public.word_usage_summaries add column if not exists user_id uuid references public.users(id) on delete cascade;
alter table public.flashcards add column if not exists user_id uuid references public.users(id) on delete cascade;
alter table public.flashcard_attempts add column if not exists user_id uuid references public.users(id) on delete cascade;

-- 3. Backfill via tabela-pai
update public.messages m set user_id = c.user_id from public.conversations c where m.conversation_id = c.id and m.user_id is null;
update public.corrections x set user_id = c.user_id from public.conversations c where x.conversation_id = c.id and x.user_id is null;
update public.word_senses s set user_id = w.user_id from public.words w where s.word_id = w.id and s.user_id is null;
update public.word_occurrences o set user_id = w.user_id from public.words w where o.word_id = w.id and o.user_id is null;
update public.word_usage_summaries u set user_id = w.user_id from public.words w where u.word_id = w.id and u.user_id is null;
update public.flashcards f set user_id = p.user_id from public.practice_sessions p where f.practice_session_id = p.id and f.user_id is null;
update public.flashcard_attempts a set user_id = p.user_id from public.practice_sessions p where a.practice_session_id = p.id and a.user_id is null;

-- 4. Órfãos (pai removido por ON DELETE SET NULL ficam sem dono): descartar e travar NOT NULL
delete from public.messages where user_id is null;
delete from public.corrections where user_id is null;
delete from public.word_senses where user_id is null;
delete from public.word_occurrences where user_id is null;
delete from public.word_usage_summaries where user_id is null;
delete from public.flashcards where user_id is null;
delete from public.flashcard_attempts where user_id is null;

alter table public.messages alter column user_id set not null;
alter table public.corrections alter column user_id set not null;
alter table public.word_senses alter column user_id set not null;
alter table public.word_occurrences alter column user_id set not null;
alter table public.word_usage_summaries alter column user_id set not null;
alter table public.flashcards alter column user_id set not null;
alter table public.flashcard_attempts alter column user_id set not null;

create index if not exists messages_user_id_idx on public.messages(user_id);
create index if not exists corrections_user_id_idx on public.corrections(user_id);
create index if not exists word_senses_user_id_idx on public.word_senses(user_id);
create index if not exists word_occurrences_user_id_idx on public.word_occurrences(user_id);
create index if not exists word_usage_summaries_user_id_idx on public.word_usage_summaries(user_id);
create index if not exists flashcards_user_id_idx on public.flashcards(user_id);
create index if not exists flashcard_attempts_user_id_idx on public.flashcard_attempts(user_id);

-- 5. Trigger: todo signup em auth.users ganha registro em public.users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (auth_user_id, "Name", timezone, created_at)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), 'America/Sao_Paulo', now());
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 6. RLS: users por auth_user_id; demais 16 tabelas por user_id
alter table public.users enable row level security;
create policy users_select_own on public.users for select using (auth_user_id = auth.uid());
create policy users_update_own on public.users for update using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

do $$
declare
  t text;
begin
  foreach t in array array[
    'language_profiles', 'ai_provider_settings', 'voice_provider_settings',
    'conversations', 'messages', 'corrections', 'words', 'word_senses',
    'word_occurrences', 'word_usage_summaries', 'daily_feedbacks', 'topics',
    'practice_sessions', 'flashcards', 'flashcard_attempts', 'app_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (user_id = auth.uid())', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert with check (user_id = auth.uid())', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete using (user_id = auth.uid())', t || '_delete_own', t);
  end loop;
end $$;
```

Antes de rodar: ler `supabase/migrations/0001_initial_schema.sql` e conferir que `users."Name"` e `users.created_at` existem com esses nomes; se `"Name"` for NOT NULL sem default, o trigger acima já cobre (insere `''` quando não há metadata).

- [ ] **Step 3: Aplicar no Supabase**

Rodar:

```bash
node scripts/apply-supabase-schema.mjs --file supabase/migrations/0003_multiuser_auth_rls.sql
```

Se `SUPABASE_ACCESS_TOKEN` não estiver em `.env.local`, o script imprime instruções de aplicação manual via SQL Editor — seguir essas instruções e rodar o check do Step 4 depois.

- [ ] **Step 4: Verificar**

Rodar contra o banco (SQL Editor ou `scripts/`):

```sql
select count(*) from messages where user_id is null;  -- esperado: 0
select count(*) from flashcards where user_id is null; -- esperado: 0
select tablename from pg_tables where schemaname = 'public' and rowsecurity = false; -- esperado: vazio
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0003_multiuser_auth_rls.sql scripts/apply-supabase-schema.mjs
git commit -m "feat: add multiuser auth migration (auth_user_id, leaf user_id, RLS, signup trigger)"
```

---

### Task 1B: Corrigir policies RLS — mapear auth.uid() → public.users.id

**Contexto:** a revisão da Task 1 encontrou um defeito do plano original: `public.users.id` é gerado por `gen_random_uuid()` e difere de `auth.users.id`; as policies `user_id = auth.uid()` nunca casariam. A migration 0003 já foi aplicada em produção — esta task cria a migration corretiva 0004. O usuário decidiu: corrigir com função de mapeamento (não migrar PKs).

**Files:**
- Create: `supabase/migrations/0004_fix_rls_policies.sql`

**Interfaces:**
- Produces: `public.current_user_id() returns uuid` (stable, security definer) — id do `public.users` da sessão atual; policies das 16 tabelas com `user_id` recriadas para comparar com `public.current_user_id()`. Tasks 4, 8 e 10 dependem disso.

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/0004_fix_rls_policies.sql`:

```sql
-- Corrige as policies da 0003: user_id referencia public.users.id, que difere
-- de auth.users.id. A função mapeia o auth id da sessão para o id público.

create or replace function public.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.users where auth_user_id = auth.uid()
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'language_profiles', 'ai_provider_settings', 'voice_provider_settings',
    'conversations', 'messages', 'corrections', 'words', 'word_senses',
    'word_occurrences', 'word_usage_summaries', 'daily_feedbacks', 'topics',
    'practice_sessions', 'flashcards', 'flashcard_attempts', 'app_events'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for select using (user_id = public.current_user_id())', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert with check (user_id = public.current_user_id())', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update using (user_id = public.current_user_id()) with check (user_id = public.current_user_id())', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete using (user_id = public.current_user_id())', t || '_delete_own', t);
  end loop;
end $$;
```

Notas: (a) `security definer` faz a função rodar como o dono (postgres), evitando recursão de RLS ao ler `public.users`; (b) as policies de `public.users` (`users_select_own`/`users_update_own`, que comparam `auth_user_id = auth.uid()`) estão corretas e **não** são tocadas.

- [ ] **Step 2: Aplicar no Supabase**

```bash
node scripts/apply-supabase-schema.mjs --file supabase/migrations/0004_fix_rls_policies.sql
```

- [ ] **Step 3: Verificar**

No SQL Editor ou via Management API:

```sql
select public.current_user_id();  -- sem sessão: null (esperado)
select polname from pg_policy join pg_class on pg_policy.polrelid = pg_class.oid
where pg_class.relname = 'words';  -- esperado: 4 policies recriadas
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0004_fix_rls_policies.sql
git commit -m "fix: map auth.uid() to public.users id in RLS policies"
```

---

### Task 2: Env + `@supabase/ssr` + clients server-side (request e service role)

**Files:**
- Create: `lib/supabase/server.ts`, `lib/supabase/admin.ts`
- Modify: `.env.example`, `.env.qa.example`, `package.json` (dep nova via npm install)
- Test: `tests/unit/supabase-server-client.test.ts`

**Interfaces:**
- Produces:
  - `getRequestSupabaseClient(): Promise<SupabaseClient>` — React-`cache`ada, client autenticado pelo cookie da request. Usada por Tasks 3, 4, 5, 6.
  - `createServiceRoleClient(): SupabaseClient` — service role, sem sessão. Usada por scripts (Tasks 9, 10).
  - Env nova: `SUPABASE_ANON_KEY` (server-only; sem prefixo `NEXT_PUBLIC_`).

- [ ] **Step 1: Instalar dependência e declarar env**

```bash
npm install @supabase/ssr
```

Em `.env.example`, na seção Supabase, adicionar:

```
# Supabase (data backend ativo quando configurado)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
# Anon key (server-only; usada pelo client autenticado por request com RLS)
SUPABASE_ANON_KEY=
```

Mesma linha em `.env.qa.example`. Adicionar o valor real em `.env.local` e `.env.qa.local` (Dashboard do Supabase → Settings → API → anon/public key).

- [ ] **Step 2: Teste falhando**

Criar `tests/unit/supabase-server-client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [{ name: "sb-token", value: "abc" }],
    set: vi.fn()
  }))
}));

describe("getRequestSupabaseClient", () => {
  it("cria client server-side a partir dos cookies da request", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    const { getRequestSupabaseClient } = await import("@/lib/supabase/server");
    const client = await getRequestSupabaseClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe("function");
    expect(typeof client.auth.getUser).toBe("function");
  });

  it("falha com erro claro sem SUPABASE_ANON_KEY", async () => {
    delete process.env.SUPABASE_ANON_KEY;
    vi.resetModules();
    const { getRequestSupabaseClient } = await import("@/lib/supabase/server");
    await expect(getRequestSupabaseClient()).rejects.toThrow(/SUPABASE_ANON_KEY/);
  });
});
```

Rodar: `npx vitest run tests/unit/supabase-server-client.test.ts`
Esperado: FAIL (módulo `@/lib/supabase/server` não existe).

- [ ] **Step 3: Implementar `lib/supabase/server.ts`**

```ts
import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getEnv } from "@/lib/env";
import { TeableConfigError } from "@/lib/teable/client";

function requireConfig() {
  const url = getEnv("SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY");
  if (!url) throw new TeableConfigError("SUPABASE_URL is not configured.");
  if (!anonKey) throw new TeableConfigError("SUPABASE_ANON_KEY is not configured.");
  return { url, anonKey };
}

// Cached per server request (React cache) so repeated callers within one
// request share a single client; outside a request it is a passthrough.
export const getRequestSupabaseClient = cache(async function getRequestSupabaseClient() {
  const { url, anonKey } = requireConfig();
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component (cookies are read-only there);
          // the middleware refreshes the session, so this is safe to ignore.
        }
      }
    }
  });
});
```

- [ ] **Step 4: Implementar `lib/supabase/admin.ts`**

```ts
import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";
import { TeableConfigError } from "@/lib/teable/client";

// Service role client: bypassa RLS. Uso restrito a scripts/ e routes admin
// (vinculação inicial, fixtures de QA). Nunca importar de páginas/actions do app.
export function createServiceRoleClient() {
  const url = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url) throw new TeableConfigError("SUPABASE_URL is not configured.");
  if (!serviceRoleKey) throw new TeableConfigError("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
```

- [ ] **Step 5: Testes passando + typecheck**

Rodar: `npx vitest run tests/unit/supabase-server-client.test.ts && npm run typecheck`
Esperado: PASS nos 2 testes; typecheck limpo.

- [ ] **Step 6: Commit**

```bash
git add lib/supabase/server.ts lib/supabase/admin.ts tests/unit/supabase-server-client.test.ts .env.example .env.qa.example package.json package-lock.json
git commit -m "feat: add per-request authenticated Supabase client and service-role admin client"
```

---

### Task 3: Adapter Supabase passa a usar o client autenticado da request

**Files:**
- Modify: `lib/supabase/client.ts` (construtor recebe o client; `createSupabaseTeableClient` nova assinatura)
- Modify: `lib/teable/client.ts:308-316` (`getTeableClient` usa o request client)
- Test: `tests/unit/supabase-adapter-auth.test.ts`

**Interfaces:**
- Consumes: `getRequestSupabaseClient()` da Task 2.
- Produces: `createSupabaseTeableClient(db: Promise<SupabaseClient>): SupabaseTeableClient`. `getTeableClient()` **mantém a assinatura síncrona** (zero mudança nos ~63 call sites): o client é resolvido lazy dentro de cada método async.

- [ ] **Step 1: Teste falhando**

Criar `tests/unit/supabase-adapter-auth.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

describe("SupabaseTeableClient com client injetado", () => {
  it("usa o client injetado para listRecords", async () => {
    const single = vi.fn(async () => ({ data: { id: "uuid-1", created_at: "2026-01-01" }, error: null }));
    const limit = vi.fn(() => ({ data: [{ id: "uuid-1", created_at: "2026-01-01" }], error: null }));
    const order = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));
    const fakeClient = { from };

    const { SupabaseTeableClient } = await import("@/lib/supabase/client");
    const adapter = new SupabaseTeableClient(Promise.resolve(fakeClient as never));
    const records = await adapter.listRecords("users", 5);

    expect(from).toHaveBeenCalledWith("users");
    expect(records[0]?.id).toBe("uuid-1");
  });
});
```

Rodar: `npx vitest run tests/unit/supabase-adapter-auth.test.ts`
Esperado: FAIL — construtor atual não aceita argumento.

- [ ] **Step 2: Refatorar `lib/supabase/client.ts`**

Trocar o campo `private db: SupabaseJsClient` e o construtor (linhas 35-52) por resolução lazy:

```ts
export class SupabaseTeableClient {
  private dbPromise: Promise<SupabaseJsClient>;

  constructor(db: Promise<SupabaseJsClient> | SupabaseJsClient) {
    this.dbPromise = Promise.resolve(db);
  }

  private db() {
    return this.dbPromise;
  }
```

Em cada método que hoje usa `this.db.from(...)` (`healthcheck`, `listRecords`, `listAllRecords`, `listRecordsWhereAll`, `getRecord`, `createRecord`, `updateRecord`, `deleteRecord`), trocar `this.db.from(` por `(await this.db()).from(`. Exemplo em `listRecords`:

```ts
async listRecords<TFields extends Record<string, unknown> = Record<string, unknown>>(tableKey: TeableTableKey, take = 20) {
  const meta = tableMeta(tableKey);
  const db = await this.db();
  const rows = await this.read("listRecords", () => db.from(meta.tableName).select("*").order("id").limit(take));
  return (rows ?? []).map((row) => this.toRecord<TFields>(meta, row as Record<string, unknown>));
}
```

Trocar a factory no fim do arquivo:

```ts
export function createSupabaseTeableClient(db: Promise<SupabaseJsClient> | SupabaseJsClient) {
  return new SupabaseTeableClient(db);
}
```

Remover os imports que ficaram sem uso (`createClient`, `getSupabaseConfig`).

- [ ] **Step 3: Ligar no `getTeableClient()`**

Em `lib/teable/client.ts:308-316`, trocar o corpo de `getTeableClient`:

```ts
export function getTeableClient(): TeableClient {
  if (resolveDataBackend() === "supabase") {
    // Client autenticado pelo cookie da request: o Postgres aplica RLS.
    return createSupabaseTeableClient(getRequestSupabaseClient()) as unknown as TeableClient;
  }
  return new TeableClient();
}
```

Adicionar o import `import { getRequestSupabaseClient } from "@/lib/supabase/server";` no topo.

- [ ] **Step 4: Testes + typecheck**

Rodar: `npx vitest run tests/unit/supabase-adapter-auth.test.ts tests/unit/data-backend-factory.test.ts && npm run typecheck`
Esperado: PASS. Se `data-backend-factory.test.ts` quebrar por causa da nova assinatura, ajustar o teste para passar um fake client ao construtor (mesmo padrão do Step 1).

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/client.ts lib/teable/client.ts tests/unit/supabase-adapter-auth.test.ts tests/unit/data-backend-factory.test.ts
git commit -m "feat: run Supabase adapter on the per-request authenticated client (RLS)"
```

---

### Task 4: `getSessionUser()` substitui a resolução single-user

**Files:**
- Modify: `lib/learning/profile.ts` (novas funções; remover `getExistingPersonalUser`, `getOrCreatePersonalUser`, `resolvePersonalUser`, `PersonalUserResolutionError`)
- Modify: `lib/learning/access.ts:33` (usa `getSessionUser`)
- Modify: `lib/api/responses.ts` (mapear `UnauthenticatedError` → 401; remover `PersonalUserResolutionError`)
- Modify: todos os consumidores (ver Step 3)
- Test: `tests/unit/session-user.test.ts` (novo); ajustar mocks nos testes existentes

**Interfaces:**
- Consumes: `getRequestSupabaseClient()` (Task 2), `getTeableClient()` autenticado (Task 3).
- Produces:
  - `getSessionUser(): Promise<TeableRecord<UserFields>>` — React-`cache`ada; lança `UnauthenticatedError` (status 401) sem sessão, `UserLinkError` (status 500) se não houver registro vinculado.
  - `updateSessionUserProfile(payload: { name?: string; timezone?: string }): Promise<TeableRecord<UserFields>>` — atualiza `Name`/`timezone` do usuário da sessão (substitui o uso com payload de `getOrCreatePersonalUser`).
  - `class UnauthenticatedError extends Error { status = 401 }` e `class UserLinkError extends Error { status = 500 }` em `lib/learning/profile.ts`.

- [ ] **Step 1: Teste falhando**

Criar `tests/unit/session-user.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const listRecordsWhereAll = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getRequestSupabaseClient: vi.fn(async () => ({ auth: { getUser } }))
}));
vi.mock("@/lib/teable/client", () => ({
  getTeableClient: () => ({ listRecordsWhereAll }),
  safeUpdateRecord: vi.fn(async (_t: string, _id: string, fields: unknown) => ({ id: "u1", fields })),
  TeableConfigError: class extends Error { status = 500 },
  TeableRequestError: class extends Error { status = 502 }
}));

describe("getSessionUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lança UnauthenticatedError (401) sem sessão", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { getSessionUser, UnauthenticatedError } = await import("@/lib/learning/profile");
    await expect(getSessionUser()).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("lança UserLinkError (500) quando não há registro vinculado", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    listRecordsWhereAll.mockResolvedValue([]);
    const { getSessionUser, UserLinkError } = await import("@/lib/learning/profile");
    await expect(getSessionUser()).rejects.toBeInstanceOf(UserLinkError);
  });

  it("retorna o registro users vinculado ao auth_user_id", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    listRecordsWhereAll.mockResolvedValue([{ id: "u1", fields: { Name: "Camila" } }]);
    const { getSessionUser } = await import("@/lib/learning/profile");
    const user = await getSessionUser();
    expect(listRecordsWhereAll).toHaveBeenCalledWith("users", [{ field: "auth_user_id", value: "auth-1" }]);
    expect(user.id).toBe("u1");
  });
});
```

Rodar: `npx vitest run tests/unit/session-user.test.ts`
Esperado: FAIL (exports não existem).

- [ ] **Step 2: Implementar em `lib/learning/profile.ts`**

Remover `PersonalUserResolutionError`, `getOrCreatePersonalUser`, `getExistingPersonalUser`, `resolvePersonalUser` e o uso de `AI_FLUENCY_USER_ID`. Adicionar:

```ts
import { getRequestSupabaseClient } from "@/lib/supabase/server";

export class UnauthenticatedError extends Error {
  status = 401;
}

export class UserLinkError extends Error {
  status = 500;
}

// Cached per server request (React cache): uma leitura de sessão + uma query
// por request; fora de request é passthrough.
export const getSessionUser = cache(async function getSessionUser() {
  const supabase = await getRequestSupabaseClient();
  const {
    data: { user: authUser }
  } = await supabase.auth.getUser();
  if (!authUser) {
    throw new UnauthenticatedError("Sessão expirada. Faça login novamente.");
  }

  const records = await getTeableClient().listRecordsWhereAll<UserFields>("users", [
    { field: "auth_user_id", value: authUser.id }
  ]);
  const record = records[0];
  if (!record) {
    // O trigger on_auth_user_created deveria ter criado o registro no signup.
    console.error(JSON.stringify({ event: "user_link_missing", auth_user_id: authUser.id, timestamp: new Date().toISOString() }));
    throw new UserLinkError("Conta sem perfil vinculado. Fale com o suporte.");
  }
  return record;
});

export async function updateSessionUserProfile(payload: Pick<OnboardingPayload, "name" | "timezone">) {
  const user = await getSessionUser();
  const updated = await getTeableClient().updateRecord<UserFields>("users", user.id, {
    Name: payload.name ?? user.fields.Name ?? "",
    timezone: payload.timezone ?? user.fields.timezone ?? "America/Sao_Paulo"
  });
  return updated;
}
```

- [ ] **Step 3: Atualizar todos os consumidores**

Padrão de substituição (sem payload → `getSessionUser()`; com payload → `getSessionUser()` + `updateSessionUserProfile(payload)`):

- `lib/learning/words.ts:320`, `home.ts:67`, `feedback.ts:319,399`, `progress.ts:29`, `flashcards.ts` (9 ocorrências), `account.ts:54,96,124,186,290`, `conversations.ts:361` → trocar `getOrCreatePersonalUser()` / `getExistingPersonalUser()` por `getSessionUser()` e ajustar os imports.
- `lib/learning/access.ts:33` → `const user = await getSessionUser();` envolto em try/catch: se `UnauthenticatedError`, retornar `{ gate: "login" as const, status, user: null, profile: null }`. Estender o tipo de retorno do gate com `"login"`.
- `app/api/onboarding/route.ts:14,32` → `const user = await getSessionUser();` e, onde antes criava com payload, `await updateSessionUserProfile({ name: body.name, timezone: body.timezone });`.
- `app/api/language-profiles/route.ts:14,26`, `app/api/profile/route.ts:31` → mesmo padrão.
- `app/api/events/route.ts:8` → `getSessionUser()`.
- `app/onboarding/page.tsx:8` → `getSessionUser()` (sem try/catch: middleware já garante sessão; se lançar, Next mostra error boundary — aceitável).
- Páginas que checam o gate (`grep -rln "getLearningGate" app`): adicionar `if (gate.gate === "login") redirect("/login");` antes dos branches existentes (defesa em profundidade — o middleware já redireciona, mas a página não deve renderizar com `user: null`).

- [ ] **Step 4: `handleApiError` mapeia 401**

Em `lib/api/responses.ts`: remover o import e o branch de `PersonalUserResolutionError`; adicionar:

```ts
import { UnauthenticatedError, UserLinkError } from "@/lib/learning/profile";
```

```ts
if (error instanceof UnauthenticatedError) {
  return jsonError(error.message, 401);
}

if (error instanceof UserLinkError) {
  return jsonError(error.message, error.status);
}
```

- [ ] **Step 5: Ajustar mocks dos testes existentes**

Nos arquivos `tests/unit/conversation-start.test.ts`, `chat-structured-turn.test.ts`, `account-level-preferences.test.ts`, `conversation-end.test.ts`, `flashcard-completion.test.ts`, `word-senses-detail.test.ts`, `flashcard-persistence.test.ts`: trocar nos mocks de `@/lib/learning/profile` (ou caminho relativo) as chaves `getExistingPersonalUser`/`getOrCreatePersonalUser` por `getSessionUser: vi.fn(async () => user)`. Rodar `npm run test:unit` e corrigir qualquer mock restante que referencie os nomes antigos (grep por `getOrCreatePersonalUser\|getExistingPersonalUser` em `tests/` deve ficar vazio).

- [ ] **Step 6: Testes + typecheck**

Rodar: `npm run test:unit && npm run typecheck`
Esperado: tudo verde.

- [ ] **Step 7: Commit**

```bash
git add lib/learning lib/api app tests/unit
git commit -m "feat: resolve current user from Supabase session (getSessionUser)"
```

---

### Task 5: Middleware — refresh de sessão + proteção de rotas

**Files:**
- Create: `lib/supabase/middleware.ts` (helper testável)
- Modify: `middleware.ts`
- Test: `tests/unit/auth-middleware.test.ts`

**Interfaces:**
- Consumes: env `SUPABASE_URL` + `SUPABASE_ANON_KEY` (Task 2).
- Produces: `isPublicPath(pathname: string): boolean` (exportada de `lib/supabase/middleware.ts`, usada no teste) e `updateSession(request: NextRequest): Promise<NextResponse>`.

- [ ] **Step 1: Teste falhando**

Criar `tests/unit/auth-middleware.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/supabase/middleware";

describe("isPublicPath", () => {
  it("libera rotas de auth e assets públicos", () => {
    for (const path of ["/login", "/auth/callback", "/reset-password", "/offline", "/sw.js", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"]) {
      expect(isPublicPath(path)).toBe(true);
    }
  });

  it("protege páginas e APIs do app", () => {
    for (const path of ["/", "/chat", "/palavras", "/perfil", "/settings", "/onboarding", "/api/home", "/api/conversations/start"]) {
      expect(isPublicPath(path)).toBe(false);
    }
  });
});
```

Rodar: `npx vitest run tests/unit/auth-middleware.test.ts`
Esperado: FAIL (módulo não existe).

- [ ] **Step 2: Implementar `lib/supabase/middleware.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PAGES = ["/login", "/auth/callback", "/reset-password", "/offline"];
const PUBLIC_FILES = ["/sw.js", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

export function isPublicPath(pathname: string) {
  return PUBLIC_FILES.includes(pathname) || PUBLIC_PAGES.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function updateSession(request: NextRequest) {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  let response = NextResponse.next({ request });

  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  if (!user && !isPublicPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "Não autenticado." }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }
  if (user && pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}
```

- [ ] **Step 3: Reescrever `middleware.ts` preservando o comportamento atual**

```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  const isAudioRoute = request.method === "GET" && /^\/api\/voice\/[a-f0-9]{64}$/.test(request.nextUrl.pathname);
  if (request.nextUrl.pathname.startsWith("/api/") && !isAudioRoute) {
    response.headers.set("Cache-Control", "no-store, max-age=0");
  }
  if (process.env.APP_ENV === "qa") response.headers.set("X-AI-Fluency-Environment", "qa");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
```

Nota: rotas de áudio (`/api/voice/[audioId]`) passam a exigir sessão — o player roda logado, ok.

- [ ] **Step 4: Testes + typecheck**

Rodar: `npx vitest run tests/unit/auth-middleware.test.ts && npm run typecheck`
Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add middleware.ts lib/supabase/middleware.ts tests/unit/auth-middleware.test.ts
git commit -m "feat: gate app routes behind Supabase session in middleware"
```

---

### Task 6: Telas de auth — /login, /reset-password, /auth/callback, server actions

**Files:**
- Create: `app/login/page.tsx`, `app/login/actions.ts`, `components/LoginForm.tsx`
- Create: `app/reset-password/page.tsx`, `components/ResetPasswordForm.tsx`
- Create: `app/auth/callback/route.ts`
- Test: cobertura e2e fica para a Task 10

**Interfaces:**
- Consumes: `getRequestSupabaseClient()` (Task 2 — server actions rodam em request, o client por cookie funciona).
- Produces: server actions `login`, `signup`, `requestPasswordReset` (em `app/login/actions.ts`, assinatura `(prevState: AuthFormState, formData: FormData) => Promise<AuthFormState>`), `updatePassword` (mesmo arquivo), `logout()` (em `app/login/actions.ts`, sem argumentos, usada pela Task 7). Tipo:

```ts
export type AuthFormState = { error?: string; success?: string };
```

- [ ] **Step 1: `app/login/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { getRequestSupabaseClient } from "@/lib/supabase/server";
import { getEnv } from "@/lib/env";

export type AuthFormState = { error?: string; success?: string };

const GENERIC_ERROR = "Email ou senha inválidos.";

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Informe email e senha." };

  const supabase = await getRequestSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: GENERIC_ERROR };
  redirect("/");
}

export async function signup(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!email || !password) return { error: "Informe email e senha." };
  if (password.length < 8) return { error: "A senha precisa de pelo menos 8 caracteres." };

  const supabase = await getRequestSupabaseClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name }, emailRedirectTo: `${getEnv("APP_URL") ?? ""}/auth/callback` }
  });
  if (error) return { error: "Não foi possível criar a conta. Tente outro email." };
  return { success: "Conta criada! Confira seu email para confirmar o cadastro." };
}

export async function requestPasswordReset(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Informe seu email." };

  const supabase = await getRequestSupabaseClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getEnv("APP_URL") ?? ""}/auth/callback?next=/reset-password`
  });
  // Mensagem idêntica para emails existentes ou não (não vazar existência).
  return { success: "Se o email estiver cadastrado, você receberá o link de redefinição." };
}

export async function updatePassword(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "A senha precisa de pelo menos 8 caracteres." };

  const supabase = await getRequestSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Não foi possível atualizar a senha. Abra o link do email novamente." };
  redirect("/");
}

export async function logout() {
  const supabase = await getRequestSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

- [ ] **Step 2: `app/auth/callback/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getEnv } from "@/lib/env";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (code) {
    const response = NextResponse.redirect(`${origin}${safeNext}`);
    const supabase = createServerClient(getEnv("SUPABASE_URL")!, getEnv("SUPABASE_ANON_KEY")!, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    });
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return response;
  }

  return NextResponse.redirect(`${origin}/login`);
}
```

- [ ] **Step 3: `app/login/page.tsx` + `components/LoginForm.tsx`**

`app/login/page.tsx`:

```tsx
import { LoginForm } from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <LoginForm />
    </main>
  );
}
```

`components/LoginForm.tsx` — client component com `useActionState`, três modos (entrar / criar conta / esqueci a senha), seguindo o visual dos componentes existentes (ver `components/ConversationSetupDialog.tsx` como referência de estilo de form):

```tsx
"use client";

import { useActionState, useState } from "react";
import { login, requestPasswordReset, signup, type AuthFormState } from "@/app/login/actions";

type Mode = "login" | "signup" | "reset";

const initialState: AuthFormState = {};

export function LoginForm() {
  const [mode, setMode] = useState<Mode>("login");
  const action = mode === "login" ? login : mode === "signup" ? signup : requestPasswordReset;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="mb-1 text-xl font-semibold text-slate-900">AI Fluency</h1>
      <p className="mb-4 text-sm text-slate-500">
        {mode === "login" ? "Entre na sua conta" : mode === "signup" ? "Crie sua conta" : "Redefinir senha"}
      </p>

      <form action={formAction} className="flex flex-col gap-3">
        {mode === "signup" && (
          <input name="name" placeholder="Seu nome" autoComplete="name" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        )}
        <input name="email" type="email" required placeholder="Email" autoComplete="email" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        {mode !== "reset" && (
          <input name="password" type="password" required minLength={8} placeholder="Senha" autoComplete={mode === "login" ? "current-password" : "new-password"} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        )}

        {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
        {state.success && <p role="status" className="text-sm text-emerald-600">{state.success}</p>}

        <button type="submit" disabled={pending} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Aguarde..." : mode === "login" ? "Entrar" : mode === "signup" ? "Criar conta" : "Enviar link"}
        </button>
      </form>

      <div className="mt-4 flex flex-col gap-1 text-sm">
        {mode !== "login" && (
          <button type="button" onClick={() => setMode("login")} className="text-left text-slate-600 underline">Já tenho conta — entrar</button>
        )}
        {mode !== "signup" && (
          <button type="button" onClick={() => setMode("signup")} className="text-left text-slate-600 underline">Criar conta</button>
        )}
        {mode !== "reset" && (
          <button type="button" onClick={() => setMode("reset")} className="text-left text-slate-600 underline">Esqueci a senha</button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `app/reset-password/page.tsx` + `components/ResetPasswordForm.tsx`**

`app/reset-password/page.tsx`:

```tsx
import { ResetPasswordForm } from "@/components/ResetPasswordForm";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <ResetPasswordForm />
    </main>
  );
}
```

`components/ResetPasswordForm.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { updatePassword, type AuthFormState } from "@/app/login/actions";

const initialState: AuthFormState = {};

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, initialState);

  return (
    <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Nova senha</h1>
      <form action={formAction} className="flex flex-col gap-3">
        <input name="password" type="password" required minLength={8} placeholder="Nova senha" autoComplete="new-password" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
        <button type="submit" disabled={pending} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Aguarde..." : "Salvar nova senha"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck + lint + smoke manual**

Rodar: `npm run typecheck && npm run lint`
Esperado: limpo. Depois `npm run dev`, abrir `/login`, criar conta com email real, confirmar email (link cai em `/auth/callback`), entrar. **Pré-requisito de dashboard:** no Supabase (Authentication → Providers → Email) manter "Confirm email" ligado; em Authentication → URL Configuration, setar Site URL = `APP_URL` e adicionar `APP_URL/auth/callback` em Redirect URLs.

- [ ] **Step 6: Commit**

```bash
git add app/login app/reset-password app/auth components/LoginForm.tsx components/ResetPasswordForm.tsx
git commit -m "feat: add login, signup and password reset screens (Supabase Auth)"
```

---

### Task 7: Logout real no perfil

**Files:**
- Create: `components/LogoutButton.tsx`
- Modify: `app/perfil/page.tsx` (adicionar o botão)

**Interfaces:**
- Consumes: `logout()` de `app/login/actions.ts` (Task 6).

- [ ] **Step 1: `components/LogoutButton.tsx`**

```tsx
"use client";

import { LogOut } from "lucide-react";
import { logout } from "@/app/login/actions";

export function LogoutButton() {
  return (
    <button
      type="button"
      onClick={() => logout()}
      className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
    >
      <LogOut size={16} />
      Sair da conta
    </button>
  );
}
```

- [ ] **Step 2: Adicionar em `app/perfil/page.tsx`**

Ler `app/perfil/page.tsx`, localizar o bloco principal de conteúdo e renderizar `<LogoutButton />` ao final (import no topo). O ícone `LogOut` em `components/ChatConversation.tsx:509` é "abandonar treino" — **não** mexer.

- [ ] **Step 3: Verificar**

`npm run typecheck && npm run lint`, depois smoke manual: logado, abrir `/perfil`, clicar "Sair da conta" → cai em `/login`; acessar `/` → middleware redireciona para `/login`.

- [ ] **Step 4: Commit**

```bash
git add components/LogoutButton.tsx app/perfil/page.tsx
git commit -m "feat: add real logout action on profile page"
```

---

### Task 8: user_id nos write paths das tabelas-folha + fim do filtro em memória

**Files:**
- Modify: `lib/learning/conversations.ts`, `lib/learning/flashcards.ts`, `lib/learning/word-senses.ts`, `lib/learning/words.ts`, `lib/learning/account.ts`, `lib/learning/home.ts`, `lib/learning/progress.ts`, `lib/learning/tutor-context.ts` (somente onde aplicável)
- Modify: `lib/learning/scope.ts` (remover helpers de filtro em memória se ficarem sem uso)
- Test: `npm run test:unit` inteiro (testes de escopo existentes em `tests/unit/` devem continuar passando ou ser ajustados)

**Interfaces:**
- Consumes: colunas `user_id` NOT NULL das folhas (Task 1), `getSessionUser()` (Task 4).
- Produces: todo `createRecord` nas tabelas `messages`, `corrections`, `word_senses`, `word_occurrences`, `word_usage_summaries`, `flashcards`, `flashcard_attempts` inclui `user_id` no payload.

- [ ] **Step 1: Mapear os write paths**

Rodar:

```bash
grep -rn 'createRecord' lib/learning | grep -E '"(messages|corrections|wordSenses|wordOccurrences|wordUsageSummaries|flashcards|flashcardAttempts)"'
```

Esperado: todas as ocorrências ficam em `conversations.ts`, `flashcards.ts`, `word-senses.ts`, `words.ts`. Se aparecer outro arquivo, incluí-lo nesta task.

- [ ] **Step 2: Adicionar `user_id` em cada createRecord das folhas**

Padrão: cada função que cria registros-folha já tem o `user` em escopo (via `getSessionUser()` após a Task 4) ou recebe `userId`. Adicionar `user_id: user.id` ao payload. Exemplo (o código exato varia por call site):

```ts
await client.createRecord("messages", {
  user_id: user.id,
  conversation_id: conversation.id,
  role: "user",
  content: text,
  created_at: new Date().toISOString()
});
```

Pontos de atenção:
- `flashcard_attempts`: usa `practice_session_id` — o `user_id` vem do dono da sessão (o `user` da request).
- Se algum call site não tiver `user` em escopo, subir na cadeia de chamada até onde `getSessionUser()` já foi chamado e passar `user.id` por parâmetro.
- `createEvent` (`lib/supabase/client.ts:221`) grava em `app_events` com `user_id ?? ""`, que vira `null` no adapter e **falha na policy de insert** (RLS exige `user_id = public.current_user_id()`). Rodar `grep -rn "createEvent(" lib app` e garantir que todo call site passa `user.id`; nenhum evento pode ser gravado sem usuário autenticado.

- [ ] **Step 3: Remover o scoping em memória**

Com RLS ativo, `listAllRecords` já retorna só as linhas do usuário da sessão. Trocar os padrões "baixa tudo e filtra em JS" por queries filtradas quando já existir helper, ou confiar no RLS e remover o filtro JS:

- `lib/learning/account.ts:288-333` (`getScopedLearningData`): trocar `listAllRecords` por `listRecordsWhereAll(table, [{ field: "user_id", value: user.id }])` nas tabelas que têm `user_id` direto (`words`, `conversations`, `practice_sessions`, `daily_feedbacks`, `topics`, `app_events`, `language_profiles`) e remover as chamadas a `matchesUserScope`/`matchesLearningScope`.
- `lib/learning/words.ts`, `home.ts`, `progress.ts`, `flashcards.ts`, `word-senses.ts`, `tutor-context.ts`: mesma substituição nos `listAllRecords` restantes (33 ocorrências mapeadas por grep no início da task; re-rodar o grep ao final e esperar zero fora de `lib/supabase/client.ts` e `lib/teable/client.ts`).
- `lib/learning/scope.ts`: se `matchesUserScope`/`matchesLearningScope` ficarem sem nenhum uso (`grep -rn "matchesUserScope\|matchesLearningScope" lib app`), remover as funções; manter o que ainda for usado para validação de propriedade em writes.

- [ ] **Step 4: Testes**

Rodar: `npm run test:unit && npm run typecheck`
Esperado: verde. Testes que mockam `listAllRecords` precisam mockar `listRecordsWhereAll` no lugar — ajustar os mocks mantendo a intenção original de cada teste.

- [ ] **Step 5: Commit**

```bash
git add lib/learning tests/unit
git commit -m "feat: scope all learning queries by user_id in the database (RLS era)"
```

---

### Task 9: Vincular o usuário existente à primeira conta de auth

**Files:**
- Create: `scripts/link-existing-user.mjs`

**Interfaces:**
- Consumes: `createServiceRoleClient()` (Task 2) via import relativo `../lib/supabase/admin.ts` não funciona em `.mjs` — o script usa `fetch` direto contra a API Admin do Supabase (mesmo padrão de `scripts/apply-supabase-schema.mjs`).

- [ ] **Step 1: Escrever `scripts/link-existing-user.mjs`**

```js
import { readEnv, required } from "./qa-env.mjs";

const env = readEnv(".env.local");
const supabaseUrl = required(env, "SUPABASE_URL").replace(/\/+$/, "");
const serviceKey = required(env, "SUPABASE_SERVICE_ROLE_KEY");
const authEmail = required(env, "LINK_AUTH_EMAIL"); // email da conta criada no /login

const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

// 1. Acha o auth user pelo email (Admin API)
const listRes = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=200`, { headers });
if (!listRes.ok) throw new Error(`Admin list failed: ${listRes.status} ${await listRes.text()}`);
const { users: authUsers } = await listRes.json();
const authUser = authUsers.find((u) => u.email?.toLowerCase() === authEmail.toLowerCase());
if (!authUser) throw new Error(`Nenhum auth user com email ${authEmail}. Crie a conta no /login primeiro.`);

// 2. Acha o registro users ainda não vinculado que tem dados (o usuário pessoal)
const usersRes = await fetch(`${supabaseUrl}/rest/v1/users?auth_user_id=is.null&select=id,Name`, { headers });
if (!usersRes.ok) throw new Error(`Users query failed: ${usersRes.status} ${await usersRes.text()}`);
const candidates = await usersRes.json();
if (candidates.length !== 1) {
  throw new Error(`Esperado exatamente 1 usuário sem vínculo, achei ${candidates.length}. Revise manualmente.`);
}

// 3. Vincula
const updateRes = await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${candidates[0].id}`, {
  method: "PATCH",
  headers: { ...headers, Prefer: "return=representation" },
  body: JSON.stringify({ auth_user_id: authUser.id })
});
if (!updateRes.ok) throw new Error(`Link failed: ${updateRes.status} ${await updateRes.text()}`);

console.log(JSON.stringify({ ok: true, usersRecord: candidates[0].id, authUser: authUser.id, email: authUser.email }, null, 2));
```

- [ ] **Step 2: Rodar**

Pré-requisito: a conta real já foi criada via `/login` (Task 6, smoke manual). Rodar:

```bash
LINK_AUTH_EMAIL=seu-email@example.com node scripts/link-existing-user.mjs
```

Esperado: `{ ok: true, ... }`. Verificar login: ao entrar com essa conta, a home mostra os dados antigos (240 palavras, 48 conversas).

- [ ] **Step 3: Commit**

```bash
git add scripts/link-existing-user.mjs
git commit -m "feat: add one-off script to link legacy personal user to auth account"
```

---

### Task 10: QA e testes — usuários de teste, e2e de auth, isolamento multitenant

**Files:**
- Create: `scripts/qa-create-auth-user.mjs`
- Create: `tests/e2e/auth.spec.ts`
- Create: `scripts/verify-multitenant-isolation.mjs` (rodado por `test:integration`)
- Modify: `package.json` (script `test:isolation` + inclusão no `test:release` se o harness permitir)

**Interfaces:**
- Consumes: tudo das Tasks 1-9.

- [ ] **Step 1: `scripts/qa-create-auth-user.mjs`**

Cria usuário de teste já confirmado (QA não tem caixa de email):

```js
import { readEnv, required } from "./qa-env.mjs";

const envPath = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : ".env.qa.local";
const env = readEnv(envPath);
const supabaseUrl = required(env, "SUPABASE_URL").replace(/\/+$/, "");
const serviceKey = required(env, "SUPABASE_SERVICE_ROLE_KEY");
const email = required(env, "QA_USER_EMAIL");
const password = required(env, "QA_USER_PASSWORD");

const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name: "QA" } })
});
if (!response.ok && response.status !== 422) throw new Error(`Create failed: ${response.status} ${await response.text()}`);
console.log(JSON.stringify({ ok: true, email }));
```

Adicionar `QA_USER_EMAIL` e `QA_USER_PASSWORD` em `.env.qa.example`.

- [ ] **Step 2: E2E `tests/e2e/auth.spec.ts`**

Seguir o padrão dos specs existentes em `tests/e2e/` (ver `playwright.config.ts` para baseURL e fixtures de QA):

```ts
import { expect, test } from "@playwright/test";

const email = process.env.QA_USER_EMAIL!;
const password = process.env.QA_USER_PASSWORD!;

test("usuário deslogado é redirecionado para /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("login com credenciais válidas leva à home", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("/");
});

test("logout volta para /login", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/perfil");
  await page.getByRole("button", { name: "Sair da conta" }).click();
  await expect(page).toHaveURL(/\/login/);
});
```

Se os specs e2e existentes assumem app sem login, adicionar um `globalSetup` ou fixture que faz login via API (`page.request.post` contra `signInWithPassword` não existe — usar UI login uma vez e `storageState`). Ver `playwright.config.ts` e adequar; o critério é `npm run test:e2e` verde.

- [ ] **Step 3: `scripts/verify-multitenant-isolation.mjs`**

Cria dois usuários efêmeros A e B (Admin API), autentica como cada um via `POST /auth/v1/token?grant_type=password`, insere uma `word` como A e verifica: (a) B não vê a word de A; (b) B não consegue atualizar a word de A. Limpa tudo ao final (`DELETE /auth/v1/admin/users/:id`; o `on delete cascade` de `users.auth_user_id` remove o registro `users`, e as words criadas são deletadas explicitamente antes). Falha com exit 1 em qualquer vazamento. Núcleo do script (completar com parsing de `--env`, `readEnv`/`required` de `./qa-env.mjs` e `try/finally` para a limpeza):

```js
const adminHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

async function createAuthUser(email, password) {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST", headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  if (!res.ok) throw new Error(`create user failed: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

async function signIn(email, password) {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) throw new Error(`sign in failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

const authedHeaders = (token) => ({ apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

const userA = await createAuthUser(`iso-a-${Date.now()}@qa.local`, "qa-password-123");
const userB = await createAuthUser(`iso-b-${Date.now()}@qa.local`, "qa-password-123");
const tokenA = await signIn(/* email A */, "qa-password-123");
const tokenB = await signIn(/* email B */, "qa-password-123");

// users record de A (criado pelo trigger; o id público vem do PostgREST autenticado)
const meRes = await fetch(`${supabaseUrl}/rest/v1/users?select=id`, { headers: authedHeaders(tokenA) });
const [{ id: userRecordA }] = await meRes.json();

// A insere uma word
const insertRes = await fetch(`${supabaseUrl}/rest/v1/words`, {
  method: "POST", headers: { ...authedHeaders(tokenA), Prefer: "return=representation" },
  body: JSON.stringify({ user_id: userRecordA, canonical_key: `iso-${Date.now()}`, lemma: "isolationtest" })
});
if (!insertRes.ok) throw new Error(`insert as A failed: ${insertRes.status} ${await insertRes.text()}`);
const [{ id: wordId }] = await insertRes.json();

// (a) B não lê a word de A
const readB = await fetch(`${supabaseUrl}/rest/v1/words?id=eq.${wordId}&select=id`, { headers: authedHeaders(tokenB) });
const leaked = await readB.json();
if (leaked.length !== 0) throw new Error("ISOLATION FAIL: usuário B leu word de A");

// (b) B não atualiza a word de A
const writeB = await fetch(`${supabaseUrl}/rest/v1/words?id=eq.${wordId}`, {
  method: "PATCH", headers: { ...authedHeaders(tokenB), Prefer: "return=representation" },
  body: JSON.stringify({ lemma: "hacked" })
});
const written = await writeB.json();
if (Array.isArray(written) && written.length !== 0) throw new Error("ISOLATION FAIL: usuário B alterou word de A");

// limpeza: word de A (como service role), depois os dois auth users
await fetch(`${supabaseUrl}/rest/v1/words?id=eq.${wordId}`, { method: "DELETE", headers: adminHeaders });
await fetch(`${supabaseUrl}/auth/v1/admin/users/${userA}`, { method: "DELETE", headers: adminHeaders });
await fetch(`${supabaseUrl}/auth/v1/admin/users/${userB}`, { method: "DELETE", headers: adminHeaders });

console.log(JSON.stringify({ ok: true }));
```

Nota: o insert de `words` exige as colunas NOT NULL reais da tabela — conferir em `supabase/migrations/0001_initial_schema.sql` e incluir todas no payload (o exemplo acima usa `user_id`, `canonical_key`, `lemma`; ajustar conforme o schema).

Adicionar em `package.json`:

```json
"test:isolation": "node scripts/verify-multitenant-isolation.mjs --env .env.qa.local"
```

e incluir `&& npm run test:isolation` na cadeia do `test:release` após `test:integration`.

- [ ] **Step 4: Rodar tudo**

```bash
node scripts/qa-create-auth-user.mjs
npm run test:isolation
npm run test:e2e
```

Esperado: tudo verde.

- [ ] **Step 5: Commit**

```bash
git add scripts/qa-create-auth-user.mjs scripts/verify-multitenant-isolation.mjs tests/e2e/auth.spec.ts package.json .env.qa.example playwright.config.ts
git commit -m "test: auth e2e flows and multitenant isolation verification"
```

---

### Task 11: Remover o backend Teable

**Files:**
- Delete: `lib/teable/` (client.ts, config.ts, schema.ts, types.ts)
- Modify: `lib/supabase/client.ts` (absorver `getTeableClient`, `safeUpdateRecord`, `TeableRecord`, `TeableConfigError`, `TeableRequestError`)
- Modify: todos os imports `@/lib/teable/client` → `@/lib/supabase/client` (~15 arquivos)
- Modify: `lib/supabase/config.ts` (remover `resolveDataBackend`, `DataBackend`, `DATA_BACKEND`)
- Modify: `.env.example`, `.env.qa.example` (remover bloco Teable e `DATA_BACKEND`)
- Modify: `package.json` (remover scripts Teable-only)
- Delete/Modify: scripts que importam `lib/teable` (listar com grep; utilitários de migração Teable→Supabase saem)
- Modify: `docs/USER_SCOPE_MIGRATION.md` (modelo de identidade novo), tests `data-backend-*.test.ts`
- Modify: `.env.local`, `.env.qa.local` (remover TEABLE_* e DATA_BACKEND — arquivo local, não commitar)

- [ ] **Step 1: Backup final**

Rodar o backup existente antes de remover:

```bash
npm run scope:backup
```

Confirmar que um novo arquivo `backups/*.json` foi criado.

- [ ] **Step 2: Mover a fachada para `lib/supabase/client.ts`**

Mover de `lib/teable/types.ts` e `lib/teable/client.ts` para `lib/supabase/client.ts`: `TeableRecord`, `TeableListResponse`, `TeableCreateResponse`, `TeableConfigError`, `TeableRequestError`, `safeUpdateRecord` e `getTeableClient()` (agora sem branch — sempre Supabase):

```ts
export function getTeableClient(): SupabaseTeableClient {
  return new SupabaseTeableClient(getRequestSupabaseClient());
}
```

O nome `getTeableClient` fica propositalmente para não reescrever 63 call sites; adicionar comentário no topo do arquivo: "getTeableClient é o nome histórico da fachada de dados; o backend é sempre Supabase."

Manter `TeableTableKey`: movê-lo de `lib/teable/schema.ts` para `lib/supabase/tables.ts` (novo, derivado de `tables.json`):

```ts
import tablesJson from "./tables.json";

export type TeableTableKey = (typeof tablesJson.tables)[number]["key"];
```

(Se a inferência não bater com o schema antigo, copiar o union type literal das 17 keys do `lib/teable/schema.ts` original.)

- [ ] **Step 3: Reescrever imports**

```bash
grep -rln '@/lib/teable' lib app tests scripts components
```

Em cada arquivo: `@/lib/teable/client` → `@/lib/supabase/client`; `@/lib/teable/schema` → `@/lib/supabase/tables`. Scripts `.mjs` que usam a API REST do Teable diretamente (migração, ensure-*-fields, backups Teable) são deletados — listar antes de deletar e confirmar que nenhum está no `test:release`.

- [ ] **Step 4: Limpar config e envs**

`lib/supabase/config.ts`: remover `DataBackend`, `resolveDataBackend` e referências a `DATA_BACKEND`; manter `getSupabaseConfig`/`isSupabaseConfigured`/`getSupabaseStatus` (usados por status/healthcheck). Remover `TEABLE_*` e `DATA_BACKEND` de `.env.example` e `.env.qa.example`, e os scripts Teable-only de `package.json`. Ajustar `lib/settings/status.ts` se ele ramificar por backend (grep `resolveDataBackend` — deve zerar).

- [ ] **Step 5: Testes e docs**

- Deletar `tests/unit/data-backend-factory.test.ts` e `tests/unit/data-backend-readiness.test.ts` se só testarem o dual-backend; senão, ajustar para o backend único.
- Atualizar `docs/USER_SCOPE_MIGRATION.md`: identidade agora vem da sessão Supabase (`auth_user_id`), não de `AI_FLUENCY_USER_ID`.
- `npm run lint && npm run typecheck && npm run test:unit && npm run build` — tudo verde.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove Teable backend (Supabase is the only data backend)"
```

---

## Verificação final (release)

- [ ] `npm run test:release` completo verde (lint, typecheck, unit, build, security:bundle, integration, e2e, smoke, qa:verify-empty, isolation).
- [ ] Smoke manual em produção/QA: cadastro novo → onboarding → conversa → palavras → logout → login com a conta vinculada → dados antigos visíveis → segundo usuário não vê dados do primeiro.
- [ ] Dashboard Supabase: "Confirm email" ligado; Redirect URLs incluem `${APP_URL}/auth/callback`.
- [ ] Remover `AI_FLUENCY_USER_ID` do ambiente de produção (Vercel env) após validar a vinculação.
