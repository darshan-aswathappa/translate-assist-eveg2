import { describe, expect, it } from "vitest";
import { createKeyStore, isValidDeepgramKey, maskKey } from "./keys";

// Fake of the two bridge storage methods the store uses.
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

describe("createKeyStore", () => {
  it("round-trips both keys through bridge storage", async () => {
    const store = createKeyStore(fakeBridge());
    await store.setKeys({ deepgramKey: "dg_abc", anthropicKey: "sk-ant-xyz" });
    expect(await store.getKeys()).toEqual({ deepgramKey: "dg_abc", anthropicKey: "sk-ant-xyz" });
  });

  it("returns empty strings when nothing is stored", async () => {
    const store = createKeyStore(fakeBridge());
    expect(await store.getKeys()).toEqual({ deepgramKey: "", anthropicKey: "" });
  });

  it("trims pasted whitespace", async () => {
    const store = createKeyStore(fakeBridge());
    await store.setKeys({ deepgramKey: "  dg_abc\n", anthropicKey: " sk-ant-xyz " });
    expect(await store.getKeys()).toEqual({ deepgramKey: "dg_abc", anthropicKey: "sk-ant-xyz" });
  });
});

describe("isValidDeepgramKey", () => {
  it("accepts a 40-char hex string, case-insensitively", () => {
    expect(isValidDeepgramKey("a".repeat(40))).toBe(true);
    expect(isValidDeepgramKey("0123456789ABCDEF0123456789abcdef01234567")).toBe(true);
  });

  it("trims surrounding whitespace before checking", () => {
    expect(isValidDeepgramKey(`  ${"f".repeat(40)}\n`)).toBe(true);
  });

  it("rejects wrong length, non-hex chars, and gsk_ (Groq) keys", () => {
    expect(isValidDeepgramKey("f".repeat(39))).toBe(false);
    expect(isValidDeepgramKey("f".repeat(41))).toBe(false);
    expect(isValidDeepgramKey(`${"g".repeat(40)}`)).toBe(false);
    expect(isValidDeepgramKey("gsk_0123456789abcdef0123456789abcdef")).toBe(false);
    expect(isValidDeepgramKey("")).toBe(false);
  });
});

describe("maskKey", () => {
  it("keeps a short prefix/suffix and masks the middle", () => {
    expect(maskKey("sk-ant-api03-abcdefgh12345678")).toBe("sk-a••••5678");
  });

  it("fully masks very short keys", () => {
    expect(maskKey("abcd")).toBe("••••");
  });

  it("is empty for empty input", () => {
    expect(maskKey("")).toBe("");
  });
});
