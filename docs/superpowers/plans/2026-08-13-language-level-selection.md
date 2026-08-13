# Language Level Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir escolher e alterar o nível (Iniciante / Intermediário (B1) / Avançado) por perfil de idioma — na troca de idioma e no perfil — fazendo o backend persistir o nível para que o chat o use.

**Architecture:** O nível já é consumido pelo chat (`lib/learning/conversation-teacher.ts`) a partir de `languageProfiles.level`. Este plano adiciona uma constante compartilhada de níveis em um módulo client-safe, faz `createOrActivateLanguageProfile` persistir o nível ao ativar um perfil existente (hoje ignorado), estende `updatePreferences`/`/api/preferences` com `level`, e expõe pills de nível nas telas de troca de idioma e de perfil.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Vitest (unit), Teable/Supabase via `lib/teable/client.ts`.

**Spec:** `docs/superpowers/specs/2026-08-13-language-level-selection-design.md`

**Desvio deliberado da spec:** a constante `LANGUAGE_LEVELS` fica em `lib/learning/levels.ts` (módulo novo, sem dependências server), não em `lib/learning/profile.ts` — `profile.ts` importa env/Teable/settings (grafo server-only) e não pode ser puxado por componentes client (`OnboardingForm`, `ProfilePreferences` são `"use client"`). O script `npm run security:bundle` verifica vazamento de módulos server para o bundle client.

## Global Constraints

- Níveis válidos são exatamente: `Iniciante`, `Intermediário (B1)`, `Avançado`. Default: `Intermediário (B1)`.
- Mensagens de erro e textos de UI em pt-BR, seguindo o estilo existente.
- Não executar `git commit` sem confirmação explícita do usuário — os passos de commit indicam o agrupamento sugerido; confirmar com o usuário antes de rodar cada um.
- Componentes client não podem importar `lib/learning/profile.ts` nem `lib/learning/account.ts` (grafo server-only); constantes de nível vêm de `lib/learning/levels.ts`.
- Testes unitários rodam com `npx vitest run <arquivo>`; suite completa com `npm run test:unit`. Verificação final: `npm run typecheck && npm run lint`.

---

### Task 1: Constantes de nível compartilhadas

**Files:**
- Create: `lib/learning/levels.ts`
- Test: `tests/unit/language-levels.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces (usado pelas Tasks 2, 3, 4 e 5):
  ```ts
  export const LANGUAGE_LEVELS: readonly ["Iniciante", "Intermediário (B1)", "Avançado"]
  export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number]
  export const DEFAULT_LANGUAGE_LEVEL: LanguageLevel  // "Intermediário (B1)"
  export function isLanguageLevel(value: unknown): value is LanguageLevel
  ```

- [ ] **Step 1: Write the failing test**

Criar `tests/unit/language-levels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_LANGUAGE_LEVEL, isLanguageLevel, LANGUAGE_LEVELS } from "../../lib/learning/levels";

describe("language levels", () => {
  it("lists exactly the supported levels with B1 as default", () => {
    expect(LANGUAGE_LEVELS).toEqual(["Iniciante", "Intermediário (B1)", "Avançado"]);
    expect(DEFAULT_LANGUAGE_LEVEL).toBe("Intermediário (B1)");
  });

  it("accepts only the supported levels", () => {
    expect(isLanguageLevel("Iniciante")).toBe(true);
    expect(isLanguageLevel("Intermediário (B1)")).toBe(true);
    expect(isLanguageLevel("Avançado")).toBe(true);
    expect(isLanguageLevel("Expert")).toBe(false);
    expect(isLanguageLevel("")).toBe(false);
    expect(isLanguageLevel(undefined)).toBe(false);
    expect(isLanguageLevel(42)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/language-levels.test.ts`
Expected: FAIL com erro de módulo não encontrado (`../../lib/learning/levels`).

- [ ] **Step 3: Write minimal implementation**

Criar `lib/learning/levels.ts`:

```ts
export const LANGUAGE_LEVELS = ["Iniciante", "Intermediário (B1)", "Avançado"] as const;
export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number];
export const DEFAULT_LANGUAGE_LEVEL: LanguageLevel = "Intermediário (B1)";

export function isLanguageLevel(value: unknown): value is LanguageLevel {
  return typeof value === "string" && (LANGUAGE_LEVELS as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/language-levels.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit** (confirmar com o usuário antes)

```bash
git add lib/learning/levels.ts tests/unit/language-levels.test.ts
git commit -m "feat: add shared language level constants"
```

---

### Task 2: Backend persiste nível ao ativar perfil existente

**Files:**
- Modify: `lib/learning/profile.ts:112-160` (`createLanguageProfile`, `createOrActivateLanguageProfile`)
- Test: `tests/unit/language-level-activation.test.ts`

**Interfaces:**
- Consumes: `isLanguageLevel`, `DEFAULT_LANGUAGE_LEVEL` de `lib/learning/levels.ts` (Task 1).
- Produces: `createOrActivateLanguageProfile(user, payload)` agora atualiza `level`/`updated_at` quando `payload.level` é válido e diferente, e emite o evento `language_level_updated` com `{ language_code, previous_level, level }`. Comportamento inalterado quando `payload.level` é ausente/inválido/igual.

- [ ] **Step 1: Write the failing test**

Criar `tests/unit/language-level-activation.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageProfileFields, UserFields } from "../../lib/learning/profile";
import type { TeableRecord } from "../../lib/teable/client";

const user: TeableRecord<UserFields> = { id: "user-a", fields: { Name: "Camila", created_at: "2026-08-13T12:00:00.000Z" } };

function languageProfile(fields: Partial<LanguageProfileFields> = {}): TeableRecord<LanguageProfileFields> {
  return {
    id: "profile-en",
    fields: {
      user_id: user.id,
      language_code: "en",
      language_name: "Inglês",
      level: "Intermediário (B1)",
      learning_goal: "Falar com mais naturalidade em situações reais.",
      correction_style: "Corrigir sempre",
      audio_enabled: true,
      transcript_enabled: true,
      calendar_memory_enabled: true,
      weekly_conversation_goal: 7,
      weekly_word_goal: 500,
      created_at: "2026-08-13T12:00:00.000Z",
      updated_at: "2026-08-13T12:00:00.000Z",
      ...fields
    }
  };
}

const existing = languageProfile();
const listRecords = vi.fn();
const createRecord = vi.fn();
const updateRecord = vi.fn();
const createEvent = vi.fn();
const safeUpdateRecord = vi.fn(async () => null);

vi.mock("../../lib/teable/client", () => ({
  getTeableClient: () => ({ listRecords, createRecord, updateRecord, createEvent }),
  safeUpdateRecord
}));

describe("createOrActivateLanguageProfile level handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRecords.mockResolvedValue([existing]);
    updateRecord.mockImplementation(async (_table: string, id: string, fields: Record<string, unknown>) => ({
      id,
      fields: { ...existing.fields, ...fields }
    }));
    createEvent.mockResolvedValue({ id: "event-a", fields: {} });
  });

  it("updates the stored level when a different valid level is provided", async () => {
    const { createOrActivateLanguageProfile } = await import("../../lib/learning/profile");
    const result = await createOrActivateLanguageProfile(user, { language_code: "en", level: "Avançado" });

    expect(updateRecord).toHaveBeenCalledWith(
      "languageProfiles",
      "profile-en",
      expect.objectContaining({ level: "Avançado", updated_at: expect.any(String) })
    );
    expect(createEvent).toHaveBeenCalledWith(
      user.id,
      "language_level_updated",
      expect.objectContaining({ language_code: "en", previous_level: "Intermediário (B1)", level: "Avançado" })
    );
    expect(createEvent).toHaveBeenCalledWith(
      user.id,
      "language_profile_activated",
      expect.objectContaining({ level: "Avançado" })
    );
    expect(result.fields.level).toBe("Avançado");
  });

  it("keeps the stored level when the payload level is missing or invalid", async () => {
    const { createOrActivateLanguageProfile } = await import("../../lib/learning/profile");

    const missing = await createOrActivateLanguageProfile(user, { language_code: "en" });
    expect(missing.fields.level).toBe("Intermediário (B1)");

    const invalid = await createOrActivateLanguageProfile(user, { language_code: "en", level: "Expert" });
    expect(invalid.fields.level).toBe("Intermediário (B1)");

    expect(updateRecord).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalledWith(user.id, "language_level_updated", expect.anything());
    expect(createEvent).toHaveBeenCalledWith(
      user.id,
      "language_profile_activated",
      expect.objectContaining({ level: "Intermediário (B1)" })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/language-level-activation.test.ts`
Expected: FAIL — `updateRecord` nunca é chamado hoje (`expect(updateRecord).toHaveBeenCalledWith(...)` falha).

- [ ] **Step 3: Write minimal implementation**

Em `lib/learning/profile.ts`, adicionar o import no topo:

```ts
import { DEFAULT_LANGUAGE_LEVEL, isLanguageLevel } from "./levels";
```

Em `createLanguageProfile`, trocar o literal do default (linha ~119):

```ts
    level: payload.level ?? DEFAULT_LANGUAGE_LEVEL,
```

Substituir `createOrActivateLanguageProfile` inteiro por:

```ts
export async function createOrActivateLanguageProfile(user: TeableRecord<UserFields>, payload: OnboardingPayload) {
  const client = getTeableClient();
  const languageCode = (payload.language_code ?? "en").toLowerCase();
  const profiles = await client.listRecords<LanguageProfileFields>("languageProfiles", 50);
  const existingProfile = profiles.find(
    (profile) => profile.fields.user_id === user.id && profile.fields.language_code.toLowerCase() === languageCode
  );

  if (!existingProfile) return createLanguageProfile(user, payload);

  let activeProfile = existingProfile;
  const nextLevel = isLanguageLevel(payload.level) ? payload.level : null;
  if (nextLevel && nextLevel !== existingProfile.fields.level) {
    activeProfile = await client.updateRecord<LanguageProfileFields>("languageProfiles", existingProfile.id, {
      level: nextLevel,
      updated_at: new Date().toISOString()
    });
    await client.createEvent(user.id, "language_level_updated", {
      language_code: existingProfile.fields.language_code,
      previous_level: existingProfile.fields.level,
      level: nextLevel
    });
  }

  await safeUpdateRecord<UserFields>("users", user.id, { active_language_id: existingProfile.id });
  await client.createEvent(user.id, "language_profile_activated", {
    language_code: activeProfile.fields.language_code,
    language_name: activeProfile.fields.language_name,
    level: activeProfile.fields.level
  });

  return activeProfile;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/language-level-activation.test.ts`
Expected: PASS (2 testes). Rodar também `npx vitest run tests/unit/personal-user.test.ts` para garantir que `profile.ts` não quebrou.

- [ ] **Step 5: Commit** (confirmar com o usuário antes)

```bash
git add lib/learning/profile.ts tests/unit/language-level-activation.test.ts
git commit -m "feat: persist language level when activating an existing profile"
```

---

### Task 3: `updatePreferences` e `/api/preferences` aceitam nível

**Files:**
- Modify: `lib/learning/account.ts:20-27` (type `PreferenceInput`) e `:120-145` (`updatePreferences`)
- Modify: `app/api/preferences/route.ts:7-14`
- Test: `tests/unit/account-level-preferences.test.ts`

**Interfaces:**
- Consumes: `isLanguageLevel` de `lib/learning/levels.ts` (Task 1).
- Produces: `updatePreferences({ level?: string })` — persiste `level` no perfil ativo; lança `AccountValidationError("Nível de conhecimento inválido.")` para valor fora de `LANGUAGE_LEVELS`. A rota `PATCH /api/preferences` aceita `level` no body.

- [ ] **Step 1: Write the failing test**

Criar `tests/unit/account-level-preferences.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const user = { id: "user-a", fields: { Name: "Camila" } };
const profile = {
  id: "profile-en",
  fields: {
    user_id: user.id,
    language_code: "en",
    language_name: "Inglês",
    level: "Intermediário (B1)",
    correction_style: "Corrigir sempre",
    audio_enabled: true,
    transcript_enabled: true,
    calendar_memory_enabled: true,
    weekly_conversation_goal: 7,
    weekly_word_goal: 500,
    updated_at: "2026-08-13T12:00:00.000Z"
  }
};

const updateRecord = vi.fn();
const createEvent = vi.fn();

vi.mock("../../lib/learning/profile", () => ({
  getOrCreatePersonalUser: vi.fn(async () => user),
  getActiveLanguageProfile: vi.fn(async () => profile),
  getDailyNewCardsQuota: vi.fn(() => 10)
}));
vi.mock("../../lib/teable/client", () => ({
  getTeableClient: () => ({ updateRecord, createEvent }),
  safeUpdateRecord: vi.fn(async () => null)
}));

describe("updatePreferences level", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateRecord.mockImplementation(async (_table: string, id: string, fields: Record<string, unknown>) => ({
      id,
      fields: { ...profile.fields, ...fields }
    }));
    createEvent.mockResolvedValue({ id: "event-a", fields: {} });
  });

  it("persists a valid level on the active language profile", async () => {
    const { updatePreferences } = await import("../../lib/learning/account");
    const updated = await updatePreferences({ level: "Iniciante" });

    expect(updateRecord).toHaveBeenCalledWith(
      "languageProfiles",
      "profile-en",
      expect.objectContaining({ level: "Iniciante", updated_at: expect.any(String) })
    );
    expect(updated.fields.level).toBe("Iniciante");
  });

  it("rejects an unsupported level", async () => {
    const { updatePreferences, AccountValidationError } = await import("../../lib/learning/account");

    await expect(updatePreferences({ level: "Expert" })).rejects.toThrow(AccountValidationError);
    await expect(updatePreferences({ level: "Expert" })).rejects.toThrow("Nível de conhecimento inválido.");
    expect(updateRecord).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/account-level-preferences.test.ts`
Expected: FAIL — `updateRecord` é chamado sem `level` (só `updated_at`), então o primeiro teste falha.

- [ ] **Step 3: Write minimal implementation**

Em `lib/learning/account.ts`, ajustar o import de `./profile` e adicionar import de `./levels`:

```ts
import { getActiveLanguageProfile, getDailyNewCardsQuota, getOrCreatePersonalUser, LanguageProfileFields, UserFields } from "./profile";
import { isLanguageLevel } from "./levels";
```

Adicionar `level` ao type `PreferenceInput`:

```ts
type PreferenceInput = {
  correctionStyle?: string;
  level?: string;
  audioEnabled?: boolean;
  transcriptEnabled?: boolean;
  calendarMemoryEnabled?: boolean;
  weeklyConversationGoal?: number;
  weeklyWordGoal?: number;
};
```

Em `updatePreferences`, logo após o bloco de `correctionStyle` (linha ~131), adicionar:

```ts
  if (typeof input.level === "string") {
    if (!isLanguageLevel(input.level)) throw new AccountValidationError("Nível de conhecimento inválido.");
    fields.level = input.level;
  }
```

Em `app/api/preferences/route.ts`, adicionar `level` ao objeto passado a `updatePreferences`:

```ts
      correctionStyle: typeof body.correctionStyle === "string" ? body.correctionStyle : undefined,
      level: typeof body.level === "string" ? body.level : undefined,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/account-level-preferences.test.ts`
Expected: PASS (2 testes). Rodar também `npx vitest run tests/unit/account-privacy.test.ts` para regressão do módulo.

- [ ] **Step 5: Commit** (confirmar com o usuário antes)

```bash
git add lib/learning/account.ts app/api/preferences/route.ts tests/unit/account-level-preferences.test.ts
git commit -m "feat: allow updating language level via preferences API"
```

---

### Task 4: Pills de nível na troca de idioma

**Files:**
- Create: `components/LevelPills.tsx`
- Modify: `components/OnboardingForm.tsx` (branch `languageSelectionOnly`, ~linhas 133-162; branch completo, ~linhas 183-192; props ~72-78; state ~80-81; remover `levelOptions` linha 10)
- Modify: `app/onboarding/page.tsx`
- Test: `tests/unit/level-selection-ui.test.ts`

**Interfaces:**
- Consumes: `LANGUAGE_LEVELS`, `LanguageLevel` de `lib/learning/levels.ts` (Task 1).
- Produces:
  - `components/LevelPills.tsx` exporta `LevelPills({ level, onChange }: { level: string; onChange: (level: LanguageLevel) => void })` — usado também pela Task 5.
  - `OnboardingForm` aceita nova prop opcional `profileLevels?: Array<{ languageCode: string; level: string }>`.

- [ ] **Step 1: Write the failing test**

Criar `tests/unit/level-selection-ui.test.ts` (contrato no estilo de `tests/unit/ui-redesign-contracts.test.ts`):

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("language level selection UI contracts", () => {
  it("shows level pills on the language switch screen", () => {
    const form = read("components/OnboardingForm.tsx");
    const branch = form.split("if (languageSelectionOnly)")[1] ?? "";
    expect(branch).toContain("Qual seu nível?");
    expect(branch).toContain("LevelPills");
  });

  it("reuses the same level pills in the full onboarding", () => {
    const form = read("components/OnboardingForm.tsx");
    expect(form).not.toContain('const levelOptions');
    expect(form).toContain("LANGUAGE_LEVELS");
  });

  it("pre-fills the saved level of the selected language", () => {
    const form = read("components/OnboardingForm.tsx");
    expect(form).toContain("profileLevels");
    const page = read("app/onboarding/page.tsx");
    expect(page).toContain("profileLevels={profileLevels}");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/level-selection-ui.test.ts`
Expected: FAIL — branch `languageSelectionOnly` não contém "Qual seu nível?" e `levelOptions` ainda existe.

- [ ] **Step 3: Write minimal implementation**

Criar `components/LevelPills.tsx`:

```tsx
"use client";

import { LANGUAGE_LEVELS, LanguageLevel } from "@/lib/learning/levels";
import { Pill } from "./Pill";

export function LevelPills({ level, onChange }: { level: string; onChange: (level: LanguageLevel) => void }) {
  return (
    <div aria-label="Nível de conhecimento" className="level-pills" role="group">
      {LANGUAGE_LEVELS.map((option) => (
        <button aria-pressed={option === level} className="plain-button" key={option} onClick={() => onChange(option)} type="button">
          <Pill tone={option === level ? "primary" : "default"}>{option}</Pill>
        </button>
      ))}
    </div>
  );
}
```

Em `components/OnboardingForm.tsx`:

1. Remover a linha `const levelOptions = ["Iniciante", "Intermediário (B1)", "Avançado"];` e adicionar imports:

```tsx
import { DEFAULT_LANGUAGE_LEVEL, LanguageLevel } from "@/lib/learning/levels";
import { LevelPills } from "./LevelPills";
```

2. Adicionar a prop `profileLevels` (assinatura do componente):

```tsx
export function OnboardingForm({
  initialProfile = null,
  languageSelectionOnly = false,
  profileLevels = []
}: {
  initialProfile?: InitialProfile | null;
  languageSelectionOnly?: boolean;
  profileLevels?: Array<{ languageCode: string; level: string }>;
}) {
```

3. Trocar o fallback do state de nível e adicionar o seletor de idioma que pré-preenche o nível salvo:

```tsx
  const [level, setLevel] = useState(initialProfile?.level ?? DEFAULT_LANGUAGE_LEVEL);
```

```tsx
  function selectLanguage(index: number) {
    setLanguageIndex(index);
    const code = languageCode(languages[index].code);
    const saved = profileLevels.find((item) => item.languageCode.toLowerCase() === code);
    if (saved && level !== saved.level) setLevel(saved.level);
  }
```

4. Nos dois usos de `<LanguageChoices ... onSelect={setLanguageIndex} />`, trocar para `onSelect={selectLanguage}`.

5. No branch `if (languageSelectionOnly)`, logo após a `<section className="section">` com `<LanguageChoices ... />`, adicionar:

```tsx
        <section className="section">
          <h2 className="section-title">Qual seu nível?</h2>
          <LevelPills level={level} onChange={(option: LanguageLevel) => setLevel(option)} />
        </section>
```

6. No branch completo, substituir o bloco `levelOptions.map(...)` da seção "Qual seu nível?" por:

```tsx
        <LevelPills level={level} onChange={(option: LanguageLevel) => setLevel(option)} />
```

Em `app/onboarding/page.tsx`, listar os perfis do usuário e passar a prop:

```tsx
import { AppShell } from "@/components/AppShell";
import { OnboardingForm } from "@/components/OnboardingForm";
import { getActiveLanguageProfile, getExistingPersonalUser, LanguageProfileFields } from "@/lib/learning/profile";
import { getTeableClient } from "@/lib/teable/client";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  const user = await getExistingPersonalUser();
  const profile = user ? await getActiveLanguageProfile(user) : null;
  const profiles = user ? await getTeableClient().listRecords<LanguageProfileFields>("languageProfiles", 50) : [];
  const profileLevels = profiles
    .filter((item) => item.fields.user_id === user?.id)
    .map((item) => ({ languageCode: item.fields.language_code, level: item.fields.level }));

  return (
    <AppShell noNav>
      <OnboardingForm
        initialProfile={
          profile
            ? {
                languageCode: profile.fields.language_code,
                languageName: profile.fields.language_name,
                level: profile.fields.level,
                learningGoal: profile.fields.learning_goal,
                correctionStyle: profile.fields.correction_style,
                audioEnabled: profile.fields.audio_enabled,
                transcriptEnabled: profile.fields.transcript_enabled,
                calendarMemoryEnabled: profile.fields.calendar_memory_enabled,
                weeklyConversationGoal: profile.fields.weekly_conversation_goal,
                weeklyWordGoal: profile.fields.weekly_word_goal
              }
            : null
        }
        languageSelectionOnly={mode === "language"}
        profileLevels={profileLevels}
      />
    </AppShell>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/level-selection-ui.test.ts`
Expected: PASS (3 testes). Rodar também `npm run typecheck` para validar os componentes.

- [ ] **Step 5: Commit** (confirmar com o usuário antes)

```bash
git add components/LevelPills.tsx components/OnboardingForm.tsx app/onboarding/page.tsx tests/unit/level-selection-ui.test.ts
git commit -m "feat: add level pills to the language switch screen"
```

---

### Task 5: Pills de nível no perfil

**Files:**
- Modify: `components/ProfilePreferences.tsx:39-97` (state `preferences`), `:159-162` (inserir seção após o `</form>`)
- Test: `tests/unit/level-selection-ui.test.ts` (estender)

**Interfaces:**
- Consumes: `LevelPills` de `components/LevelPills.tsx` (Task 4); `DEFAULT_LANGUAGE_LEVEL`, `LanguageLevel` de `lib/learning/levels.ts` (Task 1); backend `PATCH /api/preferences` com `level` (Task 3).
- Produces: seção "Qual seu nível?" na tela de perfil que salva o nível do perfil ativo via `savePreference({ level })`.

- [ ] **Step 1: Write the failing test**

Adicionar ao final de `tests/unit/level-selection-ui.test.ts`, dentro do `describe` existente:

```ts
  it("lets the active profile level be edited from profile preferences", () => {
    const prefs = read("components/ProfilePreferences.tsx");
    expect(prefs).toContain("LevelPills");
    expect(prefs).toContain("savePreference({ level:");
    expect(prefs).toContain("Qual seu nível?");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/level-selection-ui.test.ts`
Expected: FAIL no novo teste — `ProfilePreferences.tsx` não contém `LevelPills`.

- [ ] **Step 3: Write minimal implementation**

Em `components/ProfilePreferences.tsx`:

1. Adicionar imports:

```tsx
import { DEFAULT_LANGUAGE_LEVEL } from "@/lib/learning/levels";
import { LevelPills } from "./LevelPills";
```

2. Adicionar `level` ao state `preferences` (linha ~43):

```tsx
  const [preferences, setPreferences] = useState({
    level: initial.activeProfile?.level ?? DEFAULT_LANGUAGE_LEVEL,
    correctionStyle: initial.activeProfile?.correctionStyle ?? "Corrigir sempre",
    audioEnabled: initial.activeProfile?.audioEnabled ?? true,
    transcriptEnabled: initial.activeProfile?.transcriptEnabled ?? true,
    calendarMemoryEnabled: initial.activeProfile?.calendarMemoryEnabled ?? true
  });
```

3. Inserir a seção logo após o fechamento `</form>` (antes da seção "Como a IA deve te corrigir?"), renderizada só quando há perfil ativo:

```tsx
      {initial.activeProfile ? (
        <section className="section">
          <h2 className="section-title">Qual seu nível?</h2>
          <LevelPills level={preferences.level} onChange={(option) => savePreference({ level: option })} />
        </section>
      ) : null}
```

Nota de UX (da spec): os pills refletem/editam sempre o nível do perfil **ativo persistido** (`initial.activeProfile`), não o idioma provisório do select — trocar o select só tem efeito após "Salvar perfil" + refresh, e aí os pills mostram o nível do novo idioma ativo.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/level-selection-ui.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit** (confirmar com o usuário antes)

```bash
git add components/ProfilePreferences.tsx tests/unit/level-selection-ui.test.ts
git commit -m "feat: edit active language level from profile preferences"
```

---

### Task 6: Verificação final

**Files:** nenhum (somente verificação).

- [ ] **Step 1: Typecheck e lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 2: Suite unitária completa**

Run: `npm run test:unit`
Expected: todos os testes passando, incluindo os 10 novos (2 da Task 1, 2 da Task 2, 2 da Task 3, 3 da Task 4 e 1 da Task 5).

- [ ] **Step 3: Verificação manual do fluxo (opcional, com dev server)**

1. `npm run dev`
2. Home → seletor de idioma → escolher idioma + nível diferente → "Usar {idioma}" → home deve mostrar "Nível {escolhido}".
3. Perfil → clicar em outro nível nos pills → "Preferências atualizadas." → home reflete o novo nível.
4. Iniciar conversa no chat e confirmar que o system prompt usa o nível novo (observável via evento/log ou resposta da IA calibrada).
