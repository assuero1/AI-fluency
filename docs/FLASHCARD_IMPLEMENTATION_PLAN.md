# Plano completo e robusto — Treino inteligente de vocabulário

## Objetivo final

Construir um sistema de revisão que:

- force recuperação ativa antes de mostrar a resposta;
- trabalhe compreensão, produção, contexto e escuta;
- adapte a próxima revisão ao desempenho;
- registre cada tentativa;
- identifique palavras difíceis;
- permita retomar sessões interrompidas;
- apresente resultados confiáveis;
- integre flashcards ao calendário e progresso;
- continue funcionando quando IA, áudio ou STT falharem.

## Princípios de arquitetura

1. O servidor será a fonte oficial da sessão, cards, respostas e pontuação.
2. O cliente cuidará da interação, mas não decidirá sozinho os resultados persistidos.
3. Cada card terá apenas uma palavra-alvo principal.
4. Toda operação de resposta e conclusão será idempotente.
5. IA será usada para criação e análise linguística, não para operações determinísticas.
6. Uma falha da IA não poderá impedir o treino.
7. Dados antigos continuarão funcionando durante a migração.
8. Métricas serão derivadas de tentativas persistidas, não de contadores do navegador.

---

# PR 0 — Consolidar a implementação atual

## Objetivo

Criar uma base estável antes de mudar o domínio do treino.

## Trabalho

- Consolidar as alterações atualmente não commitadas.
- Separar mudanças anteriores de chat, vocabulário, calendário e flashcards.
- Registrar o comportamento atual com testes de caracterização.
- Documentar o fluxo atual:
  - seleção de palavras;
  - criação da sessão;
  - geração de frases;
  - avaliação binária;
  - atualização de familiaridade;
  - resultado.
- Revisar erros e respostas das APIs atuais.
- Centralizar tipos compartilhados entre cliente e servidor.

## Testes-base

- criação de baralho;
- seleção por menos usadas;
- seleção por uso mais antigo;
- proporção palavra/frase;
- atualização de familiaridade;
- proteção contra conclusão duplicada;
- build e renderização móvel.

## Critério de conclusão

A implementação atual deve estar em uma branch limpa, testada e reproduzível antes do PR 1.

---

# PR 1 — Domínio de recuperação ativa

## Objetivo

Transformar o card de reconhecimento em um exercício no qual o usuário precisa tentar lembrar.

## Modelo de card

```ts
type FlashcardType =
  | "target_to_native"
  | "native_to_target"
  | "cloze"
  | "listening";

type Flashcard = {
  id: string;
  sessionId: string;
  type: FlashcardType;
  targetWordId: string;
  supportingWordIds: string[];
  prompt: string;
  expectedAnswer: string;
  acceptedAnswers: string[];
  translation: string;
  explanation?: string;
  sentence?: string;
  audioText?: string;
  difficulty: number;
};
```

## Distribuição inicial

- 25% idioma-alvo → português;
- 40% português → idioma-alvo;
- 35% frase com lacuna;
- exercícios auditivos ficam desativados até o PR 5.

A distribuição será ajustada quando houver poucos cards:

- 2 palavras: uma compreensão e uma produção;
- 3 palavras: uma de cada modalidade;
- sem tradução: não criar card português → idioma-alvo;
- sem frase válida: usar card de palavra.

## Tentativa obrigatória

Antes de revelar:

- campo digitável;
- botão de microfone;
- ação “Não lembro”;
- indicação do idioma esperado;
- botão de resposta desabilitado enquanto estiver vazio;
- Enter envia;
- Shift+Enter não será necessário para respostas curtas.

Após enviar:

- resposta fica bloqueada;
- comparação é executada;
- verso é revelado;
- usuário vê resposta esperada e sua tentativa;
- avaliação sugerida aparece.

## Normalização determinística

Criar uma função pura para:

- Unicode NFC;
- minúsculas;
- espaços duplicados;
- pontuação periférica;
- apóstrofos equivalentes;
- sinais invertidos;
- diferenças opcionais de capitalização.

Acentos não devem ser simplesmente removidos em produção de espanhol. Exemplo:

- `si` e `sí` podem significar coisas diferentes;
- resposta sem acento pode ser classificada como quase correta;
- não deve receber equivalência automática completa.

## Resultado da comparação

```ts
type AnswerMatch =
  | "exact"
  | "acceptable"
  | "minor_error"
  | "incorrect"
  | "unknown";
```

- `exact`: resposta normalizada exata;
- `acceptable`: alternativa cadastrada;
- `minor_error`: acento, artigo ou pontuação;
- `incorrect`: não corresponde;
- `unknown`: requer análise adicional ou falhou.

IA só será chamada para `unknown`, frases abertas ou variações linguísticas relevantes.

## STT

- usar reconhecimento do celular;
- idioma configurado pelo perfil;
- mostrar transcrição antes de enviar;
- permitir edição;
- nunca enviar automaticamente;
- erros do STT não devem ser tratados como erro pedagógico sem confirmação.

## Critérios de aceite

- o verso não é exibido antes de uma tentativa;
- “Não lembro” funciona sem digitação;
- resposta digitada e falada usam o mesmo fluxo;
- resposta não pode ser enviada duas vezes;
- falha na análise da IA ainda permite autoavaliação;
- funcionamento completo por teclado;
- foco retorna ao campo no card seguinte.

---

# PR 2 — Cards contextuais e fila pedagógica

## Objetivo

Adicionar quatro níveis de avaliação, frases confiáveis e repetição de erros dentro da sessão.

## Avaliações

```ts
type RecallRating =
  | "forgot"
  | "hard"
  | "good"
  | "easy";
```

Interface em português:

- Não lembrei
- Difícil
- Lembrei
- Fácil

## Sugestão automática

| Comparação | Sugestão |
| --- | --- |
| Sem tentativa | Não lembrei |
| Incorreta | Não lembrei |
| Erro pequeno | Difícil |
| Correta e lenta | Lembrei |
| Correta e rápida | Fácil ou Lembrei |

O usuário sempre poderá alterar a sugestão.

## Fila de reapresentação

Cada item da fila deve conter:

```ts
type QueueItem = {
  cardId: string;
  presentationNumber: number;
  dueAfterIndex: number;
};
```

Regras:

- Não lembrei: reaparece após três outros cards.
- Difícil: reaparece após cinco.
- Lembrei: não reaparece na sessão.
- Fácil: não reaparece.
- Máximo de três apresentações por card.
- Cards reapresentados não aumentam o total original do baralho.
- A barra deverá distinguir cards únicos de apresentações totais.

## Frases com lacuna

Exemplo:

> Ayer ___ al mercado.

Requisitos:

- máximo de cinco palavras, excluindo pontuação;
- uma palavra-alvo;
- somente uma lacuna;
- frase natural;
- adequada ao nível;
- resposta não ambígua;
- tradução em português;
- no máximo uma palavra lexical nova;
- artigos, preposições, pronomes e auxiliares adicionais permitidos.

## Validação das frases

A resposta da IA será validada antes de entrar no baralho:

- JSON válido;
- IDs existentes;
- palavra-alvo presente;
- limite de palavras;
- lacuna correspondente à palavra;
- tradução não vazia;
- ausência de texto técnico;
- idioma correto;
- ausência de duplicatas.

Frases inválidas serão descartadas individualmente.

## Fallback

Se a geração falhar:

- criar cards simples;
- não atrasar toda a sessão;
- mostrar uma indicação discreta de que o treino foi adaptado;
- registrar evento técnico.

## Pré-geração

- montar o baralho antes da primeira tela;
- limitar tempo da IA;
- uma chamada em lote;
- evitar chamada por card;
- armazenar o resultado para retomada futura.

## Critérios de aceite

- aproximadamente metade dos cards trabalha contexto;
- toda frase possui uma única palavra-alvo;
- cards errados retornam na posição correta;
- fila nunca entra em ciclo;
- resultado separa cards únicos de reapresentações;
- geração parcialmente inválida não invalida o baralho inteiro.

---

# PR 3 — Persistência robusta no Teable

## Objetivo

Persistir sessões, cards e tentativas de forma auditável e retomável.

## Estratégia recomendada

Usar três entidades:

1. `PracticeSessions` — sessão geral.
2. `Flashcards` — cards congelados daquela sessão.
3. `FlashcardAttempts` — cada apresentação e resposta.

A palavra continua em `Words`.

## Evolução de `PracticeSessions`

Adicionar:

- `status`: preparing, active, completed, abandoned, failed;
- `started_at`;
- `ended_at`;
- `duration_seconds`;
- `criterion`;
- `requested_word_count`;
- `selected_word_count`;
- `unique_card_count`;
- `presentation_count`;
- `correct_count`;
- `incorrect_count`;
- `score`;
- `language_code`;
- `configuration_json`;
- `parent_session_id`;
- `created_at`;
- `updated_at`.

## Nova tabela `Flashcards`

Campos:

- `practice_session_id`;
- `target_word_id`;
- `supporting_word_ids`;
- `card_type`;
- `prompt`;
- `expected_answer`;
- `accepted_answers`;
- `translation`;
- `explanation`;
- `sentence`;
- `audio_text`;
- `difficulty`;
- `initial_position`;
- `generation_source`: ai, deterministic, fallback;
- `created_at`.

## Nova tabela `FlashcardAttempts`

Campos:

- `practice_session_id`;
- `flashcard_id`;
- `word_id`;
- `presentation_number`;
- `client_attempt_id`;
- `user_answer`;
- `normalized_answer`;
- `match_result`;
- `suggested_rating`;
- `final_rating`;
- `was_correct`;
- `response_time_ms`;
- `used_speech`;
- `audio_replay_count`;
- `created_at`.

## Novas variáveis

- `TEABLE_FLASHCARDS_TABLE_ID`
- `TEABLE_FLASHCARD_ATTEMPTS_TABLE_ID`

## Idempotência

Cada tentativa receberá `client_attempt_id`.

O servidor deverá:

1. procurar tentativa existente com o mesmo ID;
2. retornar o resultado existente se encontrada;
3. criar apenas se ainda não existir;
4. atualizar palavra somente uma vez.

Conclusão da sessão:

- se já estiver concluída, retornar o resultado persistido;
- nunca aplicar novamente familiaridade ou agendamento.

## Retomada

Ao abrir `/palavras/treino`:

- procurar sessão `active`;
- oferecer “Continuar treino”;
- restaurar fila e índice a partir dos cards e tentativas;
- recalcular reapresentações determinísticamente;
- não depender de `localStorage`.

`localStorage` pode guardar apenas estado visual temporário.

## Migração

1. Criar tabelas e campos sem alterar o código em produção.
2. Validar IDs e permissões.
3. Adicionar variáveis no EasyPanel.
4. Fazer deploy com leitura tolerante a campos vazios.
5. Habilitar persistência nova.
6. Manter compatibilidade com sessões antigas.
7. Remover lógica antiga somente após validação.

---

# PR 4 — Repetição espaçada adaptativa

## Objetivo

Calcular a próxima revisão usando histórico, dificuldade e estabilidade da memória.

## Campos adicionais em `Words`

- `review_interval_days`;
- `review_ease`;
- `review_streak`;
- `lapse_count`;
- `last_reviewed_at`;
- `last_rating`;
- `average_response_time_ms`;
- `review_state`: new, learning, review, difficult, suspended;
- `review_version`.

## Algoritmo inicial

Usar um algoritmo próprio, versionado e testável, inspirado em repetição espaçada, sem tentar implementar FSRS incompleto.

### Não lembrei

- `review_streak = 0`;
- `lapse_count += 1`;
- `review_interval_days = 1`;
- reduzir facilidade;
- `review_due_at = amanhã`.

### Difícil

- manter ou reduzir sequência;
- multiplicar intervalo aproximadamente por 1,2;
- limitar inicialmente entre 1 e 4 dias;
- reduzir levemente facilidade.

### Lembrei

- `review_streak += 1`;
- multiplicar pelo fator de facilidade;
- intervalos iniciais: 3, 7, 15 e 30 dias;
- considerar resposta lenta.

### Fácil

- `review_streak += 1`;
- bônus de intervalo;
- intervalos iniciais: 7, 15, 30 e 60 dias;
- aumentar facilidade dentro de limites.

## Tempo de resposta

O tempo influenciará moderadamente:

- resposta rápida: pequeno bônus;
- resposta normal: neutro;
- resposta lenta: pequeno redutor;
- nunca transformar resposta correta em erro.

Usar limites por tipo de card, pois uma frase exige mais tempo que uma palavra.

## Múltiplos cards da mesma palavra

- cada tentativa é registrada;
- a atualização definitiva da palavra ocorre ao final da sessão;
- agregar todas as tentativas da palavra;
- priorizar o pior resultado quando houver inconsistência;
- impedir que um card fácil apague um erro grave ocorrido na mesma sessão.

Exemplo:

- palavra correta em compreensão;
- incorreta em produção;
- resultado agregado não poderá ser “Fácil”.

## Palavras difíceis

Classificar como `difficult` quando houver:

- duas falhas consecutivas;
- três falhas em cinco revisões;
- retorno frequente ao estado inicial;
- resposta lenta recorrente;
- domínio baixo após várias tentativas.

Palavras difíceis receberão variedade de exercícios, não apenas maior repetição.

## Versionamento

Todo cálculo deve registrar `review_version`.

Isso permitirá alterar o algoritmo sem tornar o histórico antigo incompreensível.

## Testes

- primeira revisão;
- sequências de sucesso;
- erro após domínio;
- múltiplos cards da mesma palavra;
- limites mínimos e máximos;
- datas e timezone;
- execução duplicada;
- mudança de versão;
- dados incompletos ou antigos.

---

# PR 5 — Áudio e experiência avançada

## Objetivo

Trabalhar compreensão auditiva, oferecer retomada e melhorar fluidez.

## Cards auditivos

Distribuição inicial opcional: 15%.

Fluxo:

1. Mostrar apenas botão de áudio.
2. Tocar sob ação do usuário.
3. Usuário digita ou fala significado/resposta.
4. Revelar texto.
5. Mostrar tradução.
6. Permitir repetir em velocidade normal ou reduzida.

## Dados registrados

- quantidade de reproduções;
- uso de velocidade reduzida;
- tempo até a resposta;
- resposta antes ou depois de repetir;
- falha do áudio.

## Regras

- áudio nunca inicia automaticamente sem preferência;
- Kokoro usa a voz correta do idioma;
- falha no Kokoro oferece voz do dispositivo;
- falha total converte o card para modo textual;
- falha técnica não reduz domínio da palavra.

## Retomada

- modal ao detectar sessão ativa;
- Continuar;
- Reiniciar;
- Abandonar;
- confirmação antes de sair;
- sessão abandonada não altera domínio das palavras ainda não concluídas.

## Retreinos

No resultado:

- somente as erradas;
- somente as difíceis;
- somente produção;
- somente escuta;
- usar palavras em conversa.

O retreino cria outra sessão ligada por `parent_session_id`.

---

# PR 6 — Resultado, calendário e progresso

## Resultado da sessão

Mostrar:

- nota geral;
- cards únicos;
- apresentações totais;
- acertos na primeira tentativa;
- acertos após reapresentação;
- compreensão;
- produção;
- contexto;
- escuta;
- tempo médio;
- duração;
- palavras consolidadas;
- palavras difíceis;
- palavras lentas;
- próximas revisões.

## Pontuação

Separar:

- `first_attempt_accuracy`;
- `eventual_recall_accuracy`;
- `production_accuracy`;
- `comprehension_accuracy`;
- `listening_accuracy`.

A nota geral não deve ocultar diferenças entre competências.

## Calendário

Registrar flashcards junto das conversas:

- minutos treinados;
- palavras revisadas;
- acertos;
- revisões vencidas concluídas;
- modalidades praticadas.

Panorama:

- diário;
- últimos sete dias;
- mensal.

## Página de palavras

Adicionar:

- Revisões para hoje;
- Novas;
- Em aprendizagem;
- Consolidadas;
- Difíceis;
- próxima revisão;
- histórico resumido;
- evolução de domínio.

## Progresso

Indicadores:

- taxa de recuperação na primeira tentativa;
- retenção após 7 e 30 dias;
- palavras consolidadas;
- palavras recuperadas após esquecimento;
- tempo total de revisão;
- sequência de dias com revisão.

Evitar métricas de vaidade, como apenas quantidade total de cards vistos.

---

# PR 7 — Observabilidade, segurança e rollout

## Eventos

Registrar:

- geração iniciada, concluída ou com falha;
- sessão iniciada, retomada, abandonada ou concluída;
- tentativa avaliada;
- análise da IA utilizada;
- fallback ativado;
- falha de STT;
- falha de áudio;
- inconsistência de sessão;
- tentativa duplicada evitada.

Não registrar áudio bruto nem informações sensíveis desnecessárias.

## Métricas técnicas

- tempo de geração do baralho;
- tempo para começar a sessão;
- latência de avaliação;
- taxa de fallback;
- falhas da IA;
- falhas do Teable;
- sessões abandonadas;
- conclusões duplicadas bloqueadas.

## Limites

- máximo de 30 palavras por sessão;
- máximo de 60 cards ou apresentações iniciais;
- tamanho máximo de resposta;
- timeout da IA;
- timeout do áudio;
- limite de reapresentações;
- validação estrita de IDs pertencentes ao usuário e perfil.

## Rollout

### Etapa 1 — Desenvolvimento local

- fixtures determinísticas;
- IA simulada;
- Teable simulado;
- testes unitários e integração.

### Etapa 2 — Ambiente pessoal

- habilitar via flag `FLASHCARD_ACTIVE_RECALL_ENABLED`;
- testar sessões de 2, 5, 10 e 30 palavras;
- testar interrupção e retomada;
- testar deploy com IA indisponível;
- comparar registros com interface.

### Etapa 3 — Produção pessoal

- habilitar somente para o perfil atual;
- monitorar primeiras sessões;
- conferir agendamento no dia seguinte;
- validar timezone;
- revisar palavras difíceis manualmente.

### Etapa 4 — Estabilização

- ajustar intervalos;
- corrigir falsos positivos de resposta;
- calibrar tempo rápido ou lento;
- revisar qualidade das frases;
- remover compatibilidade antiga apenas depois de estabilidade.

---

# Estratégia de testes

## Unitários

- normalização;
- comparação;
- aceitação de variantes;
- distribuição de cards;
- validação de frases;
- fila;
- agendamento;
- agregação por palavra;
- pontuação;
- timezone;
- idempotência.

## Integração

- criação da sessão;
- persistência dos cards;
- resposta;
- reapresentação;
- conclusão;
- atualização das palavras;
- retomada;
- retreino;
- calendário.

## E2E

1. Criar treino com duas palavras.
2. Responder corretamente.
3. Errar e receber reapresentação.
4. Usar STT.
5. Concluir.
6. Conferir resultado.
7. Reabrir palavra.
8. Conferir próxima revisão.
9. Conferir calendário.
10. Tentar concluir novamente e confirmar idempotência.

## QA visual

- celulares pequenos;
- iPhone e Safari;
- Android e Chrome;
- teclado aberto;
- texto longo;
- tradução ausente;
- frase grande;
- redução de movimento;
- modo sem áudio;
- carregamento lento.

---

# Ordem final de execução

1. PR 0 — baseline.
2. PR 1 — tentativa obrigatória.
3. PR 2 — quatro níveis, lacunas e reapresentação.
4. PR 3 — persistência completa no Teable.
5. PR 4 — algoritmo adaptativo.
6. PR 5 — áudio, retomada e retreinos.
7. PR 6 — resultados e calendário.
8. PR 7 — rollout e estabilização.

Cada PR deve terminar com:

- TypeScript;
- lint;
- testes unitários;
- testes de integração relevantes;
- build;
- QA móvel;
- relatório das mudanças;
- instruções de deploy;
- plano de rollback.

O próximo passo recomendado é consolidar o estado atual no PR 0 e, em seguida, iniciar o PR 1.
