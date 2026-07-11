import { describe, expect, it } from "vitest";
import { hudText, type HudView } from "./layout";

const RESULT: HudView = {
  kind: "result",
  translation: "Do you speak English?",
  suggestions: [
    { native: "はい、少しだけ。", roman: "Hai, sukoshi dake.", gloss: "Yes, just a little." },
    {
      native: "すみません、あまり得意ではありません。",
      roman: "Sumimasen, amari tokui dewa arimasen.",
      gloss: "Sorry, I'm not very good at it.",
    },
    { native: "いいえ。", roman: "Iie.", gloss: "No." },
  ],
  index: 1,
};

describe("hudText", () => {
  it("renders status screens as terminal-style lines", () => {
    expect(hudText({ kind: "status", label: "LISTENING" })).toContain("LISTENING");
    expect(hudText({ kind: "status", label: "SET API KEYS ON PHONE" })).toContain(
      "SET API KEYS ON PHONE",
    );
  });

  it("renders translation, counter, suggestion block, and footer", () => {
    const text = hudText(RESULT);
    expect(text).toContain('"Do you speak English?"');
    expect(text).toContain("[2/3]");
    expect(text).toContain("すみません、あまり得意ではありません。");
    expect(text).toContain("Sumimasen, amari tokui dewa arimasen.");
    expect(text).toContain("(Sorry, I'm not very good at it.)");
    expect(text).toContain("<swipe for more>");
  });

  it("omits empty roman/gloss lines (Latin-script languages)", () => {
    const text = hudText({
      kind: "result",
      translation: "Where are you from?",
      suggestions: [{ native: "Ich komme aus Boston.", roman: "", gloss: "" }],
      index: 0,
    });
    expect(text).toContain("[1/1]");
    expect(text).toContain("Ich komme aus Boston.");
    expect(text).not.toContain("()");
    expect(text.split("\n").every((l) => l.trim() !== "")).toBe(false); // blank separators exist
  });

  it("stays under the 1000-char initial container budget", () => {
    const long: HudView = {
      kind: "result",
      translation: "x".repeat(2000),
      suggestions: [
        { native: "y".repeat(2000), roman: "z".repeat(2000), gloss: "g".repeat(2000) },
      ],
      index: 0,
    };
    expect(hudText(long).length).toBeLessThanOrEqual(1000);
  });

  it("clamps the index into range", () => {
    expect(hudText({ ...RESULT, index: 99 })).toContain("[3/3]");
    expect(hudText({ ...RESULT, index: -5 })).toContain("[1/3]");
  });
});
