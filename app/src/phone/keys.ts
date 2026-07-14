// User API-key storage. Keys are entered on the phone Settings screen and kept
// in the Even app's storage via bridge.setLocalStorage — browser localStorage /
// IndexedDB do NOT reliably persist in the Even WebView. Keys never leave the
// phone except as per-request headers to our own edge functions.

import { STORAGE_KEYS } from "../config";

// Deepgram caps keyterm prompting at 500 tokens (~100 words); 50 short terms
// stays well inside that and keeps the connect URL a sane length.
const MAX_KEYTERMS = 50;

export interface UserKeys {
  deepgramKey: string;
  anthropicKey: string;
}

/** Parse the free-text keyterms field (one per line, or comma-separated) into a
 * clean, de-duplicated, capped list. */
export function parseKeyterms(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\n,]/)) {
    const term = part.trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= MAX_KEYTERMS) break;
  }
  return out;
}

// The two bridge methods we need — accepting a structural type keeps this
// testable without the real SDK bridge.
export interface KeyStorage {
  setLocalStorage(key: string, value: string): Promise<boolean>;
  getLocalStorage(key: string): Promise<string>;
}

export function createKeyStore(bridge: KeyStorage) {
  return {
    async getKeys(): Promise<UserKeys> {
      const [deepgramKey, anthropicKey] = await Promise.all([
        bridge.getLocalStorage(STORAGE_KEYS.deepgramKey),
        bridge.getLocalStorage(STORAGE_KEYS.anthropicKey),
      ]);
      return { deepgramKey, anthropicKey };
    },
    async setKeys(keys: UserKeys): Promise<void> {
      await bridge.setLocalStorage(STORAGE_KEYS.deepgramKey, keys.deepgramKey.trim());
      await bridge.setLocalStorage(STORAGE_KEYS.anthropicKey, keys.anthropicKey.trim());
    },
    async getKeyterms(): Promise<string[]> {
      return parseKeyterms(await bridge.getLocalStorage(STORAGE_KEYS.keyterms));
    },
    async setKeyterms(terms: readonly string[]): Promise<void> {
      await bridge.setLocalStorage(STORAGE_KEYS.keyterms, parseKeyterms(terms.join("\n")).join("\n"));
    },
  };
}

export type KeyStore = ReturnType<typeof createKeyStore>;

/** Deepgram API keys are 40-character hex strings (no vendor prefix). */
export function isValidDeepgramKey(key: string): boolean {
  return /^[a-f0-9]{40}$/i.test(key.trim());
}

/** Display form of a stored key: first 4 + last 4 chars, middle masked. */
export function maskKey(key: string): string {
  if (key.length === 0) return "";
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
