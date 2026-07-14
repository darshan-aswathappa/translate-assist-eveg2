import { describe, expect, it } from "vitest";
import { createSpeechGate, createUtteranceSegmenter, frameRms } from "./vad";

// Synthetic PCM helpers: s16le mono @ 16 kHz. `ms` of samples at a constant
// absolute amplitude (alternating sign so it's a crude square wave, not DC).
function pcm(ms: number, amplitude: number): Uint8Array {
  const samples = Math.round((16_000 * ms) / 1000);
  const bytes = new Uint8Array(samples * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples; i++) {
    view.setInt16(i * 2, i % 2 === 0 ? amplitude : -amplitude, true);
  }
  return bytes;
}

const LOUD = 8000;
const QUIET = 50;

// Feed audio to a segmenter/gate in 100 ms frames, the way capture delivers it.
function feed(seg: { push: (frame: Uint8Array) => void }, chunks: Uint8Array[]) {
  for (const chunk of chunks) {
    for (let off = 0; off < chunk.length; off += 3200) {
      seg.push(chunk.subarray(off, Math.min(off + 3200, chunk.length)));
    }
  }
}

describe("frameRms", () => {
  it("is ~0 for silence and ~amplitude for a square wave", () => {
    expect(frameRms(pcm(100, 0))).toBe(0);
    expect(frameRms(pcm(100, LOUD))).toBeCloseTo(LOUD, -1);
  });

  it("is 0 for an empty frame", () => {
    expect(frameRms(new Uint8Array(0))).toBe(0);
  });
});

describe("createUtteranceSegmenter", () => {
  it("emits one utterance for speech followed by silence", () => {
    const out: Uint8Array[] = [];
    const seg = createUtteranceSegmenter({ onUtterance: (u) => out.push(u) });
    feed(seg, [pcm(1000, LOUD), pcm(1000, QUIET)]);
    expect(out).toHaveLength(1);
    // ~1 s of speech plus some hangover silence, in bytes (32 bytes/ms).
    expect(out[0].length).toBeGreaterThan(900 * 32);
  });

  it("emits nothing for silence only", () => {
    const out: Uint8Array[] = [];
    const seg = createUtteranceSegmenter({ onUtterance: (u) => out.push(u) });
    feed(seg, [pcm(3000, QUIET)]);
    expect(out).toHaveLength(0);
  });

  it("ignores blips shorter than the minimum speech duration", () => {
    const out: Uint8Array[] = [];
    const seg = createUtteranceSegmenter({ onUtterance: (u) => out.push(u) });
    feed(seg, [pcm(100, LOUD), pcm(2000, QUIET)]);
    expect(out).toHaveLength(0);
  });

  it("splits two utterances separated by a long pause", () => {
    const out: Uint8Array[] = [];
    const seg = createUtteranceSegmenter({ onUtterance: (u) => out.push(u) });
    feed(seg, [pcm(800, LOUD), pcm(1200, QUIET), pcm(800, LOUD), pcm(1200, QUIET)]);
    expect(out).toHaveLength(2);
  });

  it("does not split on a short mid-utterance pause", () => {
    const out: Uint8Array[] = [];
    const seg = createUtteranceSegmenter({ onUtterance: (u) => out.push(u) });
    feed(seg, [pcm(600, LOUD), pcm(300, QUIET), pcm(600, LOUD), pcm(1200, QUIET)]);
    expect(out).toHaveLength(1);
  });

  it("force-flushes an utterance that hits the max duration", () => {
    const out: Uint8Array[] = [];
    const seg = createUtteranceSegmenter({
      maxUtteranceMs: 2000,
      onUtterance: (u) => out.push(u),
    });
    feed(seg, [pcm(5000, LOUD)]);
    expect(out.length).toBeGreaterThanOrEqual(2);
  });

  it("flush() emits pending speech immediately", () => {
    const out: Uint8Array[] = [];
    const seg = createUtteranceSegmenter({ onUtterance: (u) => out.push(u) });
    feed(seg, [pcm(1000, LOUD)]);
    expect(out).toHaveLength(0); // no trailing silence yet
    seg.flush();
    expect(out).toHaveLength(1);
  });

  it("includes pre-roll audio from just before speech onset", () => {
    const out: Uint8Array[] = [];
    const seg = createUtteranceSegmenter({ onUtterance: (u) => out.push(u) });
    feed(seg, [pcm(1000, QUIET), pcm(1000, LOUD), pcm(1000, QUIET)]);
    expect(out).toHaveLength(1);
    // Utterance should carry ~300 ms of pre-roll beyond the 1 s of speech.
    expect(out[0].length).toBeGreaterThan(1000 * 32);
  });

  it("splits a long monologue at a short natural pause after softSplitAfterMs", () => {
    const out: Uint8Array[] = [];
    const seg = createUtteranceSegmenter({ onUtterance: (u) => out.push(u) });
    // 9 s of speech, a 400 ms breath (shorter than the normal 700 ms silence
    // window but past the 8 s soft-split point), then more speech.
    feed(seg, [pcm(9000, LOUD), pcm(400, QUIET), pcm(1000, LOUD), pcm(1200, QUIET)]);
    expect(out).toHaveLength(2);
    // First utterance is the 9 s monologue, split at the breath — not at a cap.
    expect(out[0].length).toBeGreaterThan(8900 * 32);
    expect(out[0].length).toBeLessThan(9600 * 32);
  });

  it("does not soft-split early speech on a short pause", () => {
    const out: Uint8Array[] = [];
    const seg = createUtteranceSegmenter({ onUtterance: (u) => out.push(u) });
    // Same 400 ms pause, but only 2 s in — stays one utterance.
    feed(seg, [pcm(2000, LOUD), pcm(400, QUIET), pcm(1000, LOUD), pcm(1200, QUIET)]);
    expect(out).toHaveLength(1);
  });

  it("splits a 30s+ monologue at natural breath pauses instead of the hard cap", () => {
    const out: Uint8Array[] = [];
    const seg = createUtteranceSegmenter({ onUtterance: (u) => out.push(u) });
    // Three ~10 s clauses separated by 400 ms breaths — each clause is past the
    // 8 s soft-split point, so every breath becomes an utterance boundary.
    feed(seg, [
      pcm(10_000, LOUD),
      pcm(400, QUIET),
      pcm(10_000, LOUD),
      pcm(400, QUIET),
      pcm(10_000, LOUD),
      pcm(1200, QUIET),
    ]);
    expect(out).toHaveLength(3);
    for (const u of out) {
      // Each clause is ~10 s of audio — well under the 30 s hard cap.
      expect(u.length).toBeGreaterThan(9_000 * 32);
      expect(u.length).toBeLessThan(11_500 * 32);
    }
  });
});

describe("createSpeechGate", () => {
  function totalBytes(frames: Uint8Array[]): number {
    return frames.reduce((n, f) => n + f.length, 0);
  }

  it("transmits nothing for silence", () => {
    const sent: Uint8Array[] = [];
    const gate = createSpeechGate({ onAudio: (f) => sent.push(f) });
    feed(gate, [pcm(2000, QUIET)]);
    expect(sent).toHaveLength(0);
    expect(gate.isOpen()).toBe(false);
  });

  it("transmits pre-roll + speech + hangover, then closes the gate", () => {
    const sent: Uint8Array[] = [];
    let closed = 0;
    const gate = createSpeechGate({
      onAudio: (f) => sent.push(f),
      onGateClose: () => closed++,
    });
    feed(gate, [pcm(1000, QUIET), pcm(1000, LOUD), pcm(2000, QUIET)]);
    expect(closed).toBe(1);
    expect(gate.isOpen()).toBe(false);
    // ~300 ms pre-roll + 1000 ms speech + 1200 ms hangover ≈ 2500 ms of audio.
    expect(totalBytes(sent)).toBeGreaterThan(2300 * 32);
    expect(totalBytes(sent)).toBeLessThan(2700 * 32);
  });

  it("stays open across pauses shorter than the hangover", () => {
    const sent: Uint8Array[] = [];
    let closed = 0;
    const gate = createSpeechGate({
      onAudio: (f) => sent.push(f),
      onGateClose: () => closed++,
    });
    feed(gate, [pcm(500, LOUD), pcm(800, QUIET), pcm(500, LOUD)]);
    expect(closed).toBe(0);
    expect(gate.isOpen()).toBe(true);
  });
});
