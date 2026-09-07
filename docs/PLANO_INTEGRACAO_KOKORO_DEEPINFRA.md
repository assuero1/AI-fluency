# Plano de implementação — Kokoro via DeepInfra

## 1. Objetivo

Adicionar o Kokoro hospedado pela DeepInfra como provedor de síntese de voz do aplicativo, mantendo:

- o Kokoro da VPS atual disponível como alternativa e rollback;
- o Chatterbox da DeepInfra funcionando sem regressões;
- o formato de saída Opus já adotado pelo aplicativo;
- a fluidez, velocidade de reprodução e proteção contra repetição de trechos já alcançadas no fluxo atual.

Este documento é um plano de execução. Ele não implementa a integração.

## 2. Resultado esperado

Ao final, o sistema deverá oferecer três provedores claramente identificados:

| Identificador canônico | Infraestrutura | Modelo |
|---|---|---|
| `deepinfra-kokoro` | DeepInfra | `hexgrad/Kokoro-82M` |
| `kokoro-vps` | VPS atual | Kokoro atual |
| `deepinfra-chatterbox` | DeepInfra | `ResembleAI/chatterbox-multilingual` |

Para evitar quebra de configurações existentes, manter temporariamente estes aliases:

| Identificador legado | Destino |
|---|---|
| `kokoro` | `kokoro-vps` |
| `deepinfra` | `deepinfra-chatterbox` |
| `chatterbox` | `deepinfra-chatterbox` |

O provedor ativo continuará sendo selecionado por configuração de ambiente. A primeira versão não precisa permitir troca de provedor durante a execução do app.

## 3. Estado atual identificado

A implementação atual está distribuída principalmente nestes pontos:

- `lib/tts/types.ts`: contrato e união dos provedores atuais (`kokoro` e `deepinfra`);
- `lib/tts/factory.ts`: seleção do provedor; atualmente `deepinfra`/`chatterbox` levam ao Chatterbox, e o padrão leva ao Kokoro da VPS;
- `lib/tts/deepinfra/config.ts`, `client.ts` e `provider.ts`: integração atual do Chatterbox na DeepInfra;
- `lib/tts/kokoro/provider.ts`: adaptador do Kokoro atual;
- `lib/kokoro/config.ts`, `client.ts`, `voices.ts` e `audio-integrity.ts`: cliente, vozes e tratamento do áudio vindo da VPS;
- `lib/kokoro/cache.ts`: cache compartilhado, mas com condicionais específicas de provedor e dependências do Chatterbox;
- `app/settings/connections/page.tsx`: apresentação e configuração das conexões;
- `app/api/settings/test-tts/route.ts`: teste da conexão TTS;
- `app/api/voice/synthesize/route.ts`, rotas de áudio com legenda, warmup e consulta de voz: consumidores do contrato TTS.

Antes de editar, o executor deve confirmar essa lista com busca no repositório, pois nomes e caminhos podem mudar.

## 4. Decisão arquitetural recomendada

### 4.1. Separar modelo de infraestrutura no identificador

Não reutilizar `deepinfra` como sinônimo de um único modelo. O nome não informa se a chamada usa Chatterbox ou Kokoro e torna configurações, logs, métricas e cache ambíguos.

Usar IDs canônicos específicos: `deepinfra-kokoro`, `deepinfra-chatterbox` e `kokoro-vps`.

### 4.2. Usar capacidades, não condicionais espalhadas

Ampliar o contrato do provedor com metadados/capacidades suficientes para que os consumidores não precisem testar nomes de provedor. Exemplo conceitual:

```ts
interface TTSProviderCapabilities {
  supportsStreaming: boolean;
  supportsWordTimestamps: boolean;
  requiresBufferedNormalization: boolean;
}

interface TTSProviderDescriptor {
  id: TTSProviderType;
  vendor: "deepinfra" | "self-hosted";
  model: string;
  capabilities: TTSProviderCapabilities;
  cacheVersion: string;
}
```

O desenho final pode adaptar os nomes ao estilo do projeto, mas precisa preservar a ideia: tratamento de Opus, streaming, timestamps e cache devem depender da capacidade real do provedor.

### 4.3. Não aplicar automaticamente o reparo da VPS à DeepInfra

A normalização/bufferização criada para impedir repetições no Opus da VPS só deve ser usada em `kokoro-vps`, salvo se os testes de contrato comprovarem o mesmo defeito na DeepInfra. Aplicar a transformação sem evidência aumenta latência e pode introduzir corrupção ou repetição no novo fluxo.

## 5. Fases de implementação

### Fase 0 — Preparação e linha de base

1. Criar branch de trabalho.
2. Registrar o comportamento atual dos três fluxos relevantes:
   - Kokoro da VPS em Opus;
   - Chatterbox da DeepInfra;
   - reprodução no navegador/app.
3. Executar os testes existentes e guardar os resultados como linha de base.
4. Localizar todos os usos de `TTS_PROVIDER`, `kokoro`, `deepinfra`, `chatterbox`, cache TTS e normalização de Opus.

Saída esperada: lista confirmada de arquivos afetados e testes atuais passando antes das mudanças.

### Fase 1 — Spike de contrato com a API real

Antes de consolidar o cliente, executar chamadas controladas com uma chave da DeepInfra em ambiente de QA. O objetivo é confirmar o contrato real e escolher o endpoint mais adequado.

Avaliar os endpoints documentados:

- inferência nativa: `/v1/inference/hexgrad/Kokoro-82M`;
- texto para fala: `/v1/text-to-speech/{voice_id}`;
- streaming: `/v1/text-to-speech/{voice_id}/stream`;
- compatível com OpenAI: `/v1/audio/speech`.

Testar pelo menos:

- textos curto, médio e longo;
- frases com pontuação, números, siglas e acentos;
- vozes candidatas em cada idioma usado no app;
- saída `opus`;
- velocidade atual do app, inicialmente `1.08`;
- resposta binária e, se aplicável, resposta em JSON/base64;
- streaming contínuo;
- MIME type e contêiner efetivamente retornados;
- duração e decodificação do arquivo;
- chamadas consecutivas e paralelas;
- presença ou ausência de timestamps de palavras;
- códigos e corpos de erro para 401, 402, 422, 429 e 5xx;
- latência até o primeiro byte e latência total.

Incluir no conjunto de vozes candidatas, se ainda disponíveis no modelo: `af_heart`, `ef_dora`, `ff_siwis`, `if_sara` e `pf_dora`. Não tornar esses nomes definitivos sem validar a lista atual da API.

Critério para escolher o endpoint:

- preferir o endpoint que entregue Opus válido com menor adaptação;
- exigir streaming se ele for necessário para conservar a experiência atual;
- se timestamps de palavras forem requisito das rotas com legenda, escolher um contrato que os forneça ou documentar a estratégia de alinhamento separada;
- não decidir somente pela semelhança com a API atual.

Saída esperada: pequeno relatório de contrato, payloads sanitizados, amostras de resposta e decisão registrada sobre o endpoint.

### Fase 2 — Identidade e fábrica de provedores

1. Alterar `TTSProviderType` para aceitar os três IDs canônicos.
2. Criar uma função única de normalização dos aliases legados.
3. Atualizar a fábrica para instanciar explicitamente:
   - Kokoro da DeepInfra;
   - Kokoro da VPS;
   - Chatterbox da DeepInfra.
4. Remover fallbacks silenciosos para um provedor não relacionado. Configuração inválida deve falhar com mensagem clara.
5. Adicionar descritor e capacidades ao contrato ou a um registro central de provedores.

Critério de aceite: cada ID e alias seleciona exatamente o provedor esperado, coberto por testes unitários.

### Fase 3 — Cliente e provedor DeepInfra Kokoro

Criar um módulo dedicado, sugerido em:

```text
lib/tts/deepinfra-kokoro/config.ts
lib/tts/deepinfra-kokoro/client.ts
lib/tts/deepinfra-kokoro/provider.ts
```

Responsabilidades:

- `config.ts`: carregar e validar variáveis de ambiente, formato, modelo, timeout, velocidade e vozes;
- `client.ts`: autenticação Bearer, construção do payload, requisição, streaming, interpretação de resposta e erros;
- `provider.ts`: adaptar o cliente ao contrato comum de síntese, legenda, warmup e listagem/validação de vozes.

Requisitos técnicos:

- nunca registrar a chave da API;
- impor timeout e cancelamento via `AbortSignal`;
- validar `content-type` e não assumir que toda resposta de sucesso é áudio;
- preservar bytes binários sem conversões desnecessárias;
- aceitar Opus como formato padrão;
- retornar erros categorizados e úteis para a interface e observabilidade;
- respeitar `Retry-After` quando presente;
- limitar retries a falhas transitórias e chamadas idempotentes;
- não repetir automaticamente requisições após áudio parcial de streaming;
- propagar modelo, voz, formato e provedor como metadados, sem dados sensíveis.

### Fase 4 — Cache e integridade de áudio

1. Tornar a chave de cache independente do nome histórico do provedor.
2. Incluir no fingerprint, no mínimo:
   - ID canônico do provedor;
   - modelo e versão de contrato/cache;
   - texto normalizado;
   - idioma e voz;
   - formato;
   - velocidade;
   - parâmetros adicionais que alterem o áudio.
3. Impedir colisão entre Kokoro VPS e Kokoro DeepInfra.
4. Substituir condicionais específicas do Chatterbox/Kokoro por capacidades do provedor.
5. Aplicar o reparo de integridade Opus somente quando `requiresBufferedNormalization` for verdadeiro.
6. Considerar mover `lib/kokoro/cache.ts` para `lib/tts/cache.ts`; se o impacto for grande, manter um re-export temporário para compatibilidade.

Critério de aceite: trocar o provedor nunca reutiliza áudio gerado por outro provedor e o novo fluxo não sofre transformação específica da VPS sem necessidade comprovada.

### Fase 5 — Configuração de ambiente

Adicionar variáveis com nomes não ambíguos. Sugestão inicial:

```dotenv
TTS_PROVIDER=deepinfra-kokoro

DEEPINFRA_API_KEY=
DEEPINFRA_KOKORO_MODEL=hexgrad/Kokoro-82M
DEEPINFRA_KOKORO_OUTPUT_FORMAT=opus
DEEPINFRA_KOKORO_SPEED=1.08
DEEPINFRA_KOKORO_TIMEOUT_MS=35000
DEEPINFRA_KOKORO_SERVICE_TIER=default

DEEPINFRA_KOKORO_VOICE_EN=af_heart
DEEPINFRA_KOKORO_VOICE_ES=ef_dora
DEEPINFRA_KOKORO_VOICE_FR=ff_siwis
DEEPINFRA_KOKORO_VOICE_IT=if_sara
DEEPINFRA_KOKORO_VOICE_PT=pf_dora
```

Os valores de voz, velocidade e `service_tier` são provisórios até a conclusão do spike.

Também:

- atualizar `.env.example` e documentação de deploy;
- manter as variáveis da VPS enquanto ela for opção suportada;
- compartilhar `DEEPINFRA_API_KEY` entre os modelos somente se essa for a convenção vigente;
- não expor a chave em variáveis públicas, respostas HTTP ou logs;
- validar a configuração no startup, mas inicializar somente o provedor selecionado quando possível.

### Fase 6 — Configurações, status e diagnóstico

Atualizar a tela e a rota de teste para mostrar nomes inequívocos:

- “Kokoro — DeepInfra”;
- “Kokoro — VPS própria”;
- “Chatterbox — DeepInfra”.

A resposta de diagnóstico deve informar, quando seguro:

- ID canônico do provedor;
- modelo;
- voz e idioma;
- formato;
- latência;
- sucesso ou categoria de erro.

Não retornar token, cabeçalhos de autorização nem URLs privadas da VPS.

### Fase 7 — Testes automatizados

Adicionar ou atualizar testes para:

1. seleção dos três provedores e aliases legados;
2. rejeição de provedor desconhecido;
3. payload da DeepInfra Kokoro por idioma, voz, formato e velocidade;
4. autenticação e cabeçalhos sem vazamento de token nos snapshots;
5. respostas binárias e JSON/base64, se ambas forem suportadas;
6. streaming e cancelamento;
7. timestamps ou comportamento documentado quando indisponíveis;
8. timeout e erros 401, 402, 422, 429 e 5xx;
9. isolamento das chaves de cache;
10. ausência da normalização da VPS no DeepInfra Kokoro;
11. rotas de síntese, áudio com legenda, warmup e voz;
12. reprodução de Opus nos navegadores suportados;
13. regressão de áudio: ausência de repetição/travamento em amostras longas e chamadas sequenciais.

Usar mocks para a suíte determinística e executar uma suíte de contrato separada contra a API real, controlada por variável de ambiente.

### Fase 8 — Rollout e observabilidade

Sequência recomendada:

1. disponibilizar o código com a VPS ainda selecionada em produção;
2. configurar credenciais e executar smoke test em QA;
3. comparar qualidade, duração, latência e taxa de erro com a VPS;
4. validar manualmente amostras curtas e longas em Opus;
5. promover o código sem alterar imediatamente o provedor ativo;
6. mudar apenas `TTS_PROVIDER` para `deepinfra-kokoro`;
7. executar smoke test autenticado após o deploy;
8. observar por 24–48 horas:
   - taxa de sucesso e erros por categoria;
   - latência até primeiro byte e total;
   - ocorrências de timeout e rate limit;
   - duração do áudio versus tamanho do texto;
   - relatos ou detecção de repetição;
   - custo por caractere e volume.

Evitar fallback automático na primeira versão. Ele pode duplicar custos, esconder indisponibilidade e produzir vozes diferentes dentro do mesmo diálogo. Se for necessário no futuro, deverá ter orçamento de tempo, política de erro, deduplicação e telemetria próprios.

## 6. Rollback

O rollback deve ser somente de configuração sempre que possível:

```dotenv
TTS_PROVIDER=kokoro-vps
```

Depois da alteração:

1. redeploy/restart conforme o ambiente;
2. executar o teste de conexão TTS;
3. sintetizar e reproduzir uma amostra em Opus;
4. confirmar que o cache está isolado por provedor;
5. manter logs da falha da DeepInfra para análise posterior.

Não remover a implementação nem as credenciais da VPS até o novo provedor completar o período de estabilização.

## 7. Comandos de verificação

O executor deve adaptar os comandos aos scripts existentes no `package.json`. Conjunto esperado:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
npx playwright test --config tests/browser/playwright.audio.config.ts
```

Executar também a suíte de contrato real da DeepInfra em QA, com a chave carregada por mecanismo seguro. Essa suíte não deve rodar por padrão em CI nem imprimir credenciais.

## 8. Critérios de aceite

- [ ] Os três provedores possuem IDs canônicos e nomes claros.
- [ ] Configurações legadas continuam funcionando por aliases documentados.
- [ ] `deepinfra-kokoro` usa `hexgrad/Kokoro-82M` e retorna Opus reproduzível.
- [ ] A voz correta é escolhida para cada idioma suportado.
- [ ] Síntese comum, streaming, legenda, warmup e consulta de voz mantêm seus contratos públicos.
- [ ] O cache não colide entre provedores, modelos, formatos, vozes ou velocidades.
- [ ] O reparo específico do Opus da VPS não é aplicado ao novo provedor sem evidência.
- [ ] Não há repetição perceptível de palavras em amostras curtas, longas ou sequenciais.
- [ ] Chatterbox da DeepInfra e Kokoro da VPS continuam funcionando.
- [ ] Erros de autenticação, saldo, validação, rate limit, timeout e servidor são tratados de modo previsível.
- [ ] Logs e respostas não expõem credenciais nem URL privada da VPS.
- [ ] Testes unitários, integração, build e reprodução no navegador passam.
- [ ] O rollback para `kokoro-vps` foi ensaiado em QA.
- [ ] O smoke test de produção foi concluído após a troca de configuração.

## 9. Fora do escopo da primeira entrega

- seleção de provedor pelo usuário em tempo de execução;
- fallback automático entre DeepInfra e VPS;
- remoção da VPS;
- migração retroativa de áudios já armazenados;
- troca automática de voz para imitar exatamente o timbre atual;
- otimizações de custo que prejudiquem qualidade ou latência antes de obter métricas reais.

## 10. Sequência sugerida de commits

1. `refactor(tts): add canonical provider identities and capabilities`
2. `feat(tts): add DeepInfra Kokoro provider`
3. `refactor(tts): isolate cache and audio integrity by provider`
4. `test(tts): cover DeepInfra Kokoro contracts and regressions`
5. `docs(tts): document configuration rollout and rollback`

A mudança da variável de produção deve ficar fora dos commits de código e acontecer somente no passo de rollout aprovado.

## 11. Definition of Done

A implementação estará concluída quando:

- código, configuração e documentação estiverem revisados;
- todas as verificações automatizadas aplicáveis passarem;
- o contrato real da DeepInfra estiver validado com evidências em QA;
- Opus tocar corretamente sem repetição e sem regressão de fluidez;
- VPS e Chatterbox permanecerem operacionais;
- métricas e logs permitirem identificar provedor, modelo e erro;
- rollback por configuração estiver testado;
- o smoke test após deploy estiver registrado.

## 12. Referências oficiais

- DeepInfra — Kokoro 82M: <https://deepinfra.com/hexgrad/Kokoro-82M/api>
- DeepInfra — Text-to-Speech: <https://docs.deepinfra.com/api-reference/text-to-speech/text-to-speech>
- DeepInfra — Text-to-Speech Streaming: <https://docs.deepinfra.com/api-reference/text-to-speech/text-to-speech-stream>
- DeepInfra — OpenAI-compatible Audio Speech: <https://docs.deepinfra.com/api-reference/audio/openai-audio-speech>

> Observação: preços, vozes, endpoints e parâmetros podem mudar. O executor deve reconfirmá-los na documentação oficial antes da implementação e registrar a data da validação.
