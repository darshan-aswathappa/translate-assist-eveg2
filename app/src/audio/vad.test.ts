import { describe, expect, it } from "vitest";
import { createUtteranceSegmenter, frameRms } from "./vad";

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

// Feed audio to a segmenter in 100 ms frames, the way capture delivers it.
function feed(seg: ReturnType<typeof createUtteranceSegmenter>, chunks: Uint8Array[]) {
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
});
