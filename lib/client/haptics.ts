const HAPTICS_ENABLED_KEY = "ai-fluency:haptics-enabled";

// Sem `as const`: navigator.vibrate espera arrays mutáveis (VibratePattern).
const PATTERNS = {
  tap: 15,
  success: [18, 40, 18],
  warn: [30, 50, 30],
  celebrate: [20, 50, 20, 50, 40]
};

export type VibratePatternName = keyof typeof PATTERNS;

export function isHapticsEnabled() {
  try { return window.localStorage.getItem(HAPTICS_ENABLED_KEY) !== "0"; } catch { return true; }
}

export function setHapticsEnabled(value: boolean) {
  try { window.localStorage.setItem(HAPTICS_ENABLED_KEY, value ? "1" : "0"); } catch { /* storage bloqueado */ }
}

export function vibrate(pattern: VibratePatternName) {
  if (!isHapticsEnabled()) return;
  try { navigator.vibrate?.(PATTERNS[pattern]); } catch { /* sem suporte (ex.: iOS) */ }
}
