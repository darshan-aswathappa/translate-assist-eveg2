// Energy-based utterance segmentation for the Whisper pipeline. Whisper is a
// chunk (REST) API, not a streaming one, so the app must decide where an
// utterance ends. PCM frames (s16le 16 kHz mono, from audio/capture) are
// bucketed into fixed 20 ms analysis windows; a simple RMS gate with hysteresis
// marks speech, and an utterance is emitted after `silenceMs` of trailing quiet
// (or when `maxUtteranceMs` is reached mid-speech).
//
// The segmenter buffers raw bytes and emits a single concatenated Uint8Array
// per utterance, including `prerollMs` of audio from just before speech onset
// so soft first syllables aren't clipped.

export interface SegmenterOptions {
  onUtterance: (pcm: Uint8Array) => void;
  /** RMS threshold (s16 sample units) above which a window counts as speech. */
  threshold?: number;
  /** Trailing quiet that ends an utterance. */
  silenceMs?: number;
  /** Speech shorter than this is discarded as a blip. */
  minSpeechMs?: number;
  /** Force-emit if continuous speech exceeds this. */
  maxUtteranceMs?: number;
  /** Audio kept from before speech onset. */
  prerollMs?: number;
}

export interface UtteranceSegmenter {
  /** Feed a PCM frame (any length); windows are re-bucketed internally. */
  push: (frame: Uint8Array) => void;
  /** Emit any pending speech now (e.g. when the user pauses the mic). */
  flush: () => void;
}

const SAMPLE_RATE = 16_000;
const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000; // 32
const WINDOW_MS = 20;
const WINDOW_BYTES = WINDOW_MS * BYTES_PER_MS;

export function frameRms(frame: Uint8Array): number {
  const samples = frame.length >> 1;
  if (samples === 0) return 0;
  const view = new DataView(frame.buffer, frame.byteOffset, samples * 2);
  let sumSq = 0;
  for (let i = 0; i < samples; i++) {
    const s = view.getInt16(i * 2, true);
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / samples);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export function createUtteranceSegmenter(opts: SegmenterOptions): UtteranceSegmenter {
  const threshold = opts.threshold ?? 500;
  const silenceMs = opts.silenceMs ?? 700;
  const minSpeechMs = opts.minSpeechMs ?? 250;
  const maxUtteranceMs = opts.maxUtteranceMs ?? 15_000;
  const prerollMs = opts.prerollMs ?? 300;

  // Re-bucketing buffer: bytes not yet forming a full analysis window.
  let pending = new Uint8Array(0);

  // Ring of recent quiet windows kept for pre-roll.
  const preroll: Uint8Array[] = [];
  const prerollWindows = Math.ceil(prerollMs / WINDOW_MS);

  // Current utterance under construction.
  let speech: Uint8Array[] = [];
  let inSpeech = false;
  let speechMs = 0; // total utterance length (loud + embedded quiet)
  let loudMs = 0; // loud windows only — the "was this real speech?" measure
  let quietMs = 0;

  function reset(): void {
    speech = [];
    inSpeech = false;
    speechMs = 0;
    loudMs = 0;
    quietMs = 0;
  }

  function emit(): void {
    if (loudMs >= minSpeechMs && speech.length > 0) {
      opts.onUtterance(concat(speech));
    }
    reset();
  }

  function handleWindow(win: Uint8Array): void {
    const loud = frameRms(win) >= threshold;

    if (!inSpeech) {
      if (loud) {
        inSpeech = true;
        speech = [...preroll, win];
        preroll.length = 0;
        speechMs = WINDOW_MS;
        loudMs = WINDOW_MS;
        quietMs = 0;
      } else {
        preroll.push(win);
        if (preroll.length > prerollWindows) preroll.shift();
      }
      return;
    }

    speech.push(win);
    speechMs += WINDOW_MS;
    if (loud) loudMs += WINDOW_MS;
    quietMs = loud ? 0 : quietMs + WINDOW_MS;

    if (quietMs >= silenceMs || speechMs >= maxUtteranceMs) emit();
  }

  return {
    push(frame) {
      if (frame.length === 0) return;
      let buf: Uint8Array;
      if (pending.length > 0) {
        buf = concat([pending, frame]);
        pending = new Uint8Array(0);
      } else {
        buf = frame;
      }
      let off = 0;
      while (buf.length - off >= WINDOW_BYTES) {
        // Copy so a reused capture buffer can't mutate emitted audio.
        handleWindow(buf.slice(off, off + WINDOW_BYTES));
        off += WINDOW_BYTES;
      }
      if (off < buf.length) pending = buf.slice(off);
    },
    flush() {
      if (inSpeech) emit();
    },
  };
}
