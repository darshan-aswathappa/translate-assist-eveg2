import { describe, expect, it } from "vitest";
import { createKeyStore, maskKey } from "./keys";

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
    await store.setKeys({ groqKey: "gsk_abc", anthropicKey: "sk-ant-xyz" });
    expect(await store.getKeys()).toEqual({ groqKey: "gsk_abc", anthropicKey: "sk-ant-xyz" });
  });

  it("returns empty strings when nothing is stored", async () => {
    const store = createKeyStore(fakeBridge());
    expect(await store.getKeys()).toEqual({ groqKey: "", anthropicKey: "" });
  });

  it("trims pasted whitespace", async () => {
    const store = createKeyStore(fakeBridge());
    await store.setKeys({ groqKey: "  gsk_abc\n", anthropicKey: " sk-ant-xyz " });
    expect(await store.getKeys()).toEqual({ groqKey: "gsk_abc", anthropicKey: "sk-ant-xyz" });
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
