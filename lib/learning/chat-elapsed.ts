export function computeActiveElapsedSeconds(startedAt: string, pausedMs = 0, now: number = Date.now()) {
  const startedMs = new Date(startedAt).getTime();
  if (Number.isNaN(startedMs)) return 0;
  return Math.max(0, Math.floor((now - startedMs - Math.max(0, pausedMs)) / 1000));
}

export function clampPausedMs(pausedMs: unknown, startedAt: string, now: number = Date.now()) {
  const startedMs = new Date(startedAt).getTime();
  const elapsedMs = Number.isNaN(startedMs) ? 0 : Math.max(0, now - startedMs);
  const value = typeof pausedMs === "number" && Number.isFinite(pausedMs) ? pausedMs : 0;
  return Math.min(Math.max(0, Math.round(value)), elapsedMs);
}
