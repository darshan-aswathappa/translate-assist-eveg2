import { describe, expect, it } from "vitest";
import { createSegmentAssembler, modelLanguageFor, type LiveSegment } from "./deepgramLive";

function results(
  transcript: string,
  opts: {
    isFinal?: boolean;
    speechFinal?: boolean;
    fromFinalize?: boolean;
    wordLanguages?: string[];
  } = {},
) {
  return {
    type: "Results",
    is_final: opts.isFinal ?? false,
    speech_final: opts.speechFinal ?? false,
    from_finalize: opts.fromFinalize ?? false,
    channel: {
      alternatives: [
        {
          transcript,
          words: (opts.wordLanguages ?? []).map((language) => ({ language })),
        },
      ],
    },
  };
}

function setup(language?: string) {
  const interims: string[] = [];
  const segments: LiveSegment[] = [];
  const assembler = createSegmentAssembler({
    onInterim: (t) => interims.push(t),
    onSegment: (s) => segments.push(s),
    language,
  });
  return { assembler, interims, segments };
}

describe("createSegmentAssembler", () => {
  it("surfaces interim transcripts as growing captions", () => {
    const { assembler, interims, segments } = setup();
    assembler.handleMessage(results("こんにち"));
    assembler.handleMessage(results("こんにちは、元気"));
    expect(interims).toEqual(["こんにち", "こんにちは、元気"]);
    expect(segments).toHaveLength(0);
  });

  it("accumulates is_final pieces and emits a segment on speech_final", () => {
    const { assembler, interims, segments } = setup();
    assembler.handleMessage(results("first part.", { isFinal: true }));
    assembler.handleMessage(results("second part.", { isFinal: true, speechFinal: true }));
    expect(segments).toEqual([{ text: "first part. second part.", language: "" }]);
    // The first is_final still updated the caption while the utterance ran on.
    expect(interims).toContain("first part.");
  });

  it("prefixes accumulated finals to later interim captions", () => {
    const { assembler, interims } = setup();
    assembler.handleMessage(results("first part.", { isFinal: true }));
    assembler.handleMessage(results("second"));
    expect(interims.at(-1)).toBe("first part. second");
  });

  it("emits on UtteranceEnd when speech_final never arrived", () => {
    const { assembler, segments } = setup();
    assembler.handleMessage(results("hello there.", { isFinal: true }));
    assembler.handleMessage({ type: "UtteranceEnd" });
    expect(segments).toEqual([{ text: "hello there.", language: "" }]);
  });

  it("emits on a from_finalize result (explicit Finalize flush)", () => {
    const { assembler, segments } = setup();
    assembler.handleMessage(results("buffered tail", { isFinal: true, fromFinalize: true }));
    expect(segments).toEqual([{ text: "buffered tail", language: "" }]);
  });

  it("ignores empty finalizations", () => {
    const { assembler, segments } = setup();
    assembler.handleMessage({ type: "UtteranceEnd" });
    assembler.handleMessage(results("", { isFinal: true, speechFinal: true }));
    expect(segments).toHaveLength(0);
  });

  it("infers segment language from majority word tags (multilingual mode)", () => {
    const { assembler, segments } = setup();
    assembler.handleMessage(
      results("こんにちは ok", {
        isFinal: true,
        speechFinal: true,
        wordLanguages: ["ja", "ja", "en"],
      }),
    );
    expect(segments[0].language).toBe("ja");
  });

  it("falls back to the configured language without word tags", () => {
    const { assembler, segments } = setup("ja");
    assembler.handleMessage(results("こんにちは", { isFinal: true, speechFinal: true }));
    expect(segments[0].language).toBe("ja");
  });

  it("flush() emits whatever accumulated (disconnect path)", () => {
    const { assembler, segments } = setup();
    assembler.handleMessage(results("cut off mid", { isFinal: true }));
    assembler.flush();
    expect(segments).toEqual([{ text: "cut off mid", language: "" }]);
  });
});

describe("modelLanguageFor", () => {
  it("uses the multilingual model (undefined) before any language locks", () => {
    expect(modelLanguageFor(null)).toBeUndefined();
    expect(modelLanguageFor(undefined)).toBeUndefined();
    expect(modelLanguageFor("")).toBeUndefined();
  });

  it("stays multilingual for languages the multi model covers", () => {
    expect(modelLanguageFor("ja")).toBeUndefined();
    expect(modelLanguageFor("es")).toBeUndefined();
    expect(modelLanguageFor("en")).toBeUndefined();
  });

  it("pins the monolingual model for languages outside the multi set", () => {
    expect(modelLanguageFor("ko")).toBe("ko");
    expect(modelLanguageFor("zh")).toBe("zh");
    expect(modelLanguageFor("el")).toBe("el");
  });
});
