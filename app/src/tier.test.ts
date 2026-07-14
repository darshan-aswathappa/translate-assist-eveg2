import { describe, expect, it } from "vitest";
import { resolveCredentials } from "./tier";

const KEYS = { deepgramKey: "dg", anthropicKey: "sk-ant-x" };
const NO_KEYS = { deepgramKey: "", anthropicKey: "" };

describe("resolveCredentials", () => {
  it("is pro when a device token exists, even alongside keys", () => {
    expect(resolveCredentials(NO_KEYS, "tok")).toEqual({ tier: "pro", deviceToken: "tok" });
    expect(resolveCredentials(KEYS, "tok")).toEqual({ tier: "pro", deviceToken: "tok" });
  });

  it("is free when both keys exist and no token", () => {
    expect(resolveCredentials(KEYS, "")).toEqual({ tier: "free", keys: KEYS });
  });

  it("is null (onboarding) with no token and incomplete keys", () => {
    expect(resolveCredentials(NO_KEYS, "")).toBeNull();
    expect(resolveCredentials({ ...KEYS, deepgramKey: "" }, "")).toBeNull();
    expect(resolveCredentials({ ...KEYS, anthropicKey: "" }, "")).toBeNull();
  });
});
