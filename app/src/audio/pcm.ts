// The bridge delivers mic audio as `event.audioEvent.audioPcm`. Over the
// JSON bridge that value can arrive in several shapes (the SDK types it as
// Uint8Array, but the host may serialize Uint8List as a number[] or a base64
// string). Normalize all of them to a single Uint8Array of raw PCM bytes:
// 16 kHz, signed 16-bit little-endian, mono.

export function toPcmBytes(audioPcm: unknown): Uint8Array {
  if (audioPcm instanceof Uint8Array) return audioPcm;

  if (audioPcm instanceof ArrayBuffer) return new Uint8Array(audioPcm);

  if (Array.isArray(audioPcm)) {
    // number[] of byte values.
    return Uint8Array.from(audioPcm as number[]);
  }

  if (typeof audioPcm === "string") {
    return base64ToBytes(audioPcm);
  }

  // Unknown / empty payload — emit nothing rather than throwing, so one odd
  // frame never tears down the capture loop.
  return new Uint8Array(0);
}

// atob/btoa are available both in the Flutter WebView (DOM lib) and in Node 18+
// (the vitest test env), so no Buffer fallback is needed.
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
