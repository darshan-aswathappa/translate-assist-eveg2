// Energy-based voice activity detection. PCM frames (s16le 16 kHz mono, from
// audio/capture) are bucketed into fixed 20 ms analysis windows and gated on
// RMS. Two consumers:
//
//   createUtteranceSegmenter — buffers whole utterances for the batch
//   (pre-recorded REST) transcription path. An utterance ends after `silenceMs`
//   of trailing quiet; long monologues split early at natural pauses (after
//   `softSplitAfterMs` of speech a much shorter `softSilenceMs` pause is
//   enough) so speech is never cut mid-word by the `maxUtteranceMs` cap.
//
//   createSpeechGate — a transmit gate for the live streaming path: forwards
//   audio (with pre-roll) only while in/near speech, so silence isn't streamed,
//   and reports when the gate closes so the caller can finalize/keepalive.

export interface SegmenterOptions {
  onUtterance: (pcm: Uint8Array) => void;
  /** RMS threshold (s16 sample units) above which a window counts as speech. */
  threshold?: number;
  /** Trailing quiet that ends an utterance. */
  silenceMs?: number;
  /** Speech shorter than this is discarded as a blip. */
  minSpeechMs?: number;
  /** Force-emit if continuous speech exceeds this (hard safety cap). */
  maxUtteranceMs?: number;
  /** After this much continuous speech, `softSilenceMs` of quiet is enough to
   * split — long monologues break at breaths instead of the hard cap. */
  softSplitAfterMs?: number;
  /** Shorter pause that ends an utterance once past `softSplitAfterMs`. */
  softSilenceMs?: number;
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

// Shared re-bucketing: feed arbitrary-length frames, receive fixed 20 ms
// windows. Windows are copied so a reused capture buffer can't mutate them.
function createWindower(handleWindow: (win: Uint8Array) => void) {
  let pending = new Uint8Array(0);
  return (frame: Uint8Array): void => {
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
      handleWindow(buf.slice(off, off + WINDOW_BYTES));
      off += WINDOW_BYTES;
    }
    if (off < buf.length) pending = buf.slice(off);
  };
}

export function createUtteranceSegmenter(opts: SegmenterOptions): UtteranceSegmenter {
  const threshold = opts.threshold ?? 500;
  const silenceMs = opts.silenceMs ?? 700;
  const minSpeechMs = opts.minSpeechMs ?? 250;
  const maxUtteranceMs = opts.maxUtteranceMs ?? 30_000;
  const softSplitAfterMs = opts.softSplitAfterMs ?? 8_000;
  const softSilenceMs = opts.softSilenceMs ?? 300;
  const prerollMs = opts.prerollMs ?? 300;

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

    // Once a monologue runs long, split at the next natural pause instead of
    // waiting for the full silence window (or worse, the hard cap mid-word).
    const effectiveSilence = speechMs >= softSplitAfterMs ? softSilenceMs : silenceMs;
    if (quietMs >= effectiveSilence || speechMs >= maxUtteranceMs) emit();
  }

  const push = createWindower(handleWindow);

  return {
    push,
    flush() {
      if (inSpeech) emit();
    },
  };
}

// ─── Speech gate (streaming transmit gate) ───────────────────────────────────

export interface SpeechGateOptions {
  /** Receives audio to transmit: pre-roll + speech + hangover silence. */
  onAudio: (frame: Uint8Array) => void;
  /** The hangover elapsed after speech — the caller can finalize the stream. */
  onGateClose?: () => void;
  /** RMS threshold (s16 sample units) above which a window counts as speech. */
  threshold?: number;
  /** Silence transmitted after speech before the gate closes. Must comfortably
   * exceed the streaming endpointer's silence window so end-of-utterance is
   * detected from real audio before we stop sending. */
  hangoverMs?: number;
  /** Audio kept from before speech onset. */
  prerollMs?: number;
}

export interface SpeechGate {
  /** Feed a PCM frame (any length); windows are re-bucketed internally. */
  push: (frame: Uint8Array) => void;
  /** Whether the gate is currently transmitting. */
  isOpen: () => boolean;
}

export function createSpeechGate(opts: SpeechGateOptions): SpeechGate {
  const threshold = opts.threshold ?? 500;
  const hangoverMs = opts.hangoverMs ?? 1_200;
  const prerollMs = opts.prerollMs ?? 300;

  const preroll: Uint8Array[] = [];
  const prerollWindows = Math.ceil(prerollMs / WINDOW_MS);

  let open = false;
  let quietMs = 0;

  function handleWindow(win: Uint8Array): void {
    const loud = frameRms(win) >= threshold;

    if (!open) {
      if (loud) {
        open = true;
        quietMs = 0;
        for (const p of preroll) opts.onAudio(p);
        preroll.length = 0;
        opts.onAudio(win);
      } else {
        preroll.push(win);
        if (preroll.length > prerollWindows) preroll.shift();
      }
      return;
    }

    opts.onAudio(win);
    quietMs = loud ? 0 : quietMs + WINDOW_MS;
    if (quietMs >= hangoverMs) {
      open = false;
      quietMs = 0;
      opts.onGateClose?.();
    }
  }

  const push = createWindower(handleWindow);

  return { push, isOpen: () => open };
}
