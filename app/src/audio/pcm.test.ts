import { describe, it, expect } from "vitest";
import { toPcmBytes, bytesToBase64, base64ToBytes } from "./pcm";

describe("toPcmBytes", () => {
  it("passes through a Uint8Array unchanged", () => {
    const u = new Uint8Array([1, 2, 3]);
    expect(toPcmBytes(u)).toBe(u);
  });

  it("converts a number[] of byte values", () => {
    expect(Array.from(toPcmBytes([0, 255, 128]))).toEqual([0, 255, 128]);
  });

  it("wraps an ArrayBuffer", () => {
    const buf = new Uint8Array([4, 5]).buffer;
    expect(Array.from(toPcmBytes(buf))).toEqual([4, 5]);
  });

  it("decodes a base64 string", () => {
    const b64 = bytesToBase64(new Uint8Array([10, 20, 30]));
    expect(Array.from(toPcmBytes(b64))).toEqual([10, 20, 30]);
  });

  it("returns empty bytes for unknown payloads", () => {
    expect(toPcmBytes(null).length).toBe(0);
    expect(toPcmBytes(undefined).length).toBe(0);
    expect(toPcmBytes({}).length).toBe(0);
  });
});

describe("base64 round-trip", () => {
  it("encodes and decodes back to the same bytes", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual([0, 1, 127, 128, 255]);
  });
});
