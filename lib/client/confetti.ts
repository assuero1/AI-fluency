const PALETTE = ["#2f9d4a", "#58cc02", "#f7c948", "#1f7a33", "#8fd6a0"];

export function burstConfetti(options: { particles?: number; originY?: number } = {}) {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = document.createElement("canvas");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "9999" } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(canvas);
    const context = canvas.getContext("2d");
    if (!context) { canvas.remove(); return; }
    context.scale(dpr, dpr);

    const count = Math.max(20, Math.min(180, options.particles ?? 90));
    const originY = options.originY ?? window.innerHeight * 0.28;
    const particles = Array.from({ length: count }, () => ({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 120,
      y: originY,
      vx: (Math.random() - 0.5) * 9,
      vy: -(4 + Math.random() * 7),
      size: 5 + Math.random() * 6,
      rotation: Math.random() * Math.PI,
      speed: 0.15 + Math.random() * 0.25,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)]
    }));

    const startedAt = performance.now();
    const frame = (now: number) => {
      const elapsed = now - startedAt;
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const particle of particles) {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += 0.22 * particle.speed * 2;
        particle.rotation += 0.08;
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.globalAlpha = Math.max(0, 1 - elapsed / 1800);
        context.fillStyle = particle.color;
        context.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 0.6);
        context.restore();
      }
      if (elapsed < 1900) requestAnimationFrame(frame);
      else canvas.remove();
    };
    requestAnimationFrame(frame);
  } catch {
    // Confetti é cosmético: falha não pode interromper a celebração.
  }
}
