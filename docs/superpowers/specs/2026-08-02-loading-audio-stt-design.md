# Spec: Loading animado, volume de áudio consistente e STT inteligente

Data: 2026-08-02
Status: aprovado pelo usuário (design), aguardando revisão da spec

## Contexto

Três melhorias independentes no app AI Fluency, confirmadas por investigação do código:

1. **Loading estático**: a marca de carregamento das telas de rota usa animação *one-shot* — entra com `bounce-in` e depois fica congelada.
2. **Volume de TTS inconsistente no iPhone**: após usar o microfone (STT), o áudio seguinte sai mais baixo / como se fosse pelo auricular em vez do alto-falante. Agravante: fallback silencioso para a voz do sistema (`speechSynthesis`) quando o Kokoro falha, sem nenhum registro.
3. **STT pontua pausas errado**: pausas na fala viram `,` automática e a palavra seguinte sai capitalizada, porque cada segmento do `SpeechRecognition` é tratado como frase nova.

Decisões tomadas com o usuário:

- Dispositivo do problema de áudio: **iPhone/iPad (iOS)**.
- Abordagem de STT: **correção via LLM** (provider de IA já configurado no app).
- Escopo de loading: **telas de carregamento de rota** (root + Progresso, Palavras, Calendário).

Fora de escopo (YAGNI): troca de engine para Whisper, normalização de loudness no servidor, loadings de botões e do chat.

---

## 1. Loading animado (telas de carregamento)

### Diagnóstico

- `app/globals.css` define `.loading-mark` **duas vezes**: a primeira (linha ~1050) é um ring spinner com `animation: spin 0.9s linear infinite`; a segunda (linha ~2135, comentada "substitui o ring spinner") vence na cascata e usa `animation: bounce-in .6s cubic-bezier(...) both` — animação de entrada que **roda uma única vez** e congela (`both`). É exatamente o "loading fixo" reportado.
- Os skeletons (`app/progresso/loading.tsx`, `app/palavras/loading.tsx`, `app/calendario/loading.tsx`) usam `.skeleton` com `shimmer 1.4s linear infinite` — animam, mas todos os blocos piscam em sincronia, o que parece estático/monótono.

### Mudanças

- **`app/globals.css`**:
  - Remover a definição antiga de `.loading-mark` (ring spinner, linha ~1050) e seu conflito de cascata.
  - Trocar a animação da marca (linha ~2135) para um loop contínuo: manter a entrada `bounce-in` uma vez e encadear um pulso/salto infinito (novo keyframe, ex. `mark-pulse`, com `translateY`/`scale` suave, ~1.2s `ease-in-out infinite`), via duas animações na mesma propriedade (`animation: bounce-in .6s ... both, mark-pulse 1.2s ease-in-out .6s infinite`).
  - Adicionar stagger nos skeletons: `.screen-skeleton .skeleton:nth-child(n)` com `animation-delay` incremental (ex. 0s, .15s, .3s, .45s…) para os primeiros ~6 blocos.
- O bloco `prefers-reduced-motion` existente (linha ~1857) já neutraliza animações — verificar que cobre o novo keyframe.
- Nenhuma mudança em `app/loading.tsx` ou nas `loading.tsx` de rota (markup já está correto).

### Critério de aceite

- A marca da tela de loading nunca fica parada enquanto a tela está visível.
- Skeletons exibem shimmer escalonado (não sincronizado).
- Com `prefers-reduced-motion` ativo, tudo permanece estático (comportamento atual preservado).

---

## 2. Volume de áudio consistente no iOS

### Diagnóstico

- O chat usa `webkitSpeechRecognition` (`components/ChatConversation.tsx:311-416`). No iOS, iniciar o reconhecimento muda a `AVAudioSession` para categoria de gravação; ao parar, a sessão nem sempre é totalmente liberada — a reprodução seguinte sai com volume reduzido / roteada ao auricular. Como o uso típico é intercalar fala (STT) e escuta (TTS), o volume "alterna" entre mensagens.
- Agravante: `components/VoiceButton.tsx:59-68` (`startDeviceFallback`) troca **silenciosamente** para `window.speechSynthesis` (voz do sistema, mais baixa no iOS) em qualquer falha do Kokoro — sem log, sem indicação visual.
- Cada `VoiceButton` cria seu próprio `HTMLAudioElement` (`VoiceButton.tsx:91`); não há elemento compartilhado nem `audio.volume` configurado.

### Mudanças

- **`components/ChatConversation.tsx`**:
  - Ao parar o reconhecimento definitivamente (não em restart), chamar `recognition.abort()` (em vez de só `stop()`) e limpar todos os handlers (`onresult`, `onerror`, `onend` = `null`) antes de liberar a referência — força a liberação da sessão de áudio do iOS.
  - Expor um sinal de "microfone liberado recentemente" (ex. ref `micReleasedAtRef` com timestamp) para que reproduções TTS iniciadas logo em seguida aguardem um pequeno delay.
- **`components/VoiceButton.tsx`**:
  - Antes de `audio.play()`, se o mic foi liberado há menos de ~350ms, aguardar o restante desse intervalo (dá tempo do iOS restaurar a rota do alto-falante). A comunicação entre os componentes será feita por um pequeno módulo compartilhado em `lib/learning/speech.ts` (ex. `markMicReleased()` / `timeSinceMicRelease()`), evitando acoplar `ChatConversation` e `VoiceButton` via props.
  - **Telemetria do fallback**: ao acionar `startDeviceFallback`, registrar via `navigator.sendBeacon` (ou `fetch` keepalive) em endpoint de eventos existente (`/api/events`) um evento `voice_device_fallback` com idioma e tamanho do texto. Hoje o fallback é invisível — sem isso não há como saber se o problema persiste.
  - Manter a arquitetura atual de um `HTMLAudioElement` por `VoiceButton` (a troca por elemento compartilhado não é necessária para esta correção e adiciona risco ao fluxo de preload).
- **Nada** a mudar no servidor Kokoro nem em `speechSynthesis` em si.

### Critério de aceite

- No iPhone, após falar (STT) e tocar o áudio da resposta seguinte, o volume sai pelo alto-falante em nível normal de forma consistente.
- Todo acionamento do fallback de voz do sistema gera evento registrado (verificável no backend).

---

## 3. STT com correção inteligente via LLM

### Diagnóstico

- `lib/learning/speech.ts:34-46` (`joinSpeechSegments`): todo segmento final sem pontuação terminal recebe `,` ao ser concatenado (linha 41). Com `continuous=true` + restarts a cada 250ms (`ChatConversation.tsx:396-405`), cada pausa do usuário vira vírgula.
- O engine do navegador capitaliza a primeira palavra de cada segmento; o app não normaliza case (`normalizeSpeechSpacing` só trata espaços).
- `tests/unit/speech.test.ts:36-40` codifica o comportamento da vírgula como intencional — precisa mudar.

### Mudanças

- **Nova rota `app/api/speech/cleanup/route.ts`** (seguindo o padrão de `app/api/explain-selection/route.ts`): recebe `{ text, language }`, chama uma nova função em `lib/learning/` (ex. `cleanupSpeechTranscript`) que usa o client de IA existente (`lib/ai/client.ts`).
  - Prompt: "Corrija apenas pontuação e capitalização do texto ditado abaixo, no idioma X. **Não adicione, remova ou substitua palavras.** Retorne somente o texto corrigido." Incluir regra explícita: pausas não são vírgulas; remover vírgulas sem função gramatical.
  - Guarda de segurança no servidor: se a resposta do modelo divergir demais do bruto (ex. contagem de palavras difere em mais de 1, ou similaridade baixa), descartar e devolver o texto bruto. Isso impede que o LLM "reescreva" o que o usuário disse.
  - Timeout curto (~3s); em erro/timeout, a rota responde com o texto bruto (o cliente nem percebe a falha).
- **`lib/learning/speech.ts`**: simplificar `joinSpeechSegments` — não inserir mais `,` entre segmentos; apenas juntar com espaço, normalizar espaços e aplicar `punctuateSpeechSentence` no final (heurística local vira apenas o fallback offline/rápido). Opcionalmente rebaixar maiúscula espúria no meio da frase quando o segmento anterior não termina em pontuação.
- **`components/ChatConversation.tsx`** (`recognition.onend`, linhas 370-406):
  - Fluxo atual mantido: o texto bruto (já com o join simplificado) entra no input imediatamente.
  - Em seguida, chamar `/api/speech/cleanup` com o transcript bruto; ao retornar, substituir no input **somente a porção correspondente ao transcript** (respeitando `recognitionStartTextRef`, texto já existente) e somente se o usuário não editou o campo enquanto isso (comparar valor atual com o esperado).
  - Estado visual sutil de "ajustando texto…" (reusar `LoadingDots` ou equivalente discreto no input); nunca bloquear o envio — se o usuário enviar antes do retorno, cancelar/ignorar a resposta.
- **Testes**: atualizar `tests/unit/speech.test.ts` (join sem vírgula automática) e adicionar teste unitário da guarda de divergência do cleanup (resposta do LLM muito diferente → devolve bruto).

### Critério de aceite

- "Eu gosto de… (pausa) …ir à praia" ditado com pausa resulta em texto sem vírgula espúria e sem maiúscula indevida após a pausa.
- Perguntas ditadas terminam com `?`; afirmações com `.`.
- Com a rota de cleanup fora do ar/lenta, o ditado continua funcionando com o texto bruto.

---

## Riscos e observações

- **Ordem sugerida de implementação**: 3 (STT) → 2 (áudio) → 1 (loading). STT e áudio são bugs de UX sentidos toda sessão; loading é polimento. As três frentes são independentes e podem ser feitas em qualquer ordem.
- A correção via LLM adiciona ~300-600ms após o fim da fala; mitigado exibindo o texto bruto imediatamente.
- A telemetria do fallback de voz (frente 2) é o que permitirá confirmar, com dados, se a hipótese da sessão de áudio foi suficiente ou se o Kokoro está falhando em produção.
