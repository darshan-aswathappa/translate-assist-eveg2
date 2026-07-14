// Live streaming transcription over Deepgram's WebSocket API (nova-3).
// The app connects directly in both tiers. Browser WebSockets can't set
// headers, so the credential travels via the documented subprotocols: free
// tier sends the user's own API key as ["token", key]; Pro sends a short-lived
// JWT (minted per-connect by the dg-token edge function, so the server's key
// never reaches the device) as ["bearer", jwt].
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
// while the speech gate is closed. Kept comfortably below the 10s timeout so a
// single delayed tick can't trip it.
const KEEPALIVE_INTERVAL_MS = 4_000;
// Silence (ms) that finalizes a segment. In multilingual mode Deepgram
// recommends a short value so segments split at language boundaries and words
// are attributed to the right language; when locked to one language we favour
// fuller clauses (better machine translation) with a longer gap. Both stay
// below the speech gate's hangover so `speech_final` fires from real
// transmitted silence before we stop sending audio.
const ENDPOINTING_MULTI_MS = 100;
const ENDPOINTING_LOCKED_MS = 300;
// Fallback segment boundary from a gap in word timings, for long monologues
// with internal pauses where `speech_final` hasn't fired. 1000ms is the floor
// worth using — interim results arrive ~1s apart, so anything lower is moot.
const UTTERANCE_END_MS = 1_000;

// The 10 languages nova-3's multilingual (code-switching) model covers.
const MULTI_LANGUAGES: ReadonlySet<string> = new Set([
  "en",
  "es",
  "fr",
  "de",
  "hi",
  "it",
  "ja",
  "nl",
  "ru",
  "pt",
]);

// Which `language` to send Deepgram for a thread's detected primary language.
// `undefined` selects the multilingual model (code-switching stays on); a code
// pins the monolingual model. We stay multilingual whenever the primary
// language is one the multi model covers, so the wearer's English and any
// code-switching are still transcribed accurately; we only pin a monolingual
// model for languages outside that set (e.g. Korean, Mandarin).
export function modelLanguageFor(locked: string | null | undefined): string | undefined {
  if (!locked || MULTI_LANGUAGES.has(locked)) return undefined;
  return locked;
}

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

/** WS auth subprotocol pair: "token" carries an API key, "bearer" a JWT. The
 * JWT only needs to be valid at connection-open time, so callers mint a fresh
 * one before every connect. */
export interface LiveCredentials {
  scheme: "token" | "bearer";
  value: string;
}

export interface DeepgramLiveOptions {
  credentials: LiveCredentials;
  /** Locked thread language; omit to use multilingual code-switching. */
  language?: string;
  /** Domain terms (names, places, jargon) to bias recognition toward. */
  keyterms?: readonly string[];
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
  const multilingual = opts.language === undefined;
  const params = new URLSearchParams({
    model: MODEL,
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    smart_format: "true",
    interim_results: "true",
    endpointing: String(multilingual ? ENDPOINTING_MULTI_MS : ENDPOINTING_LOCKED_MS),
    utterance_end_ms: String(UTTERANCE_END_MS),
    language: opts.language ?? "multi",
  });
  // Keyterm prompting is a repeated `keyterm` param (no weights, one per term).
  for (const term of opts.keyterms ?? []) {
    const trimmed = term.trim();
    if (trimmed) params.append("keyterm", trimmed);
  }

  const assembler = createSegmentAssembler({
    onInterim: opts.onInterim,
    onSegment: opts.onSegment,
    language: opts.language,
  });

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${DEEPGRAM_WS_URL}?${params}`, [
      opts.credentials.scheme,
      opts.credentials.value,
    ]);
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
