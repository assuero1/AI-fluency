# Review do app — fluidez do chat, captura de palavras e resiliência

Data: 31 de julho de 2026

## Sumário executivo

Review completo do app com foco em três frentes reportadas: chat lento, palavras não salvas corretamente no fim da conversa e erros visíveis. A auditoria encontrou causas raiz concretas nas três frentes, todas corrigidas nesta rodada dentro do escopo "alto impacto, risco controlado":

- **Chat lento:** a causa dominante não era a IA, e sim a camada de dados — cada mensagem baixava tabelas inteiras do Teable em ~4 ondas sequenciais antes de chamar a IA, e a chamada da IA não tinha timeout (provedor lento = UI travada para sempre).
- **Palavras:** qualquer token com ≥2 letras virava candidato (stopwords como "que", "es", "una" foram persistidas em produção), a análise linguística falhava silenciosamente gerando duplicatas flexionadas, e a extração rodava duas vezes podendo divergir.
- **Erros:** a rota de áudio era a única sem tratamento de erro (500 em HTML no player), erros de rede vazavam mensagens cruas para a UI, e faltavam páginas de erro globais.

Verificação final: ESLint, TypeScript, **137 testes unitários (31 arquivos)** e build de produção — todos verdes.

## Metodologia

Três auditorias paralelas e independentes (fluxo do chat ponta a ponta, pipeline de captura de palavras, tratamento de erros/PWA), seguidas de baseline da suíte (typecheck, lint, 112 testes) e implementação em três frentes de arquivos disjuntos. Achados classificados por severidade (Crítico/Alto/Médio/Baixo).

## Frente 1 — Fluidez e rapidez do chat

### Problemas encontrados

- **Crítico — tabelas inteiras por mensagem:** `getConversation` (`lib/learning/conversations.ts`) baixava as tabelas `messages`, `corrections` e `conversations` por completo (paginação de 1000 em 1000) para filtrar no cliente, em ondas sequenciais dependentes — 7+ round trips antes da IA ser chamada. A latência crescia a cada dia de uso do app.
- **Crítico — IA sem timeout:** as três chamadas `createChatCompletion` do chat (resposta, ação rápida, saudação) não passavam `timeoutMs`; um provedor travado deixava a UI em "A IA está preparando a próxima resposta..." indefinidamente, com todos os botões desabilitados.
- **Alto — dados repetidos por request:** `users` e `languageProfiles` eram baixados até 3-4 vezes no mesmo request.
- **Alto — analytics no caminho crítico:** o evento `conversation_message_sent` era awaited antes da resposta; se a escrita falhasse, o usuário via erro falso depois da resposta já salva.
- **Alto — re-render de 1s:** o cronômetro de sessão re-renderizava a conversa inteira (lista de mensagens + filtros de correções) a cada segundo.
- **Médio — sem timeout no Teable:** qualquer request ao Teable podia travar a página inteira sem limite.
- **Médio — refresh redundante:** trocar de tópico disparava `router.refresh()` re-executando toda a carga pesada da página.

### Correções aplicadas

- `lib/teable/client.ts`: timeout de 10s (`AbortSignal.timeout`) em todas as chamadas, com 1 retry para GETs; erros de rede/timeout encapsulados como `TeableRequestError` 502/504 (sem vazar `TypeError` cru). Novo `listRecordsWhere(tableKey, field, value)` com filtro server-side e **verificação defensiva**: se o Teable ignorar o filtro (bug conhecido [teable#3041](https://github.com/teableio/teable/issues/3041) em self-hosted v1.10.x), cai para listagem completa + filtro local — correto em qualquer versão do servidor. Novo `getRecord` para leitura por id.
- `lib/learning/conversations.ts`: `getConversation` reorganizado em ondas paralelas — mensagens, correções e a conversa começam imediatamente em paralelo com o perfil; removida a segunda leitura de `languageProfiles`. Timeout de 25s nas três chamadas de IA do chat. Eventos de analytics passaram a ser escritos via `after()` do Next (iniciados na hora, nunca bloqueiam nem derrubam a resposta).
- `lib/learning/profile.ts`: `getExistingPersonalUser` e `getActiveLanguageProfile` com React `cache()` — uma leitura por request.
- `lib/learning/tutor-context.ts`: leituras de `words` e `conversations` agora filtradas por `user_id`.
- `components/ChatConversation.tsx`: `AbortController` de 40s no envio (cai no caminho de erro existente, que restaura o rascunho e oferece retry); cronômetro extraído para componente próprio (`ElapsedTimePill`) — a lista de mensagens não re-renderiza mais a cada segundo; correções indexadas por `useMemo`; `router.refresh()` redundante removido; mensagens de erro cobrem "fetch failed"/timeout/abort.

**Ganho esperado:** de ~8 ondas sequenciais + tabelas inteiras para ~2-3 ondas paralelas com leituras filtradas, e fim dos travamentos infinitos (teto de 25s na IA, 10s no Teable, 40s no cliente).

## Frente 2 — Captura e guarda de palavras no fim do chat

### Problemas encontrados

- **Crítico — sem filtro de relevância:** todo token ≥2 letras de todas as mensagens (usuário e tutor) virava candidato. Evidência em `backups/vocabulary-integrity-2026-07-10.json`: "no", "me", "que", "es", "una", "pero", "hoy" persistidas como palavras de estudo.
- **Crítico — fallback silencioso:** uma única chamada de IA para até 80 candidatos com `maxTokens: 900` truncava o JSON; o `catch` caía num lematizador fraco sem nenhum log — "worked" e "working" viravam palavras separadas, sem tradução.
- **Alto — extração em duplicidade:** candidatos (GET) e salvamento (POST) analisavam independentemente; o lemma salvo podia divergir do que o usuário selecionou.
- **Alto — dedup assimétrico:** o filtro de candidatos olhava `forms_json`, mas o lookup na hora de salvar só comparava `canonical_key`/`lemma`; e a normalização não removia diacríticos ("cafe" ≠ "café").
- **Alto — cap por ordem de inserção:** o limite de 80 candidatos era preenchido por stopwords do início da conversa, expulsando vocabulário genuíno do final.
- **Médio — /end sem idempotência:** dois `/end` simultâneos criavam dois `dailyFeedbacks` para o mesmo dia.
- **Médio — contagem derrubava o save:** falha ao atualizar `new_words_count` fazia o POST inteiro falhar depois das palavras já salvas.

### Correções aplicadas

- `lib/learning/vocabulary-selection.ts`:
  - **Stopwords** para en/es/fr/it/pt/de (~90-120 palavras funcionais cada); filtra stopwords do idioma alvo **e português** (mata a contaminação pt) na extração. Predicado exportado e testado.
  - **Normalização estável:** NFKC → minúsculas → remoção de diacríticos (NFD), sem `toLocaleLowerCase()`. Chaves legadas persistidas ("café") casam com as novas ("cafe") porque a comparação re-normaliza os dois lados (`matchesCanonicalVocabularyKey`).
  - **Cache da análise de IA por conversa** (TTL 10 min, chave = conversa + hash dos candidatos): o POST de salvamento reutiliza o resultado do GET de candidatos — mesmo lemma/tradução que o usuário viu, uma chamada de IA a menos.
  - **Batching da análise:** lotes de ≤20 candidatos, `maxTokens` proporcional, falhas de lote/parse agora logadas (`console.warn`) em vez de engolidas.
  - **Ranking antes do cap de 80:** palavras do usuário primeiro, depois por frequência na conversa.
  - **Dedup completo no salvamento:** lookup casa `canonical_key` (normalizado), lemma/display e **formas em `forms_json`** — "eaten" atualiza "eat" em vez de duplicar.
- `lib/learning/feedback.ts`: `endConversation` com lock por conversa + re-cheque de status (segundo `/end` concorrente retorna o resultado persistido, sem duplicar feedback); falha na contagem de palavras novas só loga, não derruba mais o salvamento.
- Trade-off conhecido e aceito: "ate" (inglês) colide com "até" (pt) após normalização e deixa de ser capturável — consequência inerente ao filtro de contaminação pt.

## Frente 3 — Erros visíveis e resiliência

### Problemas encontrados

- **Alto — rota de áudio sem tratamento:** `GET /api/voice/[audioId]` era a única rota sem try/catch; falha do Kokoro virava página HTML de erro 500 dentro do `<audio>`, sem fallback para a voz do dispositivo. O registro de áudio pendente era apagado **antes** da síntese — retry da mesma URL virava 404.
- **Alto — erros crus na UI:** `TypeError: fetch failed` e mensagens internas chegavam verbatim ao cliente; status 401/429 do provedor de IA eram repassados ao browser.
- **Médio — boundaries finas:** sem `global-error.tsx` nem `not-found.tsx`; `app/error.tsx` descartava o erro sem logar.
- **Médio — `play()` engolido:** rejeição de reprodução (autoplay policy, stream corrompido) silenciava sem fallback.
- **Baixo — SW:** `clients.claim()` fora do `waitUntil`; fallback offline podia resolver `undefined`; limpeza de caches apagava caches de outros apps na origem.

### Correções aplicadas

- `lib/api/responses.ts`: classificação de erros upstream — timeout → **504**, rede → **502** com mensagem genérica e log estruturado server-side; erros genéricos não vazam `error.message` nem `detail` em produção (mantido em dev). Contrato JSON inalterado para as 40+ rotas que o usam.
- `app/api/voice/[audioId]/route.ts`: try/catch → JSON 502 com `Cache-Control: no-store` e log.
- `lib/kokoro/cache.ts`: registro pendente só é removido **depois** do stream iniciar com sucesso — a mesma URL continua retentável até a expiração natural.
- `components/VoiceButton.tsx`: falha de `play()` e `onerror` agora caem no fallback de voz do dispositivo (somente quando a reprodução foi iniciada pelo usuário — preload nunca fala sozinho).
- `app/global-error.tsx` e `app/not-found.tsx` criados (pt-BR); `app/error.tsx` agora loga o erro; `app/offline/page.tsx` recarrega de fato (`window.location.reload()`).
- `public/sw.js`: `clients.claim()` dentro do `waitUntil`; fallback de navegação com guarda (`/offline` ausente → retry de rede → 503 inline pt-BR); limpeza restrita a caches `ai-fluency-*`.

## Arquivos alterados

19 arquivos modificados + 4 criados, +635/-131 linhas:

- **Chat/dados:** `lib/teable/client.ts`, `lib/learning/conversations.ts`, `lib/learning/profile.ts`, `lib/learning/tutor-context.ts`, rotas `start`/`messages`/`actions` de conversas.
- **Palavras:** `lib/learning/vocabulary-selection.ts`, `lib/learning/feedback.ts`.
- **Erros/PWA:** `lib/api/responses.ts`, `app/api/voice/[audioId]/route.ts`, `lib/kokoro/cache.ts`, `components/VoiceButton.tsx`, `components/ChatConversation.tsx`, `app/error.tsx`, `app/offline/page.tsx`, `public/sw.js`, + `app/global-error.tsx` e `app/not-found.tsx` (novos).
- **Testes:** +25 testes em 3 novos arquivos (`teable-filtered-listing`, `vocabulary-selection`, `conversation-end`); ajustes pontuais em `pwa-security` e `vocabulary-integrity`.

## Verificação

- ESLint: limpo. TypeScript (`tsc --noEmit`): limpo.
- Testes unitários: **137/137 em 31 arquivos** (baseline anterior: 112).
- Build de produção (`next build`): aprovado.
- Não coberto por esta verificação: testes E2E/integração QA (dependem de ambiente Teable/Kokoro reais) — recomendado rodar `npm run test:release` antes do próximo deploy.

## Recomendações para a próxima rodada (fora do escopo desta)

1. **Streaming da resposta do tutor (SSE):** maior ganho de fluidez percebida restante — hoje o usuário espera a geração JSON completa; com streaming, a resposta aparece progressivamente. Alternativa: resposta rápida em texto puro + correções em segunda passada.
2. **Captura automática de palavras:** hoje nada é salvo se o usuário não abrir `/resumo`. Auto-salvar palavras de alta confiança no `/end`, ou badge/lembrete persistente de "palavras pendentes" até o picker ser resolvido.
3. **Página do chat mais leve:** a saudação inicial do tutor ainda bloqueia o render quando a conversa está vazia, e `getProgressData` baixa 6 tabelas para exibir um número de streak. Renderizar o shell primeiro e gerar a saudação via API.
4. **Lost updates entre instâncias:** `total_uses`/`forms_json` usam leitura-modificação-escrita protegida apenas por lock em memória (não cobre múltiplas instâncias serverless). Recomputar a partir de summaries frescos em retry.
5. **`WordOccurrences`:** tabela abandonada — remover do schema/scripts ou voltar a gravar (sem ela, o detalhe da palavra não mostra onde ela foi usada).
6. **Atualizar o Teable self-hosted:** o bug #3041 (filtro ignorado) corrigido torna o fallback defensivo um no-op e as queries filtradas rendem 100%.
7. **Correções → palavras:** gravar índices dos tokens corrigidos na criação da correção, substituindo o diff LCS fuzzy que pode suprimir palavras válidas.
8. **Menores:** encurtar o timeout upstream do streaming de áudio (45s), `registration.update()` periódico no PWA, retry de resposta vazia da IA herdar o timeout configurado.
