# Design — Multiusuário com Supabase Auth

Data: 2026-08-13
Status: aprovado (brainstorming)

## Contexto

O app AI Fluency é hoje single-user: não existe autenticação. O "usuário atual" é um
registro da tabela `users` resolvido no servidor por `getExistingPersonalUser()` /
`getOrCreatePersonalUser()` (`lib/learning/profile.ts:53-96`), via env
`AI_FLUENCY_USER_ID` ou pela heurística "único usuário não-vazio da tabela". O scoping
de dados por usuário é feito **em memória no servidor**: `lib/learning/account.ts:288`
baixa tabelas inteiras e filtra em JS (`matchesUserScope`/`matchesLearningScope` em
`lib/learning/scope.ts`). Não há RLS no Supabase; todo acesso usa service role key.

A migração Teable → Supabase (spec `2026-08-12-teable-to-supabase-migration-design.md`)
foi concluída com paridade total; o Supabase é o backend ativo e o Teable restou como
opção de rollback via `DATA_BACKEND`.

Objetivo: transformar o app em multiusuário real — login, logout e isolamento de dados
por tenant — aproveitando o que já existe.

## Decisões (tomadas no brainstorming)

| Decisão | Escolha |
|---|---|
| Provedor de auth | Supabase Auth |
| Métodos de login | Email + senha (com reset de senha) |
| Isolamento | RLS no Postgres + scoping server-side |
| Execução das queries | Client Supabase autenticado por request (JWT do usuário via cookie) |
| Cadastro | Aberto (qualquer email) |
| Dados do usuário único atual | Vinculados à primeira conta de auth criada |
| Backend Teable | Removido do código |

## 1. Identidade e sessão

- Dependência nova: `@supabase/ssr`. Sessão em cookies, renovada pelo middleware.
- `middleware.ts` passa a: (a) renovar a sessão via `createServerClient` do `@supabase/ssr`;
  (b) redirecionar para `/login` qualquer request sem sessão fora das rotas públicas.
- Rotas públicas: `/login`, `/auth/callback`, `/reset-password`, `/offline`, `sw.js`,
  ícones e assets estáticos. Todo o resto é privado.
- Tabela `users` ganha `auth_user_id uuid unique` referenciando `auth.users(id)`.
- Trigger Postgres `on_auth_user_created` (security definer) cria o registro em `users`
  a cada novo signup em `auth.users`.
- `getExistingPersonalUser()`/`getOrCreatePersonalUser()` são substituídos por
  `getSessionUser()` em `lib/learning/profile.ts`: lê o usuário da sessão, busca o
  registro em `users` por `auth_user_id`, e mantém o cache por request via React `cache`.
  O contrato consumido pelos ~35 módulos de `lib/learning/*` permanece: eles passam a
  receber o usuário da sessão em vez do usuário pessoal.
- `AI_FLUENCY_USER_ID` sai de uso no runtime do app (scripts admin ainda podem usá-lo).

## 2. Telas e fluxos

- `/login`: página com abas **Entrar** e **Criar conta** (email + senha) e link
  "esqueci a senha". Server actions para login/signup/logout; erros exibidos inline.
- `/auth/callback`: route handler que troca o code do email (confirmação de cadastro,
  recovery) por sessão.
- `/reset-password`: formulário de nova senha, acessado via link de recovery.
- Logout: ação real acessível em `/perfil` e/ou `/settings` — encerra a sessão e
  redireciona para `/login`. O ícone `LogOut` em `components/ChatConversation.tsx:509`
  é "abandonar treino" e permanece como está.
- Pós-cadastro: o usuário cai em `/onboarding` — o gate existente (`getLearningGate()`
  em `lib/learning/access.ts:25`) já redireciona corretamente sem alteração.
- API routes sem sessão retornam `401`; páginas sem sessão redirecionam para `/login`.

## 3. Dados multitenant

Migration nova (`supabase/migrations/`):

- `users.auth_user_id uuid unique` (nullable até a vinculação inicial).
- `user_id uuid not null` **denormalizado** nas 7 tabelas-folha, preenchido via join
  com a tabela-pai:
  - `messages`, `corrections` ← via `conversations.user_id`
  - `word_senses`, `word_occurrences`, `word_usage_summaries` ← via `words.user_id`
  - `flashcards`, `flashcard_attempts` ← via `practice_sessions.user_id`
- RLS habilitado em **todas as 17 tabelas**:
  - `users`: `auth_user_id = auth.uid()`
  - tabelas com `user_id` (direto ou denormalizado): `user_id = public.current_user_id()`
    (função `stable security definer` que mapeia `auth.uid()` → `public.users.id` via
    `auth_user_id`; os ids dos dois namespaces são UUIDs diferentes)
  - policies separadas para SELECT/INSERT/UPDATE/DELETE conforme a tabela.
- Vinculação do usuário existente: script one-off seta `auth_user_id` do registro
  atual (o único usuário com dados) para o `auth.users.id` da primeira conta criada.
  Nenhum dado é migrado ou perdido — os `user_id` das tabelas não mudam.

## 4. Servidor — client autenticado por request

- Novo `lib/supabase/server.ts`: fábrica de `createServerClient` por request, lendo o
  cookie da sessão. Sem singleton.
- `getTeableClient()` / `SupabaseTeableClient` (`lib/supabase/client.ts`) deixam de usar
  service role no runtime e passam a receber o client autenticado da request. O Postgres
  aplica RLS em 100% das queries — o isolamento no banco independe de filtros no app.
- O scoping em JS sai: as queries passam a filtrar `user_id` diretamente no PostgREST
  (necessário para as tabelas-folha e para performance; o RLS é a rede de segurança, não
  o mecanismo de filtro principal). O padrão `listAllRecords` + filtro em memória
  (`lib/learning/account.ts:288-333` e similares) é eliminado.
- Service role sobrevive apenas em scripts admin (`scripts/`), nunca no runtime do app:
  backfill, QA, vinculação inicial, testes de isolamento.

## 5. Remoção do backend Teable

- Backup final dos dados antes da remoção (padrão já usado em `backups/`).
- Removidos: `lib/teable/`, `lib/supabase/config.ts` (resolução de backend), envs
  `TEABLE_*` e `DATA_BACKEND` (código, `.env.example`, `.env.qa.example`), scripts de
  migração/rollback Teable, referências em docs ativos.
- Os backups históricos em `backups/` e o spec/plano da migração em `docs/` ficam como
  registro histórico.

## 6. Testes e QA

- Scripts QA (`scripts/qa-*`, `.env.qa.local`) passam a criar usuários de teste via
  Admin API do Supabase (service role) e autenticar como eles.
- Unit tests: `getSessionUser()` (sem sessão, sessão válida, usuário sem vínculo),
  scoping por `user_id` nas queries, policies RLS (via teste de integração).
- E2E (Playwright): fluxo completo cadastro → onboarding → uso → logout → login.
- **Teste de isolamento multitenant** no `test:release`: usuário A não consegue ler
  nem alterar dados do usuário B (via app e via client autenticado direto no PostgREST).

## Tratamento de erros

- Sessão ausente/expirada em página → redirect `/login`; em API → `401`.
- Sessão válida sem registro em `users` (trigger falhou) → erro explícito 500 com log,
  nunca fallback para "único usuário da tabela".
- Falhas de login/signup: mensagens inline genéricas (não revelar se o email existe).

## Fora de escopo

- Login social (Google etc.), magic link, MFA.
- Perfis/compartilhamento entre usuários, roles, organizações.
- Migração de dados para além da vinculação do usuário existente.
