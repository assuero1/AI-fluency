# Segunda Revisão de UI/UX — Talkito via StitchMCP

**Data:** 04 de setembro de 2026  
**Ferramenta:** Google StitchMCP (Projeto ID: `10026209334703654067`)  
**Modelo de Geração:** Gemini 3.1 Pro  
**Design System Formalizado:** *Sticker Calmo* (EdTech Moderna, Lúdica e Minimalista)

---

## 1. Projeto e Telas Geradas no Stitch

Criamos o projeto oficial **"Talkito - AI Language Learning"** no Stitch e geramos telas em alta fidelidade com viewport mobile (390×844) utilizando o **Gemini 3.1 Pro**, validando o conceito visual e as diretrizes pedagógicas:

| Tela | Screen ID | Conceito & Validação |
|---|---|---|
| **01. Início (Home Dashboard)** | `1f82c493bcc84e97ac0efcf9073a1f0d` | Hero "Hoje" com fundo verde pastel (#e7f8d5), exibição de progresso "0 de 15 min" com peso 900, botão 3D verde com microfone, cartão de tema integrado e bottom nav limpa. |
| **02. Conversa (Chat com IA)** | `eb30f0c3efad4971b12099e4691a21b2` | Header de sessão com timer, bolha da IA com controles de áudio direto (reprodução, velocidade lenta e tradução), bolha do aluno em azul suave (#ddf1fe), caixa de dica inline e compositor com microfone 3D. |

---

## 2. Formalização do Design System "Sticker Calmo" no Stitch

A análise do Stitch extraiu e consolidou os princípios fundamentais de design do Talkito:

### 2.1 Metáfora "Paper & Sticker" (Papel e Adesivo)
- **Nível 0 (Fundo):** Papel creme quente (`#faf8f5`), reduzindo a fadiga visual durante sessões longas de estudo.
- **Nível 1 (Cartões e Conteúdo):** Superfícies brancas puras (`#ffffff`) com borda suave de 1px (`#efe9df`) e elevação difusa (`0 4px 12px rgba(0, 0, 0, 0.04)`). O conteúdo parece repousar suavemente sobre o fundo, sem contornos pesados.
- **Nível 2 (Elementos Ativos / Stickers):** Botões e chips interativos possuem um relevo 3D de 2px na borda inferior (`--shadow-cta`), simulando a sensação física de um adesivo clicável que se comprime ao toque (`translateY(2px)`).

### 2.2 Cores e Intencionalidade Pedagógica
- **Verde Marca (`#58cc02` / deep `#58a700` / soft `#e7f8d5`):** Foco em ação primária, início de prática e hábitos diários.
- **Azul Chat (`#1cb0f6` / deep `#148fd6` / soft `#ddf1fe`):** Comunicação ativa, diálogo e conversação fluida.
- **Roxo Vocabulário (`#a560ff` / soft `#f1e6ff`):** Banco de palavras, repetição espaçada (SRS) e expansão lexical.
- **Laranja & Âmbar (`#ff9600` / `#ffc800`):** Metas temporais, sequência (streak) e conquistas.

---

## 3. Insights e Comparações com a Implementação do App

### O que o Stitch validou e confirmou como acerto:
1. **Unificação do Cartão de Tema na Home:** A remoção de botões soltos empilhados e a colocação das ações ("Sugerir um tema" e "Começar com este tema") no rodapé do próprio cartão eliminou o ruído visual mais crítico da tela inicial.
2. **Botões Tonais para Ações Secundárias:** O uso de fundos suaves (`--section-soft`) sem sombra 3D em botões secundários permitiu que apenas o CTA principal chame a atenção do aluno.
3. **Harmonia Cromática por Seção:** O alinhamento das ações de Progresso (âmbar) e Calendário (laranja) com suas respectivas cores de seção reforçou a identidade visual sem criar dissonâncias.

### Recomendações e Próximos Passos Identificados no Stitch:
1. **Controles de Áudio da Mensagem no Chat:**
   - Agrupamento em linha de botões de toque confortáveis logo abaixo da frase em inglês: reproduzir normal, ouvir mais lento (0.75x) e tradução sob demanda.
2. **Dicas Pedagógicas em Bloco Suave:**
   - Sugestões da IA com destaque âmbar suave (`--warning-soft`) mantêm o aluno encorajado sem interrupções modais.
3. **Feedback Tátil em Cards SRS:**
   - A animação física de compressão ao avaliar o cartão reforça o ciclo de memorização ativa.
