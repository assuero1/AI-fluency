# Design Tokens

These tokens translate the visual references into implementation rules. They are intentionally practical rather than final brand guidelines.

## Visual Direction

Use the design from `assets/screens`:

- white background,
- friendly Duolingo-like energy,
- green primary actions,
- black typography,
- pastel circular icon backgrounds,
- rounded outline buttons,
- light dividers,
- spacious mobile layout.

## Navigation

Bottom navigation labels:

1. Inicio
2. Chat
3. Palavras
4. Calendario
5. Perfil

Rules:

- Use the same nav on every main screen.
- Chat screen highlights `Chat`, not `Conversa`.
- Progresso is not a bottom nav item.
- Progresso is an internal screen accessed from Inicio, Calendario, or Perfil.

## Color Tokens

```css
:root {
  --color-bg: #ffffff;
  --color-text: #1f1f1f;
  --color-muted: #666666;
  --color-line: #e5e5e5;
  --color-primary: #2f9d4a;
  --color-primary-soft: #e7f5e9;
  --color-warning: #e6a400;
  --color-warning-soft: #fff3cf;
  --color-info: #2f7edb;
  --color-info-soft: #e7f1ff;
  --color-danger: #ef6b57;
  --color-danger-soft: #ffe9e5;
  --color-cta-dark: #111111;
}
```

## Type Scale

Mobile-first defaults:

- Screen title: 28-32px, bold.
- Section title: 18-22px, bold.
- Body: 16px.
- Supporting text: 14px.
- Nav label: 12-13px.
- Metric number: 32-42px, bold.

Rules:

- Keep text readable on mobile.
- Avoid tiny explanatory text.
- Do not use viewport-scaled font sizes.
- Do not let Portuguese labels overflow controls.

## Radius

- Large cards: 22-28px.
- Buttons: 16-22px.
- Input cards: 22-28px.
- Icon circles: 50%.
- Bottom nav active icon shape can be rounded/pill.

## Spacing

- Screen horizontal padding: 22-24px.
- Section gap: 28-36px.
- Row vertical padding: 16-20px.
- Card internal padding: 18-24px.
- Bottom safe area: respect mobile safe-area inset.

## Components

Required shared components:

- `AppShell`
- `BottomNav`
- `ScreenHeader`
- `LanguageLevelBar`
- `TopicInputCard`
- `SuggestionRow`
- `MetricSummary`
- `WordSummary`
- `ChatTopicCard`
- `ChatBubble`
- `AudioPlayer`
- `CorrectionBlock`
- `SavedWordsBar`
- `QuickActionButton`
- `CalendarGrid`
- `SettingsRow`
- `ConnectionStatusBadge`

## Screen References

- Onboarding: `assets/screens/01-onboarding-idioma.png`
- Inicio: `assets/screens/02-inicio-tema.png`
- Chat: `assets/screens/03-chat-conversa.png`
- Palavras: `assets/screens/04-palavras-vocabulario.png`
- Calendario: `assets/screens/05-calendario-feedback.png`
- Progresso: `assets/screens/06-progresso.png`
- Perfil: `assets/screens/07-perfil-preferencias.png`
- Resumo: `assets/screens/08-resumo-pos-conversa.png`

## Acceptance Rules

- UI must be checked against the reference image for each screen.
- Bottom nav must be corrected everywhere.
- No new visual theme should be introduced.
- No dense dashboard styling.
- No marketing-style landing page.
- The first screen after onboarding is the actual app home.
