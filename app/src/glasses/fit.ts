// Pixel-accurate text fitting using @evenrealities/pretext, which measures with
// the same LVGL glyph advances the firmware uses. The firmware font is NOT
// monospaced, so we measure rather than count characters.
//
// Adapted from the hello-even scaffold's ui/fit.ts.

import { getTextWidth, pxTruncate, measureTextWrap } from "@evenrealities/pretext";

// Truncate a single line to a pixel budget, appending an ellipsis if it doesn't fit.
export function truncate(text: string, maxPx: number): string {
  return pxTruncate(text, maxPx);
}

// Rendered pixel width of a string in the firmware font (non-monospaced).
export function textWidth(text: string): number {
  return getTextWidth(text);
}

// Rendered pixel height of wrapped text at a given inner width, using the same
// per-glyph LVGL line-breaking the firmware uses. Used to keep the rolling
// transcript from overflowing its container vertically.
export function measureHeight(text: string, innerWidth: number): number {
  return measureTextWrap(text, innerWidth).height;
}

// Number of wrapped lines a string occupies at a given inner width.
export function measureLineCount(text: string, innerWidth: number): number {
  return measureTextWrap(text, innerWidth).lineCount;
}

// Clamp a string to a UTF-8 byte budget (list items are capped at ~63 bytes by
// the firmware). Trims whole characters so we never split a multibyte glyph.
const encoder = new TextEncoder();
export function clampBytes(text: string, maxBytes: number): string {
  if (encoder.encode(text).length <= maxBytes) return text;
  let out = text;
  while (out.length > 0 && encoder.encode(out).length > maxBytes) {
    out = out.slice(0, -1);
  }
  return out;
}
