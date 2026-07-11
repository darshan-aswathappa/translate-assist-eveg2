// Pure HUD text composition for the single full-screen text container, matching
// the product mockup:
//
//   "Do you speak English?"          ← their words, translated
//
//   [2/3]                            ← suggestion counter
//   すみません、あまり得意ではありません。   ← reply in their language
//   Sumimasen, amari tokui dewa arimasen.
//   (Sorry, I'm not very good at it.)
//
//   <swipe for more>
//
// The firmware wraps text itself; we only budget total characters so the
// content never exceeds the 1000-char initial-container limit.

import type { Suggestion } from "../conversation/thread";

export type HudView =
  | { kind: "status"; label: string }
  | {
      kind: "result";
      translation: string;
      suggestions: readonly Suggestion[];
      index: number;
    };

const MAX_TOTAL = 1000;
const MAX_TRANSLATION = 240;
const MAX_LINE = 220;

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(index, 0), count - 1);
}

export function hudText(view: HudView): string {
  if (view.kind === "status") return `${view.label}…`;

  const idx = clampIndex(view.index, view.suggestions.length);
  const s = view.suggestions[idx];

  const lines: string[] = [`"${clamp(view.translation, MAX_TRANSLATION)}"`, ""];
  if (s) {
    lines.push(`[${idx + 1}/${view.suggestions.length}]`);
    lines.push(clamp(s.native, MAX_LINE));
    if (s.roman) lines.push(clamp(s.roman, MAX_LINE));
    if (s.gloss) lines.push(`(${clamp(s.gloss, MAX_LINE)})`);
  }
  if (view.suggestions.length > 1) {
    lines.push("", "<swipe for more>");
  }
  return clamp(lines.join("\n"), MAX_TOTAL);
}
