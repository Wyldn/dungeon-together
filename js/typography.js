// Narrative typography helpers. Pixel fonts stay on HUD/titles/short labels;
// long choice copy opts into --font-prose via a length threshold, not per-string exceptions.

/** Labels at or above this length (collapsed whitespace) use the readable prose face. */
export const CHOICE_PROSE_MIN_CHARS = 36;

export function isLongChoiceLabel(label) {
  const text = String(label ?? '').replace(/\s+/g, ' ').trim();
  return text.length >= CHOICE_PROSE_MIN_CHARS;
}

export function choiceBtnClass(label, extra = '') {
  return ['choice-btn', isLongChoiceLabel(label) ? 'choice-prose' : '', extra]
    .filter(Boolean).join(' ');
}
