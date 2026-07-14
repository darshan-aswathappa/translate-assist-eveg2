import { describe, expect, it, vi } from "vitest";
import { createUsageReporter } from "./usageReporter";

const SECOND = 32_000; // bytes of 16 kHz × 16-bit mono PCM

describe("createUsageReporter", () => {
  it("flushes whole seconds and keeps the fractional remainder", () => {
    const report = vi.fn();
    const usage = createUsageReporter(report);

    usage.addBytes(2.5 * SECOND);
    usage.flush();
    expect(report).toHaveBeenCalledWith(2);

    // The half second left over completes on the next accumulation.
    usage.addBytes(0.5 * SECOND);
    usage.flush();
    expect(report).toHaveBeenLastCalledWith(1);
  });

  it("does not report when under one second", () => {
    const report = vi.fn();
    const usage = createUsageReporter(report);

    usage.addBytes(SECOND - 1);
    usage.flush();
    usage.flush();
    expect(report).not.toHaveBeenCalled();
  });
});
