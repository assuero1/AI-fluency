let ctx: AudioContext | null = null;

/** Clique suave de confirmação (~80ms, volume baixo) para ações do usuário. */
export function playButtonSound() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    ctx ??= new Ctx();
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.08);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.1);
  } catch {
    // Som é cosmético: qualquer falha (ex.: AudioContext bloqueado) é silenciosa.
  }
}
