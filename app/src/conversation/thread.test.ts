import { describe, expect, it } from "vitest";
import {
  initialConversation,
  withThread,
  withDetectedLanguage,
  withTurn,
  recentContext,
  type Turn,
} from "./thread";

const turn = (n: number): Turn => ({
  original: `原文${n}`,
  translation: `translation ${n}`,
  suggestions: [{ native: `答え${n}`, roman: `kotae ${n}`, gloss: `answer ${n}` }],
});

describe("conversation thread state", () => {
  it("starts with no thread, no language, no turns", () => {
    const c = initialConversation();
    expect(c.threadId).toBeNull();
    expect(c.lockedLanguage).toBeNull();
    expect(c.turns).toHaveLength(0);
  });

  it("locks the first detected language and ignores later detections", () => {
    let c = initialConversation();
    c = withDetectedLanguage(c, "ja");
    expect(c.lockedLanguage).toBe("ja");
    c = withDetectedLanguage(c, "ko");
    expect(c.lockedLanguage).toBe("ja");
  });

  it("does not lock onto an empty detection", () => {
    const c = withDetectedLanguage(initialConversation(), "");
    expect(c.lockedLanguage).toBeNull();
  });

  it("appends turns immutably", () => {
    const c0 = withThread(initialConversation(), "t-1");
    const c1 = withTurn(c0, turn(1));
    expect(c0.turns).toHaveLength(0);
    expect(c1.turns).toHaveLength(1);
    expect(c1.threadId).toBe("t-1");
  });

  it("recentContext returns the last N originals in order", () => {
    let c = initialConversation();
    for (let i = 1; i <= 12; i++) c = withTurn(c, turn(i));
    const ctx = recentContext(c, 10);
    expect(ctx).toHaveLength(10);
    expect(ctx[0]).toBe("原文3");
    expect(ctx[9]).toBe("原文12");
  });
});
