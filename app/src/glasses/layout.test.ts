import { describe, expect, it } from "vitest";
import { hudText, paneCount, splitPages, type HudView } from "./layout";

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

  it("shows a state banner above the translation when paused", () => {
    const text = hudText({ ...RESULT, banner: "⏸ PAUSED · TAP TO RESUME" });
    const lines = text.split("\n");
    expect(lines[0]).toBe("⏸ PAUSED · TAP TO RESUME");
    expect(text).toContain('"Do you speak English?"');
    // Banner also rides on leading translation pages.
    const LONG = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const paged = hudText({
      kind: "result",
      translation: LONG,
      suggestions: RESULT.suggestions,
      index: 0,
      banner: "⏸ PAUSED · TAP TO RESUME",
    });
    expect(paged.split("\n")[0]).toBe("⏸ PAUSED · TAP TO RESUME");
  });

  it("omits the banner line when none is set", () => {
    expect(hudText(RESULT).split("\n")[0]).toBe('"Do you speak English?"');
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

  it("renders live captions with the freshest tail", () => {
    expect(hudText({ kind: "caption", text: "こんにちは、元気" })).toBe("» こんにちは、元気");
    const long = hudText({ kind: "caption", text: "a".repeat(500) });
    expect(long.startsWith("» …")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(303);
  });
});

describe("splitPages", () => {
  it("returns one page for short text", () => {
    expect(splitPages("hello world")).toEqual(["hello world"]);
  });

  it("splits at word boundaries within the page budget", () => {
    const words = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
    const pages = splitPages(words);
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) {
      expect(p.length).toBeLessThanOrEqual(240);
      expect(p.startsWith(" ")).toBe(false);
      expect(p.endsWith(" ")).toBe(false);
    }
    expect(pages.join(" ")).toBe(words);
  });

  it("hard-cuts text without spaces", () => {
    const pages = splitPages("x".repeat(500));
    expect(pages.length).toBe(3);
  });
});

describe("translation pagination", () => {
  const LONG = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" "); // > 240 chars
  const view = (index: number): HudView => ({
    kind: "result",
    translation: LONG,
    suggestions: RESULT.suggestions,
    index,
  });

  it("counts translation pages plus suggestion panes", () => {
    const pages = splitPages(LONG).length;
    expect(paneCount(LONG, RESULT.suggestions)).toBe(pages - 1 + 3);
    expect(paneCount("short", RESULT.suggestions)).toBe(3);
    expect(paneCount("short", [])).toBe(1);
  });

  it("shows a translation page without truncation on early panes", () => {
    const text = hudText(view(0));
    expect(text).toContain("[page 1/");
    expect(text).toContain("<swipe for more>");
    expect(text).not.toContain("[1/3]"); // no suggestion yet
  });

  it("shows the last page plus suggestions on later panes", () => {
    const pages = splitPages(LONG).length;
    const text = hudText(view(pages - 1)); // first suggestion pane
    expect(text).toContain(`[page ${pages}/${pages}]`);
    expect(text).toContain("[1/3]");
    expect(text).toContain("はい、少しだけ。");
  });

  it("swiping through all panes reaches every word of the translation", () => {
    const pages = splitPages(LONG);
    const seen = Array.from({ length: pages.length }, (_, i) => hudText(view(i))).join("\n");
    expect(seen).toContain("word0");
    expect(seen).toContain("word79");
  });

  it("keeps short translations on the old single-pane behavior", () => {
    const text = hudText(RESULT);
    expect(text).not.toContain("[page");
  });
});
