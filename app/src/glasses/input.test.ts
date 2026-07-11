import { describe, expect, it } from "vitest";
import { actionForEvent } from "./input";

describe("actionForEvent", () => {
  it("maps swipes on the text container to suggestion cycling", () => {
    expect(actionForEvent({ textEvent: { eventType: 1 } })).toBe("prev");
    expect(actionForEvent({ textEvent: { eventType: 2 } })).toBe("next");
  });

  it("maps single click (protobuf-omitted zero) to pause toggle", () => {
    expect(actionForEvent({ sysEvent: {} })).toBe("toggle-pause");
    expect(actionForEvent({ sysEvent: { eventType: 0 } })).toBe("toggle-pause");
  });

  it("maps double click to the exit dialog", () => {
    expect(actionForEvent({ sysEvent: { eventType: 3 } })).toBe("exit-dialog");
  });

  it("maps exit lifecycle events to cleanup", () => {
    expect(actionForEvent({ sysEvent: { eventType: 6 } })).toBe("cleanup");
    expect(actionForEvent({ sysEvent: { eventType: 7 } })).toBe("cleanup");
  });

  it("ignores unrelated events", () => {
    expect(actionForEvent({})).toBeNull();
    expect(actionForEvent({ sysEvent: { eventType: 8 } })).toBeNull();
    expect(actionForEvent({ audioEvent: { audioPcm: new Uint8Array(0) } })).toBeNull();
  });
});
