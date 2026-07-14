import { describe, expect, it } from "vitest";
import { createLicenseStore, isValidLicenseKey, normalizeLicenseKey } from "./license";

// Fake of the two bridge storage methods the store uses (same as keys.test.ts).
function fakeBridge() {
  const data = new Map<string, string>();
  return {
    async setLocalStorage(key: string, value: string): Promise<boolean> {
      data.set(key, value);
      return true;
    },
    async getLocalStorage(key: string): Promise<string> {
      return data.get(key) ?? "";
    },
  };
}

describe("normalizeLicenseKey", () => {
  it("canonicalizes case, spaces, and missing dashes", () => {
    expect(normalizeLicenseKey("ta-aaaa bbbb-ccccdddd")).toBe("TA-AAAA-BBBB-CCCC-DDDD");
    expect(normalizeLicenseKey("TAAAAABBBBCCCCDDDD")).toBe("TA-AAAA-BBBB-CCCC-DDDD");
    expect(normalizeLicenseKey("  TA-1234-5678-9ABC-DEFG ")).toBe("TA-1234-5678-9ABC-DEFG");
  });
});

describe("isValidLicenseKey", () => {
  it("accepts well-formed keys however they were typed", () => {
    expect(isValidLicenseKey("TA-1234-5678-9ABC-DEFG")).toBe(true);
    expect(isValidLicenseKey("ta 1234 5678 9abc defg")).toBe(true);
  });

  it("rejects wrong length and excluded Crockford letters (I, L, O, U)", () => {
    expect(isValidLicenseKey("TA-1234-5678-9ABC")).toBe(false);
    expect(isValidLicenseKey("TA-1234-5678-9ABC-DEFG-HHHH")).toBe(false);
    expect(isValidLicenseKey("TA-IIII-LLLL-OOOO-UUUU")).toBe(false);
    expect(isValidLicenseKey("")).toBe(false);
  });
});

describe("createLicenseStore", () => {
  it("round-trips the activation through bridge storage", async () => {
    const store = createLicenseStore(fakeBridge());
    await store.setActivation("devtok", "yearly");
    expect(await store.getDeviceToken()).toBe("devtok");
    expect(await store.getPlan()).toBe("yearly");
  });

  it("is empty when nothing is stored, and after clear()", async () => {
    const store = createLicenseStore(fakeBridge());
    expect(await store.getDeviceToken()).toBe("");
    expect(await store.getPlan()).toBeNull();

    await store.setActivation("devtok", "monthly");
    await store.clear();
    expect(await store.getDeviceToken()).toBe("");
    expect(await store.getPlan()).toBeNull();
  });
});
