# Seleção de nível por idioma — Design

Data: 2026-08-13
Status: aprovado (design)

## Problema

O nível do usuário ("Iniciante", "Intermediário (B1)", "Avançado") é salvo por perfil de idioma e consumido pelo chat em `lib/learning/conversation-teacher.ts` (system prompt: `Nível do usuário: ...`). Porém, na prática ele nunca muda depois da criação do perfil:

1. A tela de troca de idioma (`/onboarding?mode=language`, acessada pelo seletor da home) não exibe seleção de nível — só a lista de idiomas (`components/OnboardingForm.tsx`, branch `languageSelectionOnly`).
2. `createOrActivateLanguageProfile` (`lib/learning/profile.ts`) ignora o `level` do payload quando o perfil do idioma já existe — apenas ativa o perfil antigo, com o nível antigo (default "Intermediário (B1)").
3. A tela de perfil (`components/ProfilePreferences.tsx`) exibe o nível mas não permite editá-lo.

Resultado: home, perfil e chat ficam presos em "Intermediário (B1)" para qualquer perfil criado sem nível explícito.

## Objetivo

Permitir escolher/alterar o nível (a) na tela de troca de idioma e (b) na tela de perfil, persistindo por perfil de idioma, de forma que o chat passe a usar o nível escolhido.

## Design

### 1. Constante compartilhada de níveis

- Em `lib/learning/profile.ts`, exportar:
  - `LANGUAGE_LEVELS = ["Iniciante", "Intermediário (B1)", "Avançado"]` (as const, tipo `LanguageLevel`).
  - `DEFAULT_LANGUAGE_LEVEL = "Intermediário (B1)"`.
- Substituir os literais existentes: `levelOptions` local de `components/OnboardingForm.tsx` e o default `"Intermediário (B1)"` em `createLanguageProfile` passam a usar essas constantes.

### 2. Backend — persistir nível ao ativar perfil existente

Arquivo: `lib/learning/profile.ts`, função `createOrActivateLanguageProfile`.

- Quando o perfil do idioma já existe e `payload.level` é um valor válido de `LANGUAGE_LEVELS` e diferente do nível atual:
  - Atualizar `level` e `updated_at` no registro do perfil (via `client.updateRecord`).
  - Registrar o evento `language_profile_activated` incluindo o nível efetivo (como já faz), mais evento `language_level_updated` com `{ language_code, previous_level, level }` quando houve mudança.
- Quando `payload.level` é ausente ou inválido: manter o nível atual (sem erro — o fluxo de troca de idioma não deve falhar por isso).
- O onboarding completo (mode `onboarding`) usa a mesma função, então passa a atualizar o nível de perfis existentes também — comportamento desejado.

### 3. Troca de idioma — UI

Arquivos: `components/OnboardingForm.tsx`, `app/onboarding/page.tsx`.

- No branch `languageSelectionOnly`, renderizar a seção "Qual seu nível?" (mesmos pills do onboarding completo) abaixo de `LanguageChoices`.
- Pré-preenchimento por idioma: `app/onboarding/page.tsx` passa nova prop `profileLevels: Array<{ languageCode: string; level: string }>` com todos os perfis do usuário (listar `languageProfiles` do usuário, similar a `getProfileSettings`). Ao trocar `languageIndex`, o estado `level` é atualizado para o nível salvo daquele idioma, se existir; caso contrário mantém a seleção atual.
- Submit: sem mudança de contrato — o body já envia `level`. Texto do botão permanece `Usar {idioma}`.

### 4. Perfil — edição de nível

Arquivos: `components/ProfilePreferences.tsx`, `lib/learning/account.ts`, `app/api/preferences/route.ts`.

- UI: pills de nível logo abaixo do select "Idioma ativo", salvando imediatamente ao clicar (padrão `savePreference`, otimista com rollback em erro, igual às demais preferências).
  - Decisão de UX: os pills refletem e editam sempre o nível do perfil **ativo persistido** (`activeProfile`), nunca o valor provisório do select — o select de idioma só persiste ao clicar em "Salvar perfil" (comportamento existente, inalterado), e após o refresh os pills passam a mostrar o nível do novo idioma ativo. Isso evita salvar o nível no perfil errado e é consistente com as demais preferências da página, que já atuam sobre o perfil ativo.
- `lib/learning/account.ts` `updatePreferences`: aceitar `level?: string`; validar contra `LANGUAGE_LEVELS` — valor inválido lança `AccountValidationError("Nível de conhecimento inválido.")` (400). Válido → atualiza `level` + `updated_at` do perfil ativo (junto aos demais campos).
- `app/api/preferences/route.ts`: repassar `level` do body quando string.

### 5. Consumidores — sem mudança

- Chat (`lib/learning/conversation-teacher.ts`) lê `profile.fields.level` a cada conversa.
- Home (`components/HomeDashboard.tsx`) e perfil exibem o valor do banco.
- Ambos refletem o novo nível automaticamente após `router.refresh()`.

## Tratamento de erros

- Nível inválido via `/api/preferences` → 400 com mensagem em pt-BR; UI faz rollback otimista e exibe `inline-error`.
- Nível inválido/ausente via `/api/onboarding` → ignorado, mantém nível atual (troca de idioma não falha).
- Sem perfil de idioma ativo ao chamar `/api/preferences` → erro existente "Crie um perfil de idioma..." permanece.

## Testes

Seguir o padrão de `tests/unit` (stubs de Teable client):

1. `createOrActivateLanguageProfile` com perfil existente e nível novo válido → atualiza `level`/`updated_at` e emite `language_level_updated`.
2. Mesma função com `level` ausente ou inválido → nível preservado, sem erro.
3. `updatePreferences` com `level` válido → persiste no perfil ativo.
4. `updatePreferences` com `level` inválido → `AccountValidationError`.

## Fora de escopo

- Níveis granulares (A1–C2) ou nível detectado automaticamente pela IA.
- Edição de nível de idiomas não-ativos na tela de perfil.
- Mudanças no prompt do professor (já consome o campo).
