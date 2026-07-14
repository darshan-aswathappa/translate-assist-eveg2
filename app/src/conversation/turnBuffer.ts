// Accumulates finalized transcription segments into one turn. With
// ring-controlled turns the wearer decides when a turn ends (a ring tap), so
// however Deepgram fragments the speech — and the multilingual model's short
// endpointing fragments it a lot — the pieces just collect here until the tap
// flushes them as a single utterance for translation.

import type { LiveSegment } from "../api/deepgramLive";

export interface TurnBuffer {
  append: (segment: LiveSegment) => void;
  /** All buffered text joined in arrival order. */
  text: () => string;
  /** Majority language across buffered segments; empty string when unknown. */
  language: () => string;
  isEmpty: () => boolean;
  clear: () => void;
}

export function createTurnBuffer(): TurnBuffer {
  let pieces: string[] = [];
  let languages: string[] = [];

  return {
    append(segment) {
      const text = segment.text.trim();
      if (!text) return;
      pieces = [...pieces, text];
      if (segment.language) languages = [...languages, segment.language];
    },
    text() {
      return pieces.join(" ").trim();
    },
    language() {
      const counts = new Map<string, number>();
      for (const lang of languages) counts.set(lang, (counts.get(lang) ?? 0) + 1);
      let best = "";
      let bestCount = 0;
      for (const [lang, count] of counts) {
        if (count > bestCount) {
          best = lang;
          bestCount = count;
        }
      }
      return best;
    },
    isEmpty() {
      return pieces.length === 0;
    },
    clear() {
      pieces = [];
      languages = [];
    },
  };
}
