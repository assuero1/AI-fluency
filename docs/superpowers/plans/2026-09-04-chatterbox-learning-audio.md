# Plano de melhoria do áudio Chatterbox/DeepInfra

Data: 04/09/2026. Escopo: análise e planejamento; implementação e chamadas pagas não realizadas.

## Resultado pretendido

Fala confortável para aprendizado em todos os pontos do aplicativo, palavras completas, início rápido e texto sincronizado sem bloquear a reprodução. Manter Chatterbox/DeepInfra como provedor. Interpretar “quase automático” como áudio pronto para tocar e preservação do autoplay já existente; não ativar autoplay em novas telas sem uma preferência do usuário.

## Evidências da inspeção

| Local | Comportamento atual | Consequência |
|---|---|---|
| `lib/tts/deepinfra/config.ts` | Velocidade padrão 1; temperature 0,65; exaggeration 0,35; cfgWeight 0,45, sujeitos a ambiente | São defaults do código, não confirmação dos valores em produção |
| `components/VoiceButton.tsx` | playbackRate padrão 1; opção lenta 0,75 no FlashcardTrainer | A política de velocidade não é comum a todos os players |
| `components/MessageWordPlayer.tsx` | Aguarda todos os segmentos captioned; sem alinhamento muda para MessageAudioPlayer | Áudio já gerado pode ser abandonado e texto segmentado de outra forma ser sintetizado novamente |
| `components/MessageAudioPlayer.tsx` | Solicita todas as frases; para várias partes baixa, decodifica e junta em WAV antes de tocar | O primeiro som depende do trecho mais demorado e do processamento local |
| Ambos os players de mensagem | Se a concatenação falha, usa somente a primeira URL | Risco de omitir o restante de uma mensagem, distinto de cortar a última sílaba |
| `lib/learning/seamless-audio.ts` | Insere 180 ms entre partes e 200 ms no fim | Só alcança faixas concatenadas; silêncio não recupera fonema ausente |
| Rota `app/api/conversations/[conversationId]/messages/route.ts` | Aguarda warmCaptionedMessage antes de devolver o texto | A espera de TTS aparece como demora da resposta da IA |
| `app/api/voice/synthesize/route.ts` | Só devolve URL depois da síntese e persistência | Evita a regressão anterior de 404, mas não fornece início progressivo |
| `lib/tts/deepinfra/client.ts` | Envia stream:true; se vier JSON/base64, espera tudo e cria stream de um bloco | Nome de função/ReadableStream não prova streaming real do provedor |
| `lib/kokoro/cache.ts` | Filas inFlight/captionedInFlight separadas; síntese simples não grava words; hash não contém modelo/parâmetros de prosódia | Possíveis sínteses duplicadas e reutilização de áudio de configuração anterior |
| `lib/learning/audio-prefetch.ts` | Burst inicial, depois intervalo 2200 ms; dispara sem aguardar; jumpTo só reordena | Não limita efetivamente simultaneidade e pode atrasar o item recém-priorizado |
| `components/voice-shared.ts` | Cache de promessas por texto/idioma; aquecimento HTTP do aplicativo | URL conhecida não significa bytes prontos; warmup não prova aquecimento da inferência |
| `lib/learning/captions.ts` | Um único token com tempo já torna alinhamento utilizável | Alinhamento parcial pode ser aceito como suficiente |

O projeto já tem cache de arquivos, respostas HTTP Range, prefetch, proteção de reprodução no iOS e testes. Reutilizar essas estruturas. README e planos antigos ainda descrevem Kokoro; não usá-los como retrato da integração atual.

## Etapa 1 — Medir e confirmar o contrato

1. Instrumentar uma solicitação com identificador correlacionável: texto disponível, fila, início/fim do provedor, primeiro byte, arquivo pronto, metadados, canplay, playing e ended. Separar cache local do navegador, cache do servidor e cache frio. Não registrar texto pessoal ou credenciais.
2. Medir duas experiências: envio da mensagem até primeiro som e toque no play até primeiro som. Reduzir o segundo transferindo a espera para o primeiro não conta como melhoria.
3. Montar corpus com palavras isoladas, frases curtas, perguntas, contrações, números, finais consonantais e mensagens de várias frases; cobrir os idiomas usados, inclusive japonês/chinês sem segmentação por espaço.
4. Confirmar endpoint, modelo efetivo, campos aceitos e formatos de resposta. Verificar especialmente speed, cfg/cfg_weight, language/language_id, timestamps e stream. Hoje o cliente envia aliases simultâneos; substituir por contrato explícito após confirmação.
5. Em benchmark real autorizado, comparar áudio original do provedor, arquivo cacheado e reprodução no browser. Guardar duração, tamanho, parâmetros e amostras de falhas. Comparar chegada dos primeiros bytes com término total para comprovar streaming.

Entrega: baseline p50/p95 por cenário e matriz de capacidades do provedor. Não assumir que parâmetros de outro endpoint ou do repositório local do modelo funcionam na API hospedada.

## Etapa 2 — Velocidade confortável em todos os players

1. Criar configuração comum de reprodução: proposta inicial Aprendizado 0,85×, Lento 0,75× e Normal 1×. Validar 0,85× por escuta; não existe um ritmo único ideal para todos os idiomas/alunos.
2. Aplicar nos dois players de mensagem, VoiceButton e áudio direto do NewWordsTrainer. Persistir preferência por perfil quando houver infraestrutura existente adequada; evitar migração de dados desnecessária.
3. Usar inicialmente playbackRate com preservesPitch, mantendo a altura da voz. Definir se cada taxa é absoluta; não multiplicar uma redução na síntese por outra na reprodução inadvertidamente.
4. Alterar taxa sem nova síntese, recarregar src ou perder posição. O destaque continua baseado em currentTime; não dividir os timestamps pela taxa de reprodução.
5. Testar separadamente prosódia: cfg próximo de 0,30 e exaggeration moderada como candidatos, preservando temperatura inicialmente. Comparação A/B por idioma, voz e extensão; não alterar tudo ao mesmo tempo.
6. Pausas devem respeitar pontuação e unidades de sentido. Não usar reticências, instruções faladas ou fragmentação palavra a palavra para desacelerar.

Aceite: mesma preferência em todas as telas; voz sem mudança perceptível de altura; troca de velocidade sem tráfego de síntese; sincronização preservada após pausa e seek.

## Etapa 3 — Preservar o começo e o final

1. Classificar falhas: fonema já ausente no original, arquivo/download incompleto, interrupção do player ou descarte de segmentos. A causa do corte da última palavra ainda não foi reproduzida.
2. Manter normalização/pontuação existente, testando aspas finais, siglas e idiomas sem espaços. Não afirmar que pontuação garante fonema completo.
3. Se original estiver cortado, testar voz/parâmetros/texto normalizado e uma regeneração controlada. Detecção por energia final é apenas indício; corroborar com escuta/alinhamento. Limitar retries e custo.
4. Se original estiver íntegro, verificar duração, bytes, cabeçalhos, Range, fim do decoder, revogação de blob e troca de componente. Finalizar pelo evento ended; impedir autoavanço de desmontar um áudio ainda em reprodução.
5. Padronizar margem final curta, aproximadamente 150–250 ms onde necessária e após a fala completa. Não aplicar fade sobre a última consoante, nem reempacotar todos os arquivos no browser só para inserir silêncio.
6. Substituir fallback de “primeira URL apenas” por fila que reproduza todas as partes em ordem. Preservar primeira e última palavra durante mudanças de fonte.

Aceite: todas as partes reproduzidas uma vez; nenhum corte perceptível no corpus de aceitação; reinício e cache mantêm resultado íntegro. Zero cortes nessa amostra não significa garantia universal do modelo.

## Etapa 4 — Início rápido e menos trabalho duplicado

1. Unificar o registro de síntese por identidade de áudio, servindo consumo simples e captioned com a mesma promessa/arquivo. Registrar explicitamente ausência de timestamps; não ressintetizar para procurar uma capacidade inexistente.
2. Versionar identidade com provedor, modelo/revisão conhecida, voz, idioma, formato, texto normalizado, parâmetros de geração e versão da normalização/pós-processamento. Taxa de reprodução local não cria novo áudio. Preservar isolamento de acesso e não ampliar compartilhamento de conteúdo privado.
3. Devolver texto assim que pronto. Executar pré-geração com ciclo de vida garantido pelo runtime, em vez de depender de promises soltas. Reaproveitar deduplicação entre aquecimento e demanda do cliente.
4. Evitar no caminho crítico a espera por todas as frases e a transformação em WAV. Tocar fonte comprimida diretamente quando possível. Para mensagens longas, usar unidades de sentido, priorizar a primeira e manter as próximas prontas; validar transições em Safari/iOS antes de escolher mecanismo definitivo.
5. Fila única de prioridade: atual, próximo, seguinte; concorrência inicial configurável de 2–3; cancelar pendentes ao sair. Respeitar 30/min da rota e limites reais do provedor, com tratamento de 429/Retry-After. Hits de cache não devem provocar novas inferências.
6. Pré-carregar bytes de poucos áudios próximos no navegador, com limites de memória; hoje parte do prefetch só resolve URLs. Replays devem reutilizar mídia pronta.
7. Separar estados de texto e mídia: preparing, ready, playing, buffering, ended, error. ready requer dados reproduzíveis, não apenas uma URL.
8. Streaming é uma otimização condicional. Só ativar depois de provar suporte no endpoint/modelo/codec/browser. Caso necessário, definir job estável com estados pending/ready/failed e múltiplos leitores; não reativar o pending consumível antigo que gerava 404. Preservar idioma e identidade do provedor no job.
9. Auditar persistência de cache no ambiente real antes de trocar armazenamento. Cache compartilhado durável só se múltiplas instâncias/restarts justificarem. Não contratar serviços como primeira medida.

Aceite: duas solicitações concorrentes equivalentes geram uma síntese; sem timestamps não dispara outra síntese; primeira parte não espera a última; falha de prefetch não impede o texto; sem regressões de 404 ou de autoplay após ditado.

## Etapa 5 — Texto acompanhando sem bloquear o som

1. Um manifesto por áudio reúne segmentos, trechos do texto exibido, durações e status de alinhamento. Manter correspondência entre texto original e texto normalizado da síntese.
2. Capacidades explícitas: alinhamento nativo, externo, por frase ou indisponível. Ausência de timestamps não é falha de áudio.
3. Se houver tempos confiáveis, usá-los; se não houver, tocar o mesmo áudio. Destaque por frase exige limites conhecidos, por segmentos ou alinhamento; sem esses limites, mostrar texto estático até obtê-los.
4. Para precisão palavra a palavra, avaliar alinhamento forçado do arquivo já gerado contra o texto conhecido, em processamento independente. Não bloquear playback e não gerar nova voz. Escolher ferramenta após medir precisão por idioma, custo e latência.
5. Validar tempos finitos, ordenados, dentro da duração e cobertura suficiente dos tokens. Usar granularidade menor quando a confiança falhar. Não vender tempos estimados como exatos.
6. Atualizar a camada de destaque sem trocar src ou reiniciar reprodução. Usar currentTime como relógio e renderizar apenas quando o token ativo mudar. Preservar espaços, pontuação e escrita sem espaços.
7. Cobrir mudança de velocidade, avanço/retrocesso, pausa, replay, buffering e descarte tardio de requisições. Durante pausas reais, não simular avanço de palavras.

Aceite: alinhamento não acrescenta espera ao primeiro som; mudança para fallback não baixa/sintetiza outro áudio; sem deriva após seek/ratechange. Proposta de erro p95 de até 200 ms para palavras em corpus anotado, a calibrar por idioma.

## Metas iniciais e validação

Metas de engenharia, ainda não medições nem garantias:

| Cenário | Meta inicial |
|---|---|
| Áudio já pré-carregado | toque → som p95 ≤ 200 ms |
| Arquivo no servidor, ainda não carregado | toque → som p95 ≤ 700 ms em rede de teste definida |
| Frase curta inédita | buscar primeiro som em ≤ 1,5 s; se o provedor inviabilizar, registrar limite e redução contra baseline |
| Entre frases prontas | pausa intencional de 150–250 ms, sem buffering adicional |
| Alinhamento | nenhuma espera adicional pelo destaque |

Separar o tempo de restauração de rota após microfone (atualmente até 800 ms) das demais métricas; não remover essa proteção sem teste em iPhone real.

Sequência sugerida: baseline → política de velocidade e integridade → deduplicação/cache → playback direto e prefetch → texto independente → streaming/alinhamento externo se os dados justificarem. Entregar em incrementos reversíveis com configuração versionada e rollback. Commit, push e produção exigem confirmação explícita separada.

Verificação futura: testes comportamentais de fila/cache/cancelamento e contrato; integração simulando provedor sem timestamps, resposta lenta, falha intermediária e downloads parciais; E2E com múltiplas frases; escuta de amostras reais; Safari/iPhone, PWA, Chrome/Android e desktop; rede móvel limitada, cache frio/quente e retorno do ditado. Executar typecheck, lint, suíte pertinente e build após implementação.

## Verificado nesta análise

Inspeção do fluxo acima e execução de seis arquivos de teste: deepinfra-chatterbox, tts-provider-selection, audio-prefetch, audio-route-contracts, playback-resilience e qa-instant-audio. Resultado: 67 testes aprovados. Os testes incluem mocks e verificações estáticas; não comprovam naturalidade ou performance real.

Não verificados: configuração efetiva em produção, áudio original com defeito, inferência real, latência real e comportamento em aparelho físico. Não houve alteração de código, commit, push, deploy ou consumo deliberado de API paga. Alterações preexistentes em scripts/qa-fixture.mjs e tests/e2e/qa-flow.spec.ts preservadas.

## Referências consultadas

- [Chatterbox — recomendações oficiais](https://github.com/resemble-ai/chatterbox#original-chatterbox-tips): menor cfg_weight pode melhorar ritmo de uma voz rápida; maior exaggeration tende a acelerar. Isso orienta experimentos, não confirma suporte da API hospedada.
- [Modelo hospedado na DeepInfra](https://deepinfra.com/ResembleAI/chatterbox-multilingual/api).
- [Documentação TTS da DeepInfra](https://docs.deepinfra.com/apis/text-to-speech): parâmetros variam por modelo.
- [Endpoint de streaming da DeepInfra](https://docs.deepinfra.com/api-reference/text-to-speech/text-to-speech-stream): existência do endpoint não comprova suporte efetivo para a combinação usada no aplicativo.
