import { describe, expect, it } from "vitest";
import { createTurnBuffer } from "./turnBuffer";

describe("createTurnBuffer", () => {
  it("joins appended segments in arrival order", () => {
    const buf = createTurnBuffer();
    buf.append({ text: "El restaurante indio más", language: "es" });
    buf.append({ text: "cercano está a veinte minutos.", language: "es" });
    expect(buf.text()).toBe("El restaurante indio más cercano está a veinte minutos.");
  });

  it("starts empty and reports emptiness", () => {
    const buf = createTurnBuffer();
    expect(buf.isEmpty()).toBe(true);
    expect(buf.text()).toBe("");
    buf.append({ text: "hola", language: "es" });
    expect(buf.isEmpty()).toBe(false);
  });

  it("ignores whitespace-only segments", () => {
    const buf = createTurnBuffer();
    buf.append({ text: "   ", language: "es" });
    expect(buf.isEmpty()).toBe(true);
  });

  it("picks the majority language across segments", () => {
    const buf = createTurnBuffer();
    buf.append({ text: "uno", language: "es" });
    buf.append({ text: "two", language: "en" });
    buf.append({ text: "dos", language: "es" });
    expect(buf.language()).toBe("es");
  });

  it("returns an empty language when no segment carried one", () => {
    const buf = createTurnBuffer();
    buf.append({ text: "hello", language: "" });
    expect(buf.language()).toBe("");
  });

  it("clear resets text and language", () => {
    const buf = createTurnBuffer();
    buf.append({ text: "hola", language: "es" });
    buf.clear();
    expect(buf.isEmpty()).toBe(true);
    expect(buf.text()).toBe("");
    expect(buf.language()).toBe("");
  });
});
