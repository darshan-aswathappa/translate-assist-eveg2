// Pro-tier streaming usage accounting. The live WebSocket bypasses our proxy,
// so the app meters what it actually sends: PCM bytes pushed through the
// speech gate accumulate here and flush as whole seconds to the license meter
// (periodically and when the connection closes). Fractional remainders carry
// over so long sessions don't undercount.

// 16 kHz × 16-bit mono.
const BYTES_PER_SECOND = 32_000;

export interface UsageReporter {
  addBytes(count: number): void;
  /** Emit accumulated whole seconds (if any) to the callback. */
  flush(): void;
}

export function createUsageReporter(report: (seconds: number) => void): UsageReporter {
  let bytes = 0;
  return {
    addBytes(count) {
      bytes += count;
    },
    flush() {
      const seconds = Math.floor(bytes / BYTES_PER_SECOND);
      if (seconds <= 0) return;
      bytes -= seconds * BYTES_PER_SECOND;
      report(seconds);
    },
  };
}
