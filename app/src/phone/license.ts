// Pro license storage + helpers, mirroring keys.ts: the device token from a
// redeemed license persists via bridge.setLocalStorage and never leaves the
// phone except as the x-device-token header to our own edge functions.

import { STORAGE_KEYS } from "../config";
import type { KeyStorage } from "./keys";

// TA- + 4 groups of 4 Crockford base32 chars (no I/L/O/U).
const LICENSE_KEY_RE = /^TA-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;

export type Plan = "monthly" | "yearly";

/** Canonical `TA-XXXX-XXXX-XXXX-XXXX` form from however the user typed or
 * pasted it (case, spaces, missing dashes are all forgiven). */
export function normalizeLicenseKey(raw: string): string {
  const stripped = raw.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^TA/, "");
  const groups = stripped.match(/.{1,4}/g) ?? [];
  return `TA-${groups.join("-")}`;
}

export function isValidLicenseKey(raw: string): boolean {
  return LICENSE_KEY_RE.test(normalizeLicenseKey(raw));
}

export function createLicenseStore(bridge: KeyStorage) {
  return {
    async getDeviceToken(): Promise<string> {
      return bridge.getLocalStorage(STORAGE_KEYS.deviceToken);
    },
    async setActivation(deviceToken: string, plan: Plan): Promise<void> {
      await bridge.setLocalStorage(STORAGE_KEYS.deviceToken, deviceToken);
      await bridge.setLocalStorage(STORAGE_KEYS.plan, plan);
    },
    async getPlan(): Promise<Plan | null> {
      const plan = await bridge.getLocalStorage(STORAGE_KEYS.plan);
      return plan === "monthly" || plan === "yearly" ? plan : null;
    },
    /** "Remove Pro from this device" — the license stays activated server-side
     * (single-use), this only forgets the local credential. */
    async clear(): Promise<void> {
      await bridge.setLocalStorage(STORAGE_KEYS.deviceToken, "");
      await bridge.setLocalStorage(STORAGE_KEYS.plan, "");
    },
  };
}

export type LicenseStore = ReturnType<typeof createLicenseStore>;
