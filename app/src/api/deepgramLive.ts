// Live streaming transcription over Deepgram's WebSocket API (nova-3).
// The app connects directly (the key is the user's own, entered in Settings,
// so nothing leaks that the batch proxy doesn't already send). Browser
// WebSockets can't set headers, so the key travels via the documented
// `token` subprotocol.
//
// Interim results drive the live caption on the HUD; `speech_final` (from
// Deepgram's audio-based endpointing), `UtteranceEnd` (word-gap timing), and
// `from_finalize` (our explicit Finalize when the speech gate closes) all
// finalize the current segment. Without a locked language the multilingual
// code-switching model is used and the segment language is inferred from
// per-word language tags.

const DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen";
const MODEL = "nova-3";
const CONNECT_TIMEOUT_MS = 8_000;
// Deepgram drops connections after ~10s without audio; keepalives hold it open
// while the speech gate is closed.
const KEEPALIVE_INTERVAL_MS = 5_000;
// Must stay below the speech gate's hangover so `speech_final` fires from real
// transmitted silence before we stop sending audio.
const ENDPOINTING_MS = 300;
const UTTERANCE_END_MS = 1_200;

export interface LiveSegment {
  text: string;
  /** ISO-639-1 code — inferred from word tags in multilingual mode, otherwise
   * the configured language. Empty string when unknown. */
  language: string;
}

interface DeepgramWord {
  language?: string;
}

interface DeepgramResultsMessage {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  from_finalize?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string; words?: DeepgramWord[] }> };
}

export interface SegmentAssembler {
  /** Handle one parsed Deepgram live message. */
  handleMessage: (msg: DeepgramResultsMessage) => void;
  /** Emit whatever is accumulated as a segment (e.g. on disconnect). */
  flush: () => void;
}

// Pure accumulation of Deepgram live messages into caption updates and
// finalized segments — kept free of WebSocket concerns so it's testable.
export function createSegmentAssembler(handlers: {
  onInterim: (text: string) => void;
  onSegment: (segment: LiveSegment) => void;
  /** Fallback language when no per-word tags are present. */
  language?: string;
}): SegmentAssembler {
  // is_final transcript pieces of the current utterance, in order.
  let finals: string[] = [];
  let wordLanguages: string[] = [];

  function segmentLanguage(): string {
    if (wordLanguages.length === 0) return handlers.language ?? "";
    const counts = new Map<string, number>();
    for (const lang of wordLanguages) counts.set(lang, (counts.get(lang) ?? 0) + 1);
    let best = "";
    let bestCount = 0;
    for (const [lang, count] of counts) {
      if (count > bestCount) {
        best = lang;
        bestCount = count;
      }
    }
    return best;
  }

  function emitSegment(): void {
    const text = finals.join(" ").trim();
    const language = segmentLanguage();
    finals = [];
    wordLanguages = [];
    if (text) handlers.onSegment({ text, language });
  }

  return {
    handleMessage(msg) {
      if (msg.type === "UtteranceEnd") {
        emitSegment();
        return;
      }
      if (msg.type !== "Results") return;
      const alt = msg.channel?.alternatives?.[0];
      const transcript = (alt?.transcript ?? "").trim();

      if (msg.is_final) {
        if (transcript) {
          finals.push(transcript);
          for (const w of alt?.words ?? []) {
            if (typeof w.language === "string" && w.language) wordLanguages.push(w.language);
          }
        }
        if (msg.speech_final || msg.from_finalize) emitSegment();
        else if (transcript) handlers.onInterim(finals.join(" "));
      } else if (transcript) {
        handlers.onInterim([...finals, transcript].join(" ").trim());
      }
    },
    flush: emitSegment,
  };
}

export interface DeepgramLiveOptions {
  apiKey: string;
  /** Locked thread language; omit to use multilingual code-switching. */
  language?: string;
  onInterim: (text: string) => void;
  onSegment: (segment: LiveSegment) => void;
  /** Fired on any close after a successful open (clean or not). */
  onClose?: (ev: { code: number; wasClean: boolean }) => void;
}

export interface DeepgramLive {
  sendPcm: (frame: Uint8Array) => void;
  /** Flush buffered audio into a final result (speech gate just closed). */
  finalize: () => void;
  close: () => void;
}

export function connectDeepgramLive(opts: DeepgramLiveOptions): Promise<DeepgramLive> {
  const params = new URLSearchParams({
    model: MODEL,
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    smart_format: "true",
    interim_results: "true",
    endpointing: String(ENDPOINTING_MS),
    utterance_end_ms: String(UTTERANCE_END_MS),
    language: opts.language ?? "multi",
  });

  const assembler = createSegmentAssembler({
    onInterim: opts.onInterim,
    onSegment: opts.onSegment,
    language: opts.language,
  });

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${DEEPGRAM_WS_URL}?${params}`, ["token", opts.apiKey]);
    ws.binaryType = "arraybuffer";

    let opened = false;
    let closedByUs = false;
    let keepalive: ReturnType<typeof setInterval> | null = null;

    const connectTimer = setTimeout(() => {
      if (!opened) {
        closedByUs = true;
        ws.close();
        reject(new Error("Deepgram connection timed out"));
      }
    }, CONNECT_TIMEOUT_MS);

    function cleanup(): void {
      clearTimeout(connectTimer);
      if (keepalive !== null) clearInterval(keepalive);
      keepalive = null;
    }

    ws.onopen = () => {
      opened = true;
      clearTimeout(connectTimer);
      keepalive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "KeepAlive" }));
        }
      }, KEEPALIVE_INTERVAL_MS);

      resolve({
        sendPcm(frame) {
          if (ws.readyState === WebSocket.OPEN) ws.send(frame);
        },
        finalize() {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "Finalize" }));
          }
        },
        close() {
          closedByUs = true;
          cleanup();
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "CloseStream" }));
          }
          ws.close();
        },
      });
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        assembler.handleMessage(JSON.parse(ev.data) as DeepgramResultsMessage);
      } catch (err) {
        console.error("deepgram live: bad message", err);
      }
    };

    ws.onerror = () => {
      // onclose always follows onerror; connection-phase failures reject there.
    };

    ws.onclose = (ev) => {
      cleanup();
      if (!opened) {
        reject(new Error(`Deepgram connection failed (${ev.code})`));
        return;
      }
      assembler.flush();
      if (!closedByUs) opts.onClose?.({ code: ev.code, wasClean: ev.wasClean });
    };
  });
}
