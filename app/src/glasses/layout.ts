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
// Long translations are split into swipeable pages (word boundaries) instead
// of being truncated: swiping walks translation pages first, then cycles the
// suggested replies on the last page. A "caption" view shows the live partial
// transcript while the partner is still speaking.
//
// The firmware wraps text itself; we only budget total characters so the
// content never exceeds the 1000-char initial-container limit.

import type { Suggestion } from "../conversation/thread";

export type HudView =
  | { kind: "status"; label: string }
  | { kind: "caption"; text: string }
  | {
      kind: "result";
      translation: string;
      suggestions: readonly Suggestion[];
      index: number;
      /** Optional state line shown above the translation (e.g. paused), so the
       * wearer sees the mic is off without looking at the phone. */
      banner?: string;
    };

const MAX_TOTAL = 1000;
const MAX_TRANSLATION = 240;
const MAX_LINE = 220;
const MAX_CAPTION = 300;

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(index, 0), count - 1);
}

/** Split text into pages of at most `max` chars, cutting at word boundaries
 * where possible. Always returns at least one page. */
export function splitPages(text: string, max = MAX_TRANSLATION): string[] {
  if (text.length <= max) return [text];
  const pages: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut <= 0) cut = max; // no space (e.g. CJK) — hard cut
    pages.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pages.push(rest);
  return pages;
}

/** Number of swipeable panes for a result: extra translation pages first,
 * then one pane per suggestion (minimum one pane overall). */
export function paneCount(
  translation: string,
  suggestions: readonly Suggestion[],
): number {
  return splitPages(translation).length - 1 + Math.max(suggestions.length, 1);
}

export function hudText(view: HudView): string {
  if (view.kind === "status") return `${view.label}…`;

  if (view.kind === "caption") {
    // Live partial transcript: the tail is the freshest, so clamp the front.
    const text =
      view.text.length <= MAX_CAPTION
        ? view.text
        : `…${view.text.slice(-(MAX_CAPTION - 1))}`;
    return `» ${text}`;
  }

  const pages = splitPages(view.translation);
  const extraPages = pages.length - 1;
  const total = extraPages + Math.max(view.suggestions.length, 1);
  const idx = clampIndex(view.index, total);

  // A state banner (e.g. paused) rides above the translation on every pane.
  const banner = view.banner ? [view.banner, ""] : [];

  // Leading translation pages: page text only, with a page counter.
  if (idx < extraPages) {
    const cont = idx > 0 ? "…" : "";
    return clamp(
      [
        ...banner,
        `"${cont}${pages[idx]}…"`,
        "",
        `[page ${idx + 1}/${pages.length}]`,
        "",
        "<swipe for more>",
      ].join("\n"),
      MAX_TOTAL,
    );
  }

  // Last translation page + one suggestion.
  const sIdx = idx - extraPages;
  const s = view.suggestions[sIdx];
  const pageText = pages[pages.length - 1];
  const shown = extraPages > 0 ? `…${pageText}` : pageText;

  const lines: string[] = [...banner, `"${clamp(shown, MAX_TRANSLATION + 1)}"`, ""];
  if (extraPages > 0) {
    lines.push(`[page ${pages.length}/${pages.length}]`);
  }
  if (s) {
    lines.push(`[${sIdx + 1}/${view.suggestions.length}]`);
    lines.push(clamp(s.native, MAX_LINE));
    if (s.roman) lines.push(clamp(s.roman, MAX_LINE));
    if (s.gloss) lines.push(`(${clamp(s.gloss, MAX_LINE)})`);
  }
  if (total > 1) {
    lines.push("", "<swipe for more>");
  }
  return clamp(lines.join("\n"), MAX_TOTAL);
}
