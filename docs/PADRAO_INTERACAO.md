# Padrão de interação — sons, vibração e celebração

Este documento define o padrão de feedback do app. Qualquer tela/componente novo deve segui-lo — assim a experiência fica consistente sem espalhar chamadas manuais por todo o código.

## Regra 1: todo `<button>` clica com som + vibração (global, automático)

`components/ButtonFeedback.tsx` (montado no layout raiz) escuta cliques em nível de documento e toca `playSound("button")` + `vibrate("tap")` para **qualquer `<button>` habilitado**. Não é preciso (nem se deve) chamar `playSound("button")` dentro de handlers — o global cobre login, chat, treinadores, dialogs, CTAs e navegação.

- **Opt-out pontual:** `<button data-silent>` (use só com justificativa — ex.: um botão que já toca outro som no mesmo clique).
- **Deliberadamente silenciosos:** as palavras do karaoke no chat (`<span>`, para não apitar a cada palavra tocada) e switches `<input type="checkbox">` (o estado visual é o feedback).

## Regra 2: sons de resultado são do componente, não do clique

| Momento | Som | Vibração | Onde implementado |
| --- | --- | --- | --- |
| Veredito correto/aceitável | `correct` | `success` | `FlashcardTrainer`, `NewWordsTrainer` |
| Veredito "quase" | `neutral` | — | idem |
| Veredito erro | `wrong` | `warn` | idem |
| Novo significado registrado | `achievement` | — | `NewWordsTrainer` |
| Sessão concluída | `complete` | `celebrate` | `SessionCelebration` (treinos) |
| Meta da conversa atingida | `goal` | `success` | `ConversationGoalProgress` |
| Marco de streak | `achievement` | `celebrate` | `MilestoneModal` |
| Conquista desbloqueada | `achievement` | `celebrate` | `AchievementToast` |
| Perfil criado (onboarding) | `achievement` | `celebrate` | `OnboardingForm` |
| Correção aplicada no chat | `neutral` | `tap` | `ChatConversation` |

## Regra 3: confetti em celebração de fim

Confetti acompanha: resultado das sessões, meta da conversa, marco de streak, resumo pós-conversa e onboarding concluído. O **resumo** (`/resumo`) é server-rendered e abre sem gesto do usuário, então **não toca som** (o AudioContext pode estar bloqueado) — o confetti compensa.

## Regra 4: o usuário controla

Sons e vibração têm toggle persistido no Perfil (`localStorage`), respeitado por todas as chamadas (`isSoundEnabled` / `isHapticsEnabled`). `prefers-reduced-motion` desliga confetti e animações decorativas.

## Cobertura por modalidade (auditada em 2026-09-03)

- **Chat:** clique global ✓ · veredito de correção ✓ · meta ✓ · finalização → resumo com confetti ✓
- **Palavras novas:** clique global ✓ · vereditos ✓ · celebração ✓ · CTA "Revisar em cards" ✓ · espera com dicas ✓
- **Treino de cards:** clique global ✓ · vereditos com intervalo ✓ · celebração ✓ · CTA "Usar em conversa" ✓
- **Transversal:** streak (Home/Chat/Progresso/Calendário/Perfil) ✓ · badge de fila ✓ · conquistas/toast ✓ · XP/nível real (Progresso) ✓ · missões e meta do dia (Home) ✓
