# Avaliação de UI/UX — Talkkito (todas as telas)

Avaliação em 2026-09-03, sobre o build local (rebrand Talkkito não-commitado + refinamentos F0–F4).
Método: screenshots de 23 telas/estados em viewport mobile 390×844 (`.playwright-mcp/ui-review-2026-09-03/`)
via `scripts/visual-audit-after.mjs` + `visual-audit-extra.mjs` + `visual-audit-flows.mjs`, com fixture QA
(`qa-fixture.mjs`) para dados realistas; checagem de consistência contra `docs/PADRAO_UI.md` (greps da
checklist oficial).

## Veredito geral

**Base sólida — 7,5/10.** A identidade é forte e não-genérica: mascote camaleão com balões de fala,
Nunito pesada bem escalonada, botões chunky 3D, paleta por seção (verde home · roxo palavras · azul
chat · âmbar progresso), hero cards com gradiente. O app não parece template. Os gaps estão nos
**estados de borda** (vazio, zero, travado), em **truncamentos** e no **acabamento de copy**
(pluralização mecânica) — não no sistema visual.

## O que está funcionando bem

- **Personalidade sem ruído**: mascote + balão ("Olá de novo!", "Quase lá!") em login/reset; loading
  "Montando seu treino…" com camaleão roxo e chips flutuantes é um momento de marca genuíno.
- **Tipografia**: escala clara (display 31/900, seção 20/800, meta 14/600); hierarquia imediata.
- **Copy honesta e ativa**: "As chaves ficam no servidor. O app mostra apenas status e máscaras";
  "Sem problema — este card volta ainda nesta sessão"; "Reconecte para continuar. Mensagens não
  enviadas não são salvas offline." Erro sem desculpa, direção clara.
- **Sistema de tokens real**: `.section-*` recolore o botão primário por seção via CSS vars; hex em
  tsx é praticamente zero (6 ocorrências, todas justificáveis exceto 1).
- **Quality floor**: safe-area insets, alvos ≥44px, `.screen` com padding que limpa a nav fixa
  (verificado), ModalDialog com focus trap, aria-labels nos dias do calendário, skip link.
- **Onboarding** (`?mode=language`): wizard claro, CTA com label dinâmico ("Usar Inglês").

## P1 — machuca a experiência hoje

1. **`/settings/connections` exposto na navegação do usuário.** Máscaras de service role key,
   provider/modelo de IA e chave de voz em tela acessível pelo Perfil. É tela de diagnóstico/admin —
   num app de consumidor indo para as lojas, confunde e sugere engenharia exposta. Esconder atrás de
   flag (ex.: `?debug=1`) ou mover para build interno.
2. **Truncamentos de informação essencial em 390px**: home mostra o idioma como "Ingl…" (seletor);
   chat trunca o tema em "TÓPICO Re…"; perfil corta "Inglês · Intermediário …" no dropdown. O nome do
   idioma/tema é o dado central desses controles — encolher o vizinho, não a informação.
3. **Conquistas é um muro cinza**: 15 linhas idênticas de cadeado, sem barra de progresso por
   conquista, sem destaque da "mais próxima", sem diferencial visual entre conquistas. É a tela de
   motivação/retenção e hoje não motiva. Além disso **não tem "Voltar" no topo** — só no rodapé, após
   15 itens, quebrando o padrão `BackButton` ("toda tela de detalhe") usado em Connections, word-detail
   e treino.
4. **Pluralização mecânica "(s)" visível**: "1 feedback(s) · 1 conversa(s)" (calendário),
   "1 sessão(ões)" (progresso), "1 palavras" (pills de feedback). Ocorre também em
   VocabularyPicker.tsx (`selecionada(s)`, `uso(s) registrado(s)`). Num app de **idiomas**, plural
   errado é o pior tipo de erro de acabamento.
5. **Flashcard mostra "Português → idioma estudado"** em vez do idioma real ("Inglês") na tela
   assinatura do produto. Placeholder genérico vazando para a UI.

## P2 — consistência e polimento

6. **Drift do botão escuro**: `dark-button` (spec: confirmação em modal) é usado como CTA de tela em
   "Praticar palavras fracas" (word-detail), "Treinar foco da semana" (progresso) e "Salvar modelo"
   (connections). Ou o PADRAO_UI documenta o terceiro tier ("foco recomendado"), ou os CTAs voltam ao
   primário da seção.
7. **Selected-state inconsistente para o mesmo controle**: pill de nível selecionada é verde no
   onboarding e cinza-azulada no Perfil; choice-cards de correção idem. O usuário aprende uma cor de
   "selecionado" e a vê mudar.
8. **"Novas por dia" padrão 0**: a fila SRS de um usuário novo fica permanentemente vazia ("Nada na
   fila de hoje") a menos que ele descubra o stepper. Revisar default (ex.: 3) no onboarding.
9. **Estados vazios fora do padrão**: fila do treino usa texto solto, não o componente `EmptyState`
   (ícone 28 + título + CTA) usado em resumo/palavras. Linha "0 fortes · 0 aprendendo · 0 consolidando
   · 0 sem uso" é ruído puro para quem começa; e "aprendendo" vs pill "Em aprendizado" são dois nomes
   para o mesmo estado.
10. **Chat**: "Finalizar conversa" é enorme, sempre visível e colado acima do composer (risco de
    toque acidental; peso visual de primário para ação de saída). Botão-flutuante do tutor (capelo)
    colide visualmente com os avatares das mensagens na borda esquerda.
11. **Sugestões da home sem clamp**: descrição de tema gerada por IA sem limite de linhas — um card
    ("Validating a Software Bug Report…") fica 3× mais alto que os vizinhos. "Sugerir um tema para
    mim" quebra em 2 linhas; encurtar para "Sugerir um tema". Linha "Revisar: practice, fixture" com
    tag+botão quebrando de forma apertada.
12. **Links sob métricas da home confusos**: "Feedback mais recente" / "Ver detalhes" / "No feedback
    mais recente" — o terceiro é estado vazio mas renderiza como link verde clicável.
13. **Redundâncias de copy**: progresso diz "Faltam ~150 palavras… para Avançado" E "Próximo nível:
    Avançado (B1→C1)"; hero da home diz "0 de 15 min" E "meta de 15 min"; word-detail tem header
    "Significados" + pill "1 significado"; reset repete "Nova senha" em label e placeholder.
14. **Dois esquemas de semana**: "Sequência" no progresso usa janela rolante de 7 dias (S S D S T Q Q —
    difícil de ler, dois S adjacentes, D no meio) enquanto o calendário usa D S T Q Q S S. Padronizar
    na semana-calendário.
15. **Progresso saturado de amarelo**: hero amarelo + card de foco amarelo + ícones/sublabels âmbar na
    mesma tela. Considerar cards brancos com acentos âmbar.
16. **Word-detail**: semântica das pills "Principal" vs "Novo" não é óbvia; "0 acertos seguidos ·
    0 lapsos" usa jargão interno ("lapsos").

## P3 — nits

17. Estado desabilitado dos CTAs é a versão pálida da própria cor (verde/roxo) — lê-se como
    "primário fraco"; cinza ou opacidade menor sinalizariam melhor.
18. Legenda do calendário "menos ●●●● mais" com os 4 pontos praticamente invisíveis (brancos).
19. Conquista cita "Nível Duolingo de disciplina" — nome de concorrente no copy do produto.
20. Ícone do offline é verde (hue positiva) para estado negativo; CTA cinza-ardósia introduz uma 5ª
    cor de botão no sistema.
21. Gráfico "Palavras novas por semana" quase vazio com eixo minúsculo — para dados próximos de zero,
    um estado vazio comunicaria melhor.
22. Único hex remanescente em componente: `WordPracticeButton.tsx:37` (`#fff` → usar token).

## Notas por tela

| Tela | Nota | Comentário |
|---|---|---|
| Login / Reset | 9 | Identidade forte, consistente; nits de placeholder/tab |
| Onboarding (2 estados) | 8.5 | Wizard claro; input de nome sem borda parece heading |
| Home | 8 | Hierarquia excelente; truncamento "Ingl…", sugestões sem clamp |
| Chat (config, conversa, resposta) | 7.5 | Bom composer/toolbar; "Finalizar" pesado, tema truncado, tutor flutuante colide |
| Palavras (lista) | 8 | Hero assinatura bom; linha de zeros é ruído |
| Word-detail | 8 | Anatomia rica; CTAs escuros fora de spec |
| Treino (vazio, custom, sessão, card frente/verso, resume) | 7.5 | Faces bonitas, copy encorajadora; "idioma estudado", fila vazia sem EmptyState, default 0 |
| Novas | 8.5 | Mais clara do app; CTA roxo coerente com seção |
| Progresso | 7 | Rico, mas amarelo saturado, pluralização, semana rolante |
| Resumo (vazio) | 8.5 | EmptyState exemplar |
| Perfil | 8 | Bem agrupado; selected-state diverge do onboarding |
| Conquistas | 5 | Muro cinza sem progresso nem back no topo |
| Calendário | 7.5 | Grid claro; pluralização, legenda invisível |
| Connections | 6 | Bem feita, mas não deveria estar no caminho do usuário |
| Offline | 7 | Copy boa; cor do ícone/CTA |

## Divergências da checklist do PADRAO_UI (Definition of Done)

- Hex em tsx: 6 ocorrências (5 justificáveis — global-error/layout; 1 não: WordPracticeButton).
- Style inline: 17 ocorrências — majoritariamente valores dinâmicos permitidos (larguras de progresso).
- "Verbos idênticos": cumprido ("Ver tudo", "Voltar a X"), exceto Conquistas sem back no topo.
- "Um elemento = uma função ≤1×": streak e CTA primário respeitados nas capturas.
- Alvos ≥44px e foco visível: ok nas capturas; `.screen` limpa a nav fixa corretamente
  (globals.css:150) — aparentes sobreposições nos PNGs fullPage são artefato de captura.

## Como reproduzir

```bash
node scripts/qa-fixture.mjs                 # dados ricos no usuário QA
npx next build && (set -a; source .env.qa.local; set +a; npx next start -p 3016)
node scripts/visual-audit-after.mjs .playwright-mcp/ui-review-2026-09-03
node scripts/visual-audit-extra.mjs         # reset-password, offline, word-detail
node scripts/visual-audit-flows.mjs         # treino em sessão + chat (tema → conversa → resposta)
```

Atenção: não rodar `next build` com um `next dev` ativo no mesmo `.next` — corrompe os manifestos de
assets (páginas servidas sem CSS). Foi a causa das capturas quebradas no meio da auditoria.
