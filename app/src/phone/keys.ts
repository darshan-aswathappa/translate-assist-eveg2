// User API-key storage. Keys are entered on the phone Settings screen and kept
// in the Even app's storage via bridge.setLocalStorage — browser localStorage /
// IndexedDB do NOT reliably persist in the Even WebView. Keys never leave the
// phone except as per-request headers to our own edge functions.

import { STORAGE_KEYS } from "../config";

export interface UserKeys {
  groqKey: string;
  anthropicKey: string;
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
      const [groqKey, anthropicKey] = await Promise.all([
        bridge.getLocalStorage(STORAGE_KEYS.groqKey),
        bridge.getLocalStorage(STORAGE_KEYS.anthropicKey),
      ]);
      return { groqKey, anthropicKey };
    },
    async setKeys(keys: UserKeys): Promise<void> {
      await bridge.setLocalStorage(STORAGE_KEYS.groqKey, keys.groqKey.trim());
      await bridge.setLocalStorage(STORAGE_KEYS.anthropicKey, keys.anthropicKey.trim());
    },
  };
}

export type KeyStore = ReturnType<typeof createKeyStore>;

/** Display form of a stored key: first 4 + last 4 chars, middle masked. */
export function maskKey(key: string): string {
  if (key.length === 0) return "";
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
