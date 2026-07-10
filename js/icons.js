// Hand-drawn inline SVG icons for classes. currentColor lets CSS tint them.
const wrap = (paths) =>
  `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;

export const ICONS = {
  warrior: wrap(`
    <path d="M32 6 L38 12 L36 38 L32 44 L28 38 L26 12 Z" fill="currentColor" fill-opacity=".15"/>
    <path d="M20 34 L44 34" />
    <path d="M32 44 L32 56" />
    <path d="M27 51 L37 51" />
    <circle cx="32" cy="22" r="2.4" fill="currentColor"/>
  `),
  mage: wrap(`
    <path d="M32 4 L44 26 L38 26 L46 44 L18 44 L26 26 L20 26 Z" fill="currentColor" fill-opacity=".15"/>
    <path d="M24 52 L40 52" />
    <path d="M32 44 L32 52" />
    <circle cx="32" cy="16" r="3" fill="currentColor" stroke="none">
      <animate attributeName="opacity" values="1;.4;1" dur="2s" repeatCount="indefinite"/>
    </circle>
  `),
  archer: wrap(`
    <path d="M18 10 C 40 18 40 46 18 54" />
    <path d="M18 10 L18 54" stroke-dasharray="2 4"/>
    <path d="M18 32 L52 32" />
    <path d="M44 26 L52 32 L44 38" fill="currentColor" fill-opacity=".15"/>
  `),
  rogue: wrap(`
    <path d="M22 8 L26 34 L32 42 L38 34 L42 8" fill="currentColor" fill-opacity=".15"/>
    <path d="M22 8 C 28 14 36 14 42 8" />
    <path d="M32 42 L32 54" />
    <path d="M26 48 L38 48" />
    <circle cx="27" cy="18" r="1.6" fill="currentColor" stroke="none"/>
    <circle cx="37" cy="18" r="1.6" fill="currentColor" stroke="none"/>
  `),
  priest: wrap(`
    <circle cx="32" cy="14" r="7" fill="currentColor" fill-opacity=".15"/>
    <path d="M32 21 L32 54" />
    <path d="M22 32 L42 32" />
    <path d="M26 48 L38 48" />
    <circle cx="32" cy="14" r="2.2" fill="currentColor" stroke="none">
      <animate attributeName="opacity" values="1;.4;1" dur="2.4s" repeatCount="indefinite"/>
    </circle>
  `),
  monk: wrap(`
    <circle cx="32" cy="30" r="16" fill="currentColor" fill-opacity=".12"/>
    <path d="M32 14 C 40 20 40 28 32 30 C 24 32 24 40 32 46" />
    <circle cx="32" cy="22" r="1.8" fill="currentColor" stroke="none"/>
    <circle cx="32" cy="38" r="1.8" fill="currentColor" stroke="none"/>
    <path d="M20 52 L44 52" />
  `),
};
