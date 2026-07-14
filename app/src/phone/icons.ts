// Inline SVG line icons in the Phosphor "thin" aesthetic the Even Hub UI Kit
// uses. Inlined (not loaded from a CDN) so the companion app stays
// self-contained inside the Even WebView, which only allows network access to
// the whitelisted Supabase host. All glyphs inherit `currentColor`.

export type IconName =
  | "translate"
  | "house"
  | "grid"
  | "gear"
  | "list"
  | "magnifying-glass"
  | "caret-left"
  | "caret-right"
  | "caret-down"
  | "plus"
  | "trash"
  | "key"
  | "microphone"
  | "clock"
  | "check";

const PATHS: Record<IconName, string> = {
  // two speech bubbles — the Translate Assist mark
  translate: `<path d="M3.5 5 H11 V11 H6.5 L3.5 14 V5 Z"/><path d="M13 10 H20.5 V16.5 H16 L13 19.5 V10 Z"/>`,
  house: `<path d="M3.5 11.5 L12 4 L20.5 11.5"/><path d="M5.5 10 V20 H18.5 V10"/><path d="M9.5 20 V15 H14.5 V20"/>`,
  grid: `<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>`,
  gear: `<circle cx="12" cy="12" r="3.2"/><path d="M12 3.8 V6.5 M12 17.5 V20.2 M3.8 12 H6.5 M17.5 12 H20.2 M6.2 6.2 L8.1 8.1 M15.9 15.9 L17.8 17.8 M17.8 6.2 L15.9 8.1 M8.1 15.9 L6.2 17.8"/>`,
  list: `<path d="M4 7 H20 M4 12 H20 M4 17 H14"/>`,
  "magnifying-glass": `<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15 L20 20"/>`,
  "caret-left": `<path d="M15 5 L8 12 L15 19"/>`,
  "caret-right": `<path d="M9 5 L16 12 L9 19"/>`,
  "caret-down": `<path d="M5 9 L12 16 L19 9"/>`,
  plus: `<path d="M12 5 V19 M5 12 H19"/>`,
  trash: `<path d="M4 7 H20 M9 7 V5 H15 V7 M6 7 L7 20 H17 L18 7 M10 11 V17 M14 11 V17"/>`,
  key: `<circle cx="8" cy="8" r="3.5"/><path d="M10.5 10.5 L20 20 M14.5 16.5 L16.5 14.5 M17 19 L19 17"/>`,
  microphone: `<rect x="9" y="4" width="6" height="11" rx="3"/><path d="M5 11 a7 7 0 0 0 14 0 M12 18 V21 M9 21 H15"/>`,
  clock: `<circle cx="12" cy="12" r="8"/><path d="M12 8 V12 L15 14"/>`,
  check: `<path d="M5 12.5 L10 17 L19 7"/>`,
};

export function icon(name: IconName, size = 22): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}
