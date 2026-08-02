# Design: Troca de modelo de IA pela UI (override via Teable)

Data: 2026-08-02
Status: aprovado nas 3 seções de design (aguardando revisão do spec)

## Contexto

Hoje a configuração de IA é 100% server-side via env (`AI_PROVIDER`, `AI_BASE_URL`,
`AI_API_KEY`, `AI_CHAT_MODEL` — ver `lib/ai/config.ts`). A página
`app/settings/connections/page.tsx` apenas exibe status e oferece "Testar conexão".
Trocar o modelo exige editar `.env.local` e reiniciar.

Objetivo: permitir trocar **somente o modelo** pela UI, listando os modelos
disponíveis do provedor configurado, com efeito imediato (sem restart).

Decisões tomadas com o usuário:

- Persistência na tabela Teable `AIProviderSettings` (já existe no schema,
  `lib/teable/schema.ts:80-98`, mas nunca é lida/escrita em runtime).
- Escopo: só o modelo. Provider, baseUrl, apiKey, temperature e maxTokens
  continuam exclusivamente em env.
- Listagem de modelos: `GET {baseUrl}/models` no provedor, com fallback para
  lista estática curada quando a consulta falha.

## Arquitetura

### Novo módulo `lib/ai/model-settings.ts`

Único ponto de contato com a tabela `AIProviderSettings`:

- `getActiveModelOverride(): Promise<{ chatModel: string | null; source: "teable" | "env" }>`
  - Lê registros da tabela via `TeableClient.listRecords("aiProviderSettings")`
    e escolhe a linha com `is_active === true` (se houver mais de uma, a mais
    recente por `createdTime`).
  - Cache em memória de 60s (`{ value, expiresAt }` no módulo) para não ir ao
    Teable em toda chamada de IA.
  - Qualquer falha (Teable fora, tabela não mapeada em
    `TEABLE_AI_PROVIDER_SETTINGS_TABLE_ID`, erro de rede) → retorna
    `{ chatModel: null, source: "env" }` silenciosamente.
- `saveModelOverride(chatModel: string): Promise<void>`
  - Se existir linha ativa → `updateRecord` com o novo `chat_model`.
  - Senão → `createRecord` com `{ provider: <provider env>, chat_model, is_active: true }`.
  - Ao final, invalida o cache (`invalidateModelCache()`).
  - Erros do Teable propagam (a rota converte em 503).
- `invalidateModelCache()` — zera o cache (usado por `saveModelOverride` e testes).

### `lib/ai/config.ts` — `getAiConfig()` vira async

```ts
export async function getAiConfig() {
  const override = await getActiveModelOverride();
  return {
    provider: getEnv("AI_PROVIDER") ?? "openai",
    baseUrl: getEnv("AI_BASE_URL"),
    apiKey: getEnv("AI_API_KEY"),
    chatModel: override.chatModel ?? getEnv("AI_CHAT_MODEL"),
    modelSource: override.chatModel ? "teable" : "env",
    temperature: Number(getEnv("AI_TEMPERATURE") ?? 0.4),
    maxTokens: Number(getEnv("AI_MAX_TOKENS") ?? 1200)
  };
}
```

- `getAiStatus()` vira async e passa a incluir `modelSource: "teable" | "env"`.
- `lib/ai/client.ts`: os dois call sites de `getAiConfig()`
  (`createChatCompletion`, ~linha 45, e `testAiConnection`, ~linha 138) passam a
  usar `await`. Como a config já era relida a cada chamada, a troca vale
  imediatamente após o save (cache invalidado).
- `lib/settings/status.ts`: `getConnectionStatus()` vira async (já é usado em
  server components async) e repassa `modelSource`.
- Nenhum consumidor em `lib/learning/*` muda — eles só chamam
  `createChatCompletion()`.

## Endpoints

### `GET /api/settings/ai/models` — `app/api/settings/ai/models/route.ts` (novo)

1. Lê env (`baseUrl`, `apiKey`, `provider`). Sem baseUrl/apiKey → `503`
   `{ error: "Configure a IA no servidor primeiro." }`.
2. `GET {baseUrl}/models` com `Authorization: Bearer`, timeout de 10s
   (`AbortSignal.timeout`), `cache: "no-store"`.
3. Sucesso → `{ models: string[], source: "provider" }` (ids únicos, ordenados).
4. Falha (rede, HTTP não-ok, payload inesperado) →
   `{ models: FALLBACK_MODELS[provider] ?? FALLBACK_MODELS.custom, source: "fallback" }`.

Listas estáticas (curadas, curtas — embutidas na rota):

- `deepseek`: `deepseek-chat`, `deepseek-reasoner`
- `openai`: `gpt-4o`, `gpt-4o-mini`
- `anthropic`: `claude-sonnet-4-5`, `claude-haiku-4-5`
- `google`: `gemini-2.5-pro`, `gemini-2.5-flash`
- `openrouter`: `openai/gpt-4o`, `anthropic/claude-sonnet-4-5`, `deepseek/deepseek-chat`
- `custom` (default): lista vazia

### `PUT /api/settings/ai/model` — `app/api/settings/ai/model/route.ts` (novo)

1. Body `{ chatModel: string }`; ausente/vazio após trim →
   `400 { error: "Informe um modelo válido." }`.
2. Chama `saveModelOverride(chatModel)`; falha do Teable →
   `503 { error: "Não foi possível salvar o modelo. Tente novamente." }`.
3. Sucesso → `200` com o status atualizado (`getAiStatus()`).

## UI — `app/settings/connections/page.tsx`

A página continua server component (`force-dynamic`). O card de IA ganha um novo
client component:

### `components/AiModelSelect.tsx` (novo)

- Props: `currentModel: string | null`, `modelSource: "teable" | "env"`,
  `aiConfigured: boolean`.
- Se `!aiConfigured` → texto "Configure a IA no servidor primeiro." (sem fetch).
- Ao montar: `GET /api/settings/ai/models`; estado de loading no select.
- `<select>` com os modelos retornados; o modelo atual é incluído na lista (e
  pré-selecionado) mesmo que não venha da API.
- Botão "Salvar modelo" → `PUT /api/settings/ai/model`; feedback em pt-BR
  ("Modelo atualizado." / mensagem de erro da API), seguindo o padrão visual do
  `ConnectionTestButton`.
- Se `source === "fallback"` → aviso discreto:
  "Lista estimada — não foi possível consultar o provedor."
- O `ConnectionTestButton` existente permanece: após salvar, "Testar conexão"
  valida o modelo novo (o teste relê a config).

## Tratamento de erro (resumo)

| Cenário | Comportamento |
|---|---|
| Teable fora na leitura | Fallback silencioso para env; `modelSource: "env"` |
| Tabela `AIProviderSettings` não mapeada | Idem (override simplesmente não existe) |
| Teable fora no PUT | 503, mensagem em pt-BR |
| IA não configurada (env) | `GET models` → 503; UI mostra estado "configure primeiro" |
| `GET {baseUrl}/models` falha | Lista estática + `source: "fallback"` + aviso na UI |
| Timeout | 10s em Teable (já existente) e no provedor (novo) |

## Testes (`tests/unit/`)

- `ai-model-settings.test.ts`:
  - cache: hit dentro de 60s, re-leitura após expiração, invalidação no save;
  - fallback para env quando o Teable lança erro;
  - `saveModelOverride`: update em linha ativa existente vs. create quando não há;
- `ai-models-route.test.ts`: sucesso com fetch mockado, fallback estático por
  provider, 503 sem config, payload inesperado → fallback;
- `ai-model-route.test.ts`: 400 body inválido, 503 Teable, 200 sucesso com
  invalidação de cache;
- Ajustar testes existentes que chamam `getAiConfig()`/`getAiStatus()` de forma
  síncrona para a versão async (mocks de `model-settings`).

## Fora de escopo

- Trocar provider/baseUrl/apiKey pela UI (continua em env).
- Modelos diferentes por funcionalidade (chat vs. flashcards etc.).
- `reasoning_model`, `temperature`, `max_tokens` editáveis.
- Override por usuário (`user_id` da tabela fica vazio; override único por
  instalação).

## Riscos / notas

- Em serverless (Vercel), o cache em memória é por instância: instâncias
  diferentes podem levar até 60s para ver uma troca feita por outra instância.
  Aceito para este app (uso individual); a invalidação local cobre o caminho
  normal (salvar pela UI na mesma instância).
- A tabela precisa estar mapeada em `TEABLE_AI_PROVIDER_SETTINGS_TABLE_ID`; sem
  isso o recurso degrada para "somente env" sem quebrar nada.
