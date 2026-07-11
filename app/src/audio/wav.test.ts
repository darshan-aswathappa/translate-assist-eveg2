import { describe, expect, it } from "vitest";
import { pcmToWav } from "./wav";

function ascii(bytes: Uint8Array, off: number, len: number): string {
  return String.fromCharCode(...bytes.subarray(off, off + len));
}

function u32(bytes: Uint8Array, off: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(off, true);
}

function u16(bytes: Uint8Array, off: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint16(off, true);
}

describe("pcmToWav", () => {
  const pcm = new Uint8Array(3200); // 100 ms of 16 kHz s16le mono
  const wav = pcmToWav(pcm);

  it("writes a canonical 44-byte RIFF/WAVE header", () => {
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(u32(wav, 4)).toBe(36 + pcm.length);
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 12, 4)).toBe("fmt ");
    expect(u32(wav, 16)).toBe(16); // PCM fmt chunk size
    expect(u16(wav, 20)).toBe(1); // audio format: PCM
    expect(u16(wav, 22)).toBe(1); // mono
    expect(u32(wav, 24)).toBe(16_000); // sample rate
    expect(u32(wav, 28)).toBe(32_000); // byte rate
    expect(u16(wav, 32)).toBe(2); // block align
    expect(u16(wav, 34)).toBe(16); // bits per sample
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(u32(wav, 40)).toBe(pcm.length);
  });

  it("appends the PCM payload verbatim", () => {
    const marked = Uint8Array.from([1, 2, 3, 4]);
    const out = pcmToWav(marked);
    expect(out.length).toBe(44 + 4);
    expect([...out.subarray(44)]).toEqual([1, 2, 3, 4]);
  });
});
