// Small DOM helpers shared across screens.

export const app = document.getElementById('app');

// Overlays mount inside the scaled 1280x720 #frame so they scale/letterbox
// with everything else (fall back to body if the frame isn't present).
const overlayHost = () => document.getElementById('frame') || document.body;

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(msg, cls = '') {
  const layer = document.getElementById('toast-layer');
  const t = el(`<div class="toast ${cls}">${msg}</div>`);
  layer.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// Modal that resolves when a [data-close] button is clicked (value = dataset.close),
// or when caller resolves manually via returned api.
export function modal(innerHtml, { dismissible = false } = {}) {
  return new Promise(resolve => {
    const backdrop = el(`<div class="modal-backdrop"><div class="modal panel">${innerHtml}</div></div>`);
    overlayHost().appendChild(backdrop);
    const close = value => { backdrop.remove(); resolve(value); };
    backdrop.querySelectorAll('[data-close]').forEach(btn =>
      btn.addEventListener('click', () => close(btn.dataset.close)));
    if (dismissible) backdrop.addEventListener('click', e => { if (e.target === backdrop) close(null); });
    backdrop._close = close;
  });
}

// Like modal() but gives the builder access to close()
export function modalCustom(build) {
  return new Promise(resolve => {
    const backdrop = el(`<div class="modal-backdrop"><div class="modal panel"></div></div>`);
    overlayHost().appendChild(backdrop);
    const close = value => { backdrop.remove(); resolve(value); };
    build(backdrop.querySelector('.modal'), close);
  });
}

export function bar(cls, cur, max, label) {
  const pct = Math.max(0, Math.min(100, (cur / max) * 100));
  return `<div class="bar"><div class="bar-fill ${cls}" style="width:${pct}%"></div>
    <div class="bar-label"><span>${label}</span><span>${Math.round(cur)}/${Math.round(max)}</span></div></div>`;
}

export function rarityClass(r) { return `rarity-${r || 'common'}`; }

export function fmtEffects(item) {
  return item.desc || '';
}
