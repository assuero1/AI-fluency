# Melhorias de áudio — implementação e verificação

Data: 05/09/2026. Implementação local; sem commit, push ou deploy.

## Implementado

- Reprodução padrão em 0,85×, com opções 0,75× e 1×. Preferência compartilhada entre os players e persistida neste navegador, com preservação de altura. Não altera parâmetros de geração nem cria outro arquivo ao mudar a taxa.
- Um player de mensagens por frases, usado também pelo componente de palavras. Começa pela primeira fonte comprimida e prepara a seguinte, sem esperar todas as frases ou montar um WAV no navegador.
- Ausência de timestamps conserva o mesmo áudio e destaca a frase. Tempos utilizáveis habilitam seleção e destaque por palavra; cobertura insuficiente/tempos inválidos degradam apenas a legenda.
- Pausa, retomada e avanço por palavra/frase seguem o relógio do elemento de áudio. Eventos de buffering, pausa externa, erro e watchdog reconciliam o estado da interface. Callbacks antigos são invalidados na troca de mensagem e ao cancelar um carregamento.
- Avanço entre frases acontece pelo evento ended, com pausa de 180 ms. Nenhum fallback abandona as partes após a primeira. O avanço automático do treino aguarda a reprodução corrente e a repetição solicitada pelo aluno.
- O texto da resposta do chat deixa de aguardar o aquecimento TTS. O aquecimento após a resposta tem o ciclo de vida do after() e usa o mesmo recorte de frases do player.
- Solicitações simples e legendadas de Chatterbox compartilham a geração e o cache. Ausência de words é persistida como lista vazia. A chave do cache inclui modelo, prosódia e versão da normalização; normalizações equivalentes compartilham o arquivo.
- Prefetch de treino prepara uma janela de três frases, com downloads comprimidos, limite de concorrência e deduplicação. Mensagens antigas só são preparadas por intenção de interação; não se sintetiza todo o histórico após um timer.
- Medidas locais voice.play-to-sound no Performance do navegador e Server-Timing nas rotas de síntese permitem separar cache hit de geração.

Arquivos principais: components/MessageAudioPlayer.tsx, components/MessageWordPlayer.tsx, components/VoiceButton.tsx, components/AudioSpeedControl.tsx, components/NewWordsTrainer.tsx, components/voice-shared.ts, lib/learning/progressive-audio.ts, lib/learning/audio-policy.ts, lib/learning/audio-prefetch.ts, lib/learning/captions.ts, lib/learning/new-words.ts, lib/kokoro/cache.ts e rotas de mensagens/voz.

## Evidências

- npm run typecheck: aprovado.
- npm run lint: sem erros; sete avisos preexistentes, fora das mudanças implementadas.
- npm run test:unit: 110 arquivos, 763 testes aprovados.
- npm run build: aprovado, 50 páginas geradas.
- npm run security:bundle: nenhum valor de segredo configurado encontrado no bundle cliente.
- Testes de navegador isolados: reprodução das três frases, início sem aguardar a frase seguinte, pausa durante espera, erro com texto acessível, taxa compartilhada, persistência da taxa e seek por palavra sem nova síntese.
- Chromium: quatro testes aprovados. WebKit: quatro testes aprovados. Ambas as rodadas finais executadas após o ajuste do callback de término.
- Inspeção visual em viewport móvel: controles renderizam e o seletor pode quebrar linha em bolhas estreitas.

Os novos testes comportamentais substituem contratos estáticos que exigiam o código antigo (inclusive aguardar TTS e reproduzir somente a primeira URL no fallback). Permanecem as verificações do watchdog e do desbloqueio de áudio.

Para repetir o teste isolado, sem banco ou API paga:

```bash
node node_modules/@playwright/test/cli.js test --config tests/browser/playwright.audio.config.ts --project chromium
node node_modules/@playwright/test/cli.js test --config tests/browser/playwright.audio.config.ts --project webkit
```

O harness usa o Vite já presente entre as dependências de desenvolvimento e arquivos WAV de teste com HTTP Range. O WebKit desta sessão foi instalado em /private/tmp/ai-fluency-audio-browsers; para reutilizá-lo, definir PLAYWRIGHT_BROWSERS_PATH nesse caminho ao executar apenas o projeto webkit.

## Limites da validação

Não foram executadas chamadas pagas de inferência, benchmark de latência de produção, escuta comparativa de amostras Chatterbox ou teste em iPhone físico. Os WAVs do teste verificam o funcionamento do navegador, não naturalidade da voz. Node disponível: 24.12.0; o package.json declara 20.19–22. Verificação nesse intervalo de Node permanece pendente, embora tipos, suíte e build tenham passado no runtime disponível.

A mudança impede os cortes causados pelo descarte de trechos e pelo avanço automático antes do término. Não comprova correção de um fonema que já venha ausente do arquivo original da DeepInfra. Para esse caso ainda é necessário comparar original, cache e reprodução, com uma amostra que reproduza o problema.

Streaming real, alinhamento forçado externo, ajuste de cfg/temperature/exaggeration e metas p95 de produção continuam condicionados ao benchmark indicado no plano. Não foram ativados sem evidência de suporte ou de ganho. A solução implementada usa reprodução progressiva por frases e timestamps nativos quando existem.

A preferência é por navegador, não sincronizada entre contas/aparelhos. O cache é invalidado por nova identidade, então o primeiro uso de arquivos da nova versão pode exigir síntese. A deduplicação em andamento permanece por processo, conforme a arquitetura atual; múltiplas instâncias requerem medição e coordenação compartilhada se aplicável.

Preservadas as alterações que já existiam em scripts/qa-fixture.mjs e tests/e2e/qa-flow.spec.ts. Nenhum dado de produção foi editado.
