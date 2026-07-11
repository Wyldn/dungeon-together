// The Monolith of Measure — a faceted crystal that fills on press-and-hold.
// Flavor-only: reaching full charge fires onComplete(); the game reveals a
// deliberately WIDE potential band, never the true (hidden) stats. (handoff §3)

export function mountCrystal(canvas, { onComplete } = {}) {
  const ctx = canvas.getContext('2d');
  const W = 320, H = 400;
  canvas.width = W * 2; canvas.height = H * 2;
  ctx.setTransform(2, 0, 0, 2, 0, 0);

  let charge = 0;
  let holding = false;
  let done = false;
  let raf = 0;

  const accent = '#4fd6c0', accent2 = '#9b6cff';

  function draw(t) {
    raf = requestAnimationFrame(draw);
    if (holding && !done) charge = Math.min(100, charge + 0.9);
    else if (!done) charge = Math.max(0, charge - 1.6);
    if (charge >= 100 && !done && holding) {
      done = true; charge = 100;
      onComplete && onComplete();
    }

    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, top = 54, bot = 360, mid = 192, hw = 90;

    // faceted core
    ctx.beginPath();
    ctx.moveTo(cx, top); ctx.lineTo(cx + hw, mid); ctx.lineTo(cx, bot); ctx.lineTo(cx - hw, mid); ctx.closePath();
    ctx.fillStyle = 'rgba(24,20,46,.55)'; ctx.fill();

    ctx.save(); ctx.clip();
    const fillTop = bot - (bot - top) * (charge / 100);
    const g = ctx.createLinearGradient(0, bot, 0, top);
    g.addColorStop(0, accent); g.addColorStop(.55, accent2); g.addColorStop(1, 'rgba(255,255,255,.1)');
    ctx.globalAlpha = .82; ctx.fillStyle = g; ctx.fillRect(cx - hw, fillTop, hw * 2, bot - fillTop);
    // rising sparkles
    if (charge > 1) {
      ctx.globalAlpha = .9; ctx.fillStyle = '#fff';
      for (let i = 0; i < 12; i++) {
        const sy = bot - ((t * .06 + i * 44) % (bot - top + 40));
        if (sy < fillTop) continue;
        const sx = cx + Math.sin(t * .003 + i) * hw * .5;
        ctx.beginPath(); ctx.arc(sx, sy, 1.6, 0, 6.29); ctx.fill();
      }
    }
    ctx.restore();

    // facet lines
    ctx.globalAlpha = .5; ctx.strokeStyle = accent; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, bot); ctx.moveTo(cx - hw, mid); ctx.lineTo(cx + hw, mid); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - hw * .5, (top + mid) / 2); ctx.lineTo(cx + hw * .5, (top + mid) / 2); ctx.stroke();

    // pulsing outline
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(cx, top); ctx.lineTo(cx + hw, mid); ctx.lineTo(cx, bot); ctx.lineTo(cx - hw, mid); ctx.closePath();
    const charging = holding && !done;
    const pulse = charging ? .7 + .3 * Math.sin(t * .02) : .5 + .5 * Math.sin(t * .004);
    ctx.lineWidth = 2.4; ctx.strokeStyle = accent; ctx.shadowColor = accent; ctx.shadowBlur = 30 * pulse;
    ctx.stroke(); ctx.shadowBlur = 0;
  }
  raf = requestAnimationFrame(draw);

  const start = () => { if (!done) holding = true; };
  const end = () => { holding = false; };
  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointerleave', end);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', start);
      canvas.removeEventListener('pointerup', end);
      canvas.removeEventListener('pointerleave', end);
    },
    isDone: () => done,
  };
}
