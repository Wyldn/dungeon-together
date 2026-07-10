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
  warlock: wrap(`
    <path d="M32 8 L36 20 L48 20 L38 28 L42 42 L32 34 L22 42 L26 28 L16 20 L28 20 Z" fill="currentColor" fill-opacity=".14"/>
    <circle cx="32" cy="24" r="3" fill="currentColor" stroke="none">
      <animate attributeName="opacity" values="1;.3;1" dur="1.8s" repeatCount="indefinite"/>
    </circle>
    <path d="M32 42 L32 54" />
    <path d="M25 50 C 28 47 36 47 39 50" />
  `),
  bard: wrap(`
    <path d="M24 44 C 18 44 16 38 20 34 C 24 30 30 32 30 38 L30 16 L44 12 L44 34" fill="currentColor" fill-opacity=".12"/>
    <circle cx="24" cy="40" r="5.5" fill="currentColor" fill-opacity=".2"/>
    <circle cx="38" cy="36" r="5.5" fill="currentColor" fill-opacity=".2"/>
    <path d="M30 16 L44 12" />
  `),
  necromancer: wrap(`
    <circle cx="32" cy="22" r="10" fill="currentColor" fill-opacity=".14"/>
    <circle cx="28" cy="20" r="2" fill="currentColor" stroke="none"/>
    <circle cx="36" cy="20" r="2" fill="currentColor" stroke="none"/>
    <path d="M28 28 L36 28" />
    <path d="M32 32 L32 50" />
    <path d="M22 40 L42 40" />
    <path d="M20 54 L44 54" stroke-dasharray="3 3"/>
  `),
};
